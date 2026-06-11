package dev.burnedchats.ton;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.model.enums.StakingTier;
import dev.burnedchats.ton.TonConfig.TonSettings;
import dev.burnedchats.ton.dto.StakeInfo;
import dev.burnedchats.ton.dto.UserStakingProfile;
import dev.burnedchats.ton.exception.TonContractException;
import dev.burnedchats.ton.exception.TonRpcException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.math.BigInteger;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Reads staking positions and voting power from {@code StakingMaster} / {@code StakingLock}.
 */
@Service
public class StakingVerifier {

    private static final Logger LOG = LoggerFactory.getLogger(StakingVerifier.class);

    private static final String CACHE_VER = "v1";
    private static final Duration USER_PROFILE_TTL = Duration.ofSeconds(30);
    private static final Duration LOCK_ADDR_TTL = Duration.ofHours(1);
    private static final Duration TIER_CFG_TTL = Duration.ofHours(1);

    private final TonService tonService;
    private final TonSettings settings;
    private final ReactiveRedisTemplate<String, String> stringRedis;
    private final ObjectMapper objectMapper;

    public StakingVerifier(
            TonService tonService,
            TonSettings settings,
            ReactiveRedisTemplate<String, String> stringRedis,
            ObjectMapper objectMapper) {
        this.tonService = tonService;
        this.settings = settings;
        this.stringRedis = stringRedis;
        this.objectMapper = objectMapper;
    }

    public Mono<List<StakeInfo>> getStakes(String userAddress) {
        String master = requireStakingMaster();
        return Flux.fromArray(StakingTier.values())
                .flatMap(t -> loadStake(master, userAddress, t), 4)
                .collectList()
                .map(list -> list.stream().flatMap(Optional::stream).toList());
    }

    public Mono<Optional<StakingTier>> getHighestTier(String userAddress) {
        return getStakes(userAddress).map(list -> {
            if (list.isEmpty()) {
                return Optional.<StakingTier>empty();
            }
            return list.stream()
                    .map(StakeInfo::tier)
                    .max(Comparator.comparingInt(Enum::ordinal));
        });
    }

    public Mono<BigInteger> getTotalStaked(String userAddress) {
        return getStakes(userAddress).map(list -> list.stream()
                .map(StakeInfo::amount)
                .reduce(BigInteger.ZERO, BigInteger::add));
    }

    public Mono<BigInteger> getPendingRewards(String userAddress, StakingTier tier) {
        String master = requireStakingMaster();
        List<Object> args = List.of(TonAddressBoc.sliceStackArg(userAddress), TonAddressBoc.numStackArg(tier.getId()));
        return tonService.runGetMethod(master, "get_pending_reward", args)
                .map(StakingVerifier::firstStackNum)
                .defaultIfEmpty(BigInteger.ZERO)
                .onErrorResume(TonContractException.class, e -> Mono.just(BigInteger.ZERO));
    }

    /**
     * On-chain voting power ({@code get_voting_power} on {@code StakingMaster}).
     */
    public Mono<BigInteger> getVotingPower(String userAddress) {
        String master = requireStakingMaster();
        List<Object> args = List.of(TonAddressBoc.sliceStackArg(userAddress));
        return tonService.runGetMethod(master, "get_voting_power", args)
                .map(StakingVerifier::firstStackNum)
                .defaultIfEmpty(BigInteger.ZERO)
                .onErrorResume(ex -> {
                    LOG.debug("getVotingPower fallback 0: {}", ex.toString());
                    return Mono.just(BigInteger.ZERO);
                });
    }

    public Mono<Boolean> hasMinTier(String userAddress, StakingTier minTier) {
        return getHighestTier(userAddress)
                .map(o -> o.map(t -> t.isAtLeast(minTier)).orElse(false))
                .defaultIfEmpty(false);
    }

    public Flux<UserStakingProfile> getStakingProfiles(List<String> userAddresses) {
        if (userAddresses == null || userAddresses.isEmpty()) {
            return Flux.empty();
        }
        return ensureTierConfigCache()
                .thenMany(Flux.fromIterable(userAddresses).flatMap(this::profileForUser, 5));
    }

    /** Single-address convenience wrapper over {@link #getStakingProfiles(List)} (Redis TTL 30 s). */
    public Mono<UserStakingProfile> getStakingProfile(String userAddress) {
        return getStakingProfiles(List.of(userAddress)).next();
    }

