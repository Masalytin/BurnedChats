package dev.burnedchats.ton;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.model.enums.StakingTier;
import dev.burnedchats.ton.TonConfig.TonSettings;
import dev.burnedchats.ton.dto.StakeInfo;
import dev.burnedchats.ton.dto.TierConfigDto;
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
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Reads staking positions, catalog (lock configs + TVL), and voting power from chain.
 */
@Service
public class StakingVerifier {

    private static final Logger LOG = LoggerFactory.getLogger(StakingVerifier.class);

    private static final String PROFILE_CACHE_VER = "v2";
    private static final String TIERCFG_CACHE_VER = "v2";
    private static final String LOCK_CACHE_VER = "v1";
    private static final String TVL_CACHE_VER = "v2";
    private static final Duration USER_PROFILE_TTL = Duration.ofSeconds(30);
    private static final Duration LOCK_ADDR_TTL = Duration.ofHours(1);
    private static final Duration TIER_CFG_TTL = Duration.ofHours(1);
    private static final Duration TVL_TTL = Duration.ofSeconds(180);
    private static final Duration FRESH_TTL = Duration.ofSeconds(15);

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
                .map(StakingStackCodec::firstStackNum)
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
                .map(StakingStackCodec::firstStackNum)
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
        return Flux.fromIterable(userAddresses)
                .flatMap(this::profileForUser, 5)
                .flatMap(p -> loadCatalog(false).map(c -> p.withCatalog(c.configs(), c.tvls())), 1)
                .onErrorMap(this::wrapRpc);
    }

    /** Single-address convenience wrapper over {@link #getStakingProfiles(List)} (Redis TTL 30 s). */
    public Mono<UserStakingProfile> getStakingProfile(String userAddress) {
        return getStakingProfile(userAddress, false);
    }

    /**
     * User snapshot. {@code fresh} busts profile v2 + computed user get-keys once per 15 s (SET NX).
     */
    public Mono<UserStakingProfile> getStakingProfile(String userAddress, boolean fresh) {
        Mono<Void> prep = fresh ? bustUserCachesIfNx(userAddress) : Mono.empty();
        return prep.then(getStakingProfiles(List.of(userAddress)).next());
    }

    /**
     * Shared lock configs + TVL with empty stakes. Catalog miss after RPC retries → error.
     */
    public Mono<UserStakingProfile> getCatalogSnapshot() {
        return loadCatalog(true)
                .map(cat -> new UserStakingProfile(
                        null,
                        null,
                        BigInteger.ZERO,
                        BigInteger.ZERO,
                        List.of(),
                        cat.configs(),
                        cat.tvls()))
                .onErrorMap(this::wrapRpc);
    }

    private Throwable wrapRpc(Throwable e) {
        return e instanceof TonRpcException ? e : new TonRpcException("TON staking RPC failed", e);
    }

    private Mono<Void> bustUserCachesIfNx(String userAddress) {
        String freshKey = "ton:staking:fresh:" + TonAddressBoc.normalizeKey(userAddress);
        return stringRedis.opsForValue()
                .setIfAbsent(freshKey, "1", FRESH_TTL)
                .defaultIfEmpty(false)
                .flatMap(won -> Boolean.TRUE.equals(won) ? evictUserKeys(userAddress) : Mono.empty());
    }

    private Mono<Void> evictUserKeys(String userAddress) {
        String master = requireStakingMaster();
        List<Mono<Void>> ops = new ArrayList<>();
        ops.add(stringRedis.delete(profileCacheKey(userAddress)).then());
        List<Object> vpArgs = List.of(TonAddressBoc.sliceStackArg(userAddress));
        ops.add(tonService.evict(tonService.cacheKey(master, "get_voting_power", vpArgs)));
        for (StakingTier tier : StakingTier.values()) {
            List<Object> args = List.of(
                    TonAddressBoc.sliceStackArg(userAddress), TonAddressBoc.numStackArg(tier.getId()));
            ops.add(tonService.evict(tonService.cacheKey(master, "get_stake", args)));
            ops.add(tonService.evict(tonService.cacheKey(master, "get_pending_reward", args)));
        }
        return Flux.concat(ops).then();
    }

    private record StakingCatalog(List<TierConfigDto> configs, Map<StakingTier, BigInteger> tvls) {
    }

    private Mono<StakingCatalog> loadCatalog(boolean requireConfigs) {
        return loadTierConfigs(requireConfigs)
                .zipWith(loadTvls())
                .map(t -> new StakingCatalog(t.getT1(), t.getT2()));
    }

    private Mono<List<TierConfigDto>> loadTierConfigs(boolean require) {
        return stakingLockAddress().flatMap(lock -> {
            String redisKey = tierCfgCacheKey(lock);
            return readJson(redisKey, new TypeReference<List<TierConfigDto>>() { })
                    .filter(list -> !list.isEmpty())
                    .switchIfEmpty(fetchTierConfigsIntoRedis(lock, redisKey))
                    .onErrorResume(e -> require
                            ? Mono.error(e instanceof TonRpcException te
                                    ? te : new TonRpcException("tier catalog unavailable", e))
                            : readJson(redisKey, new TypeReference<List<TierConfigDto>>() { })
                                    .defaultIfEmpty(List.of()));
        });
    }

    private Mono<List<TierConfigDto>> fetchTierConfigsIntoRedis(String lock, String redisKey) {
        return Flux.fromArray(StakingTier.values())
                .flatMap(t -> tonService.runGetMethod(
                                lock, "get_lock_config", List.of(TonAddressBoc.numStackArg(t.getId())))
                        .map(r -> StakingStackCodec.parseLockConfig(r, t)), 4)
                .collectList()
                .flatMap(list -> writeJson(redisKey, list, TIER_CFG_TTL).thenReturn(list));
    }

    private Mono<Map<StakingTier, BigInteger>> loadTvls() {
        String master = requireStakingMaster();
        String redisKey = tvlCacheKey(master);
        return readJson(redisKey, new TypeReference<Map<StakingTier, BigInteger>>() { })
                .filter(m -> !m.isEmpty())
                .switchIfEmpty(fetchTvlsIntoRedis(master, redisKey))
                .onErrorResume(e -> {
                    LOG.debug("TVL catalog degraded: {}", e.toString());
                    return readJson(redisKey, new TypeReference<Map<StakingTier, BigInteger>>() { })
                            .defaultIfEmpty(Map.of());
                });
    }

    private Mono<Map<StakingTier, BigInteger>> fetchTvlsIntoRedis(String master, String redisKey) {
        return Flux.fromArray(StakingTier.values())
                .flatMap(t -> tonService.runGetMethod(
                                master, "get_master_total_stake", List.of(TonAddressBoc.numStackArg(t.getId())))
                        .map(r -> Map.entry(t, StakingStackCodec.firstStackNum(r)))
                        .onErrorResume(e -> {
                            LOG.debug("get_master_total_stake {}: {}", t, e.toString());
                            return Mono.empty();
                        }), 4)
                .collectMap(Map.Entry::getKey, Map.Entry::getValue, () -> new EnumMap<>(StakingTier.class))
                .flatMap(m -> {
                    if (m.isEmpty()) {
                        return Mono.just(Map.<StakingTier, BigInteger>of());
                    }
                    return writeJson(redisKey, m, TVL_TTL).thenReturn(Map.copyOf(m));
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
                                    stakes,
                                    List.of(),
                                    Map.of()));
                        })
                        .flatMap(p -> writeProfile(key, p).thenReturn(p)));
    }

    private Mono<Optional<StakeInfo>> loadStake(String master, String userAddress, StakingTier tier) {
        List<Object> args = List.of(TonAddressBoc.sliceStackArg(userAddress), TonAddressBoc.numStackArg(tier.getId()));
        return tonService.runGetMethod(master, "get_stake", args)
                .flatMap(r -> {
                    Optional<StakeInfo> base = StakingStackCodec.parseStake(r, tier);
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

    private Mono<String> stakingLockAddress() {
        String master = requireStakingMaster();
        String key = lockCacheKey(master);
        return stringRedis.opsForValue()
                .get(key)
                .filter(s -> !s.isBlank())
                .switchIfEmpty(Mono.defer(() -> tonService.runGetMethod(master, "get_staking_lock", List.of())
                        .map(StakingStackCodec::extractAddressFromStack)
                        .flatMap(addr -> stringRedis.opsForValue().set(key, addr, LOCK_ADDR_TTL).thenReturn(addr))));
    }

    private Mono<UserStakingProfile> readProfile(String key) {
        return readJson(key, new TypeReference<UserStakingProfile>() { });
    }

    private Mono<Boolean> writeProfile(String key, UserStakingProfile p) {
        return writeJson(key, p, USER_PROFILE_TTL);
    }

    private <T> Mono<T> readJson(String key, TypeReference<T> type) {
        return stringRedis.opsForValue()
                .get(key)
                .filter(s -> !s.isBlank())
                .flatMap(json -> Mono.fromCallable(() -> objectMapper.readValue(json, type))
                        .onErrorResume(e -> {
                            LOG.debug("Ignore corrupt cache {}: {}", key, e.toString());
                            return Mono.empty();
                        }));
    }

    private Mono<Boolean> writeJson(String key, Object value, Duration ttl) {
        try {
            String json = objectMapper.writeValueAsString(value);
            return stringRedis.opsForValue().set(key, json, ttl).defaultIfEmpty(false);
        } catch (JsonProcessingException e) {
            return Mono.error(new TonRpcException("serialize staking cache", e));
        }
    }

    private String profileCacheKey(String userAddress) {
        return "ton:staking:profile:" + PROFILE_CACHE_VER + ":" + TonAddressBoc.normalizeKey(userAddress);
    }

    private String lockCacheKey(String stakingMaster) {
        return "ton:staking:lock:" + LOCK_CACHE_VER + ":" + TonAddressBoc.normalizeKey(stakingMaster);
    }

    private String tierCfgCacheKey(String lockAddress) {
        return "ton:staking:tiercfg:" + TIERCFG_CACHE_VER + ":" + TonAddressBoc.normalizeKey(lockAddress);
    }

    private String tvlCacheKey(String stakingMaster) {
        return "ton:staking:tvl:" + TVL_CACHE_VER + ":" + TonAddressBoc.normalizeKey(stakingMaster);
    }

    private String requireStakingMaster() {
        String m = settings.getAddresses().getStakingMaster();
        if (m == null || m.isBlank()) {
            throw new TonRpcException("app.ton.addresses.staking-master is not configured");
        }
        return m.trim();
    }
}