    /**
     * Warms {@code StakingLock} multiplier map in Redis (TTL {@value #TIER_CFG_TTL} hours) when missing.
     */
    private Mono<Void> ensureTierConfigCache() {
        return stakingLockAddress().flatMap(lock -> {
            String redisKey = tierCfgCacheKey(lock);
            return stringRedis.opsForValue()
                    .get(redisKey)
                    .filter(s -> !s.isBlank())
                    .hasElement()
                    .flatMap(exists -> Boolean.TRUE.equals(exists)
                            ? Mono.empty()
                            : fetchTierConfigsIntoRedis(lock, redisKey));
        });
    }

    private Mono<Void> fetchTierConfigsIntoRedis(String lock, String redisKey) {
        return Flux.fromArray(StakingTier.values())
                .flatMap(t -> tonService.runGetMethod(
                                lock, "get_lock_config", List.of(TonAddressBoc.numStackArg(t.getId())))
                        .map(r -> Map.entry(t.getId(), parseMultiplierBx100(r))))
                .collectMap(Map.Entry::getKey, Map.Entry::getValue)
                .flatMap(m -> {
                    try {
                        String json = objectMapper.writeValueAsString(m);
                        return stringRedis.opsForValue().set(redisKey, json, TIER_CFG_TTL).then();
                    } catch (JsonProcessingException e) {
                        return Mono.error(new TonRpcException("tier cfg cache", e));
                    }
                });
    }

    private Mono<UserStakingProfile> profileForUser(String userAddress) {
        String key = profileCacheKey(userAddress);
        return readProfile(key)
                .switchIfEmpty(getStakes(userAddress)
                        .flatMap(stakes -> {
                            Optional<StakingTier> hi = stakes.stream()
                                    .map(StakeInfo::tier)
                                    .max(Comparator.comparingInt(Enum::ordinal));
                            BigInteger tot = stakes.stream()
                                    .map(StakeInfo::amount)
                                    .reduce(BigInteger.ZERO, BigInteger::add);
                            return getVotingPower(userAddress).map(vp -> new UserStakingProfile(
                                    TonAddressBoc.normalizeKey(userAddress),
                                    hi.orElse(null),
                                    tot,
                                    vp,
                                    stakes));
                        })
                        .flatMap(p -> writeProfile(key, p).thenReturn(p)));
    }

    private Mono<Optional<StakeInfo>> loadStake(String master, String userAddress, StakingTier tier) {
        List<Object> args = List.of(TonAddressBoc.sliceStackArg(userAddress), TonAddressBoc.numStackArg(tier.getId()));
        return tonService.runGetMethod(master, "get_stake", args)
                .flatMap(r -> {
                    Optional<StakeInfo> base = parseStake(r, tier);
                    if (base.isEmpty()) {
                        return Mono.just(Optional.<StakeInfo>empty());
                    }
                    StakeInfo s = base.get();
                    return getPendingRewards(userAddress, tier).map(pr -> Optional.of(new StakeInfo(
                            s.tier(),
                            s.amount(),
                            s.startTime(),
                            s.unlockTime(),
                            s.lastClaimTime(),
                            pr)));
                });
    }

    private Optional<StakeInfo> parseStake(JsonNode result, StakingTier tier) {
        List<JsonNode> flat = flattenStackNodes(result);
        if (flat.size() < 5) {
            return Optional.empty();
        }
        BigInteger amount = parseNum(flat.get(0));
        if (amount.signum() <= 0) {
            return Optional.empty();
        }
        int tierNum = parseNum(flat.get(1)).intValueExact();
        long start = parseNum(flat.get(2)).longValueExact();
        long lastClaim = parseNum(flat.get(3)).longValueExact();
        long unlock = parseNum(flat.get(4)).longValueExact();
        StakingTier onChain = StakingTier.fromId(tierNum);
        if (onChain != tier) {
            LOG.trace("Stake tier mismatch param={} chain={}", tier, onChain);
        }
        return Optional.of(new StakeInfo(onChain, amount, start, unlock, lastClaim, BigInteger.ZERO));
    }

    private static List<JsonNode> flattenStackNodes(JsonNode result) {
        JsonNode stack = result.get("stack");
        if (stack == null || !stack.isArray()) {
            return List.of();
        }
        if (stack.size() == 1 && stack.get(0).isArray()) {
            JsonNode sole = stack.get(0);
            String soleType = sole.size() >= 2 ? sole.get(0).asText("") : "";
            if ("tuple".equalsIgnoreCase(soleType) || "list".equalsIgnoreCase(soleType)) {
                JsonNode tuple = sole.get(1);
                List<JsonNode> out = new ArrayList<>();
                // Ton Center v2 wraps tuple/list values as {"@type":"tvm.tuple","elements":[...]};
                // a bare JSON array is kept for relay/test compatibility.
                JsonNode elements = tuple != null && tuple.isObject() ? tuple.get("elements") : tuple;
                if (elements != null && elements.isArray()) {
                    for (JsonNode n : elements) {
                        out.add(n);
                    }
                }
                return out;
            }
        }
        List<JsonNode> out = new ArrayList<>();
        for (JsonNode n : stack) {
            out.add(n);
        }
        return out;
    }

    private static BigInteger firstStackNum(JsonNode result) {
        JsonNode stack = result.get("stack");
        if (stack == null || stack.size() < 1) {
            return BigInteger.ZERO;
        }
        return parseNum(stack.get(0));
    }

    private Mono<String> stakingLockAddress() {
        String master = requireStakingMaster();
        String key = lockCacheKey(master);
        return stringRedis.opsForValue()
                .get(key)
                .filter(s -> !s.isBlank())
                .switchIfEmpty(Mono.defer(() -> tonService.runGetMethod(master, "get_staking_lock", List.of())
                        .map(StakingVerifier::extractAddressFromStack)
                        .flatMap(addr -> stringRedis.opsForValue().set(key, addr, LOCK_ADDR_TTL).thenReturn(addr))));
    }

    private static String extractAddressFromStack(JsonNode result) {
        JsonNode stack = result.get("stack");
        if (stack == null || stack.size() < 1) {
            throw new TonRpcException("empty stack for address");
        }
        JsonNode first = stack.get(0);
        String b64 = cellBase64(first);
        return TonAddressBoc.decodeRawAddressFromSingleRootBoc(b64);
    }

    private static int parseMultiplierBx100(JsonNode result) {
        List<JsonNode> flat = flattenStackNodes(result);
        if (flat.size() < 2) {
            throw new TonRpcException("get_lock_config stack too small");
        }
        return parseNum(flat.get(1)).intValueExact();
    }

    private static BigInteger parseNum(JsonNode item) {
        String raw;
        if (item.isArray() && item.size() >= 2) {
            raw = item.get(1).asText();
        } else if (item.has("number")) {
            // tvm.stackEntryNumber tuple element: {"number":{"@type":"tvm.numberDecimal","number":"<dec>"}}
            JsonNode n = item.get("number");
            raw = n.isObject() && n.has("number") ? n.get("number").asText() : n.asText();
        } else if (item.has("value")) {
            raw = item.get("value").asText();
        } else {
            raw = item.asText();
        }
        raw = raw.trim();
        if (raw.startsWith("0x") || raw.startsWith("0X")) {
            return new BigInteger(raw.substring(2), 16);
        }
        return new BigInteger(raw);
    }

    private static String cellBase64(JsonNode stackEntry) {
        if (stackEntry.isArray() && stackEntry.size() >= 2) {
            JsonNode v = stackEntry.get(1);
            if (v.isTextual()) {
                return v.asText();
            }
            if (v.isObject() && v.has("bytes")) {
                return v.get("bytes").asText();
            }
        }
        if (stackEntry.isObject() && stackEntry.has("bytes")) {
            return stackEntry.get("bytes").asText();
        }
        throw new TonRpcException("Cannot read cell/slice value");
    }

    private Mono<UserStakingProfile> readProfile(String key) {
        return stringRedis.opsForValue()
                .get(key)
                .filter(s -> !s.isBlank())
                .flatMap(json -> Mono.fromCallable(() -> objectMapper.readValue(json, UserStakingProfile.class)));
    }

    private Mono<Boolean> writeProfile(String key, UserStakingProfile p) {
        try {
            String json = objectMapper.writeValueAsString(p);
            return stringRedis.opsForValue().set(key, json, USER_PROFILE_TTL).defaultIfEmpty(false);
        } catch (JsonProcessingException e) {
            return Mono.error(new TonRpcException("serialize profile", e));
        }
    }

    private String profileCacheKey(String userAddress) {
        return "ton:staking:profile:" + CACHE_VER + ":" + TonAddressBoc.normalizeKey(userAddress);
    }

    private String lockCacheKey(String stakingMaster) {
        return "ton:staking:lock:" + CACHE_VER + ":" + TonAddressBoc.normalizeKey(stakingMaster);
    }

    private String tierCfgCacheKey(String lockAddress) {
        return "ton:staking:tiercfg:" + CACHE_VER + ":" + TonAddressBoc.normalizeKey(lockAddress);
    }

    private String requireStakingMaster() {
        String m = settings.getAddresses().getStakingMaster();
        if (m == null || m.isBlank()) {
            throw new TonRpcException("app.ton.addresses.staking-master is not configured");
        }
        return m.trim();
    }
}
