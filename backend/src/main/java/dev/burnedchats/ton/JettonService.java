package dev.burnedchats.ton;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.ton.TonConfig.TonSettings;
import dev.burnedchats.ton.dto.EffectiveFeeParams;
import dev.burnedchats.ton.dto.JettonInfo;
import dev.burnedchats.ton.dto.UserBalance;
import dev.burnedchats.ton.exception.TonContractException;
import dev.burnedchats.ton.exception.TonRpcException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Jetton (BURN) balance reads and long-lived master metadata via Ton Center.
 */
@Service
public class JettonService {

    private static final Logger LOG = LoggerFactory.getLogger(JettonService.class);

    private static final Duration BALANCE_TTL = Duration.ofSeconds(30);
    private static final Duration JETTON_INFO_TTL = Duration.ofHours(1);
    private static final Duration FEE_PARAMS_TTL = Duration.ofMinutes(5);

    private static final int BALANCE_DECIMALS = 9;
    private static final String CACHE_VER = "v1";

    private final TonService tonService;
    private final TonSettings settings;
    private final ReactiveRedisTemplate<String, String> stringRedis;
    private final ObjectMapper objectMapper;

    public JettonService(
            TonService tonService,
            TonSettings settings,
            ReactiveRedisTemplate<String, String> stringRedis,
            ObjectMapper objectMapper) {
        this.tonService = tonService;
        this.settings = settings;
        this.stringRedis = stringRedis;
        this.objectMapper = objectMapper;
    }

    public Mono<BigInteger> getBurnBalance(String userAddress) {
        String key = balanceCacheKey(userAddress);
        return readCache(key)
                .flatMap(json -> Mono.fromCallable(() -> new BigInteger(json)))
                .switchIfEmpty(Mono.defer(() -> fetchBurnBalanceNano(userAddress)
                        .flatMap(v -> writeCache(key, v.toString(), BALANCE_TTL).thenReturn(v))));
    }

    public Mono<BigDecimal> getBurnBalanceFormatted(String userAddress) {
        return getBurnBalance(userAddress).map(this::toBurnDecimal);
    }

    public Mono<JettonInfo> getJettonInfo() {
        String master = requireJettonMaster();
        String key = jettonInfoCacheKey(master);
        return readCache(key)
                .flatMap(json -> Mono.fromCallable(() -> objectMapper.readValue(json, JettonInfo.class)))
                .switchIfEmpty(Mono.defer(() -> tonService.runGetMethod(master, "get_jetton_data", List.of())
                        .map(this::parseJettonInfo)
                        .flatMap(v -> Mono.fromCallable(() -> objectMapper.writeValueAsString(v))
                                .flatMap(json -> writeCache(key, json, JETTON_INFO_TTL).thenReturn(v))
                                .onErrorMap(JsonProcessingException.class,
                                        e -> new TonRpcException("serialize JettonInfo", e)))));
    }

    /**
     * Master {@code get_is_excluded} for a TEP-74 owner. Cached via {@link TonService}
     * ({@code ton:rpc} TTL). True when the stack bool is TVM {@code -1}.
     */
    public Mono<Boolean> isExcluded(String ownerAddress) {
        String master = requireJettonMaster();
        List<Object> args = List.of(TonAddressBoc.sliceStackArg(ownerAddress));
        return tonService.runGetMethod(master, "get_is_excluded", args).map(this::parseExcludedBool);
    }

    /**
     * Either side on the master excluded list → on-chain excluded transfer (no fee-split).
     * Omitting {@code recipientAddress} checks the sender only.
     */
    public Mono<Boolean> isExcludedTransfer(String senderAddress, String recipientAddress) {
        return isExcluded(senderAddress).flatMap(senderExcluded -> {
            if (Boolean.TRUE.equals(senderExcluded)) {
                return Mono.just(true);
            }
            if (recipientAddress == null || recipientAddress.isBlank()) {
                return Mono.just(false);
            }
            return isExcluded(recipientAddress);
        });
    }

    public Mono<EffectiveFeeParams> getEffectiveFeeParams() {
        String master = requireJettonMaster();
        String key = feeParamsCacheKey(master);
        return readCache(key)
                .flatMap(json -> Mono.fromCallable(() -> objectMapper.readValue(json, EffectiveFeeParams.class)))
                .switchIfEmpty(Mono.defer(() -> tonService
                        .runGetMethod(master, "get_effective_fee_params", List.of())
                        .map(this::parseEffectiveFees)
                        .flatMap(v -> Mono.fromCallable(() -> objectMapper.writeValueAsString(v))
                                .flatMap(json -> writeCache(key, json, FEE_PARAMS_TTL).thenReturn(v))
                                .onErrorMap(JsonProcessingException.class,
                                        e -> new TonRpcException("serialize EffectiveFeeParams", e)))));
    }

    public Flux<UserBalance> getBurnBalances(List<String> userAddresses) {
        if (userAddresses == null || userAddresses.isEmpty()) {
            return Flux.empty();
        }
        return Flux.fromIterable(userAddresses)
                .flatMap(addr -> getBurnBalance(addr)
                        .map(nano -> new UserBalance(
                                TonAddressBoc.normalizeKey(addr),
                                nano,
                                toBurnDecimal(nano))),
                        5);
    }

    /**
     * Resolves the owner's BURN jetton wallet address via master {@code get_wallet_address}.
     * Empty mono means no wallet (undeployed / zero address / non-zero contract exit).
     * {@link TonRpcException} is propagated for RPC / transport failures.
     */
    public Mono<String> resolveJettonWallet(String userAddress) {
        return getUserJettonWalletAddress(userAddress)
                .filter(this::isNonZeroJettonWallet)
                .onErrorResume(TonContractException.class, e -> {
                    LOG.debug("resolveJettonWallet contract exit → absent: {}", e.toString());
                    return Mono.empty();
                });
    }

    private boolean isNonZeroJettonWallet(String raw) {
        if (raw == null || raw.isBlank()) {
            return false;
        }
        try {
            TonAddressBoc.ParsedAddress p = TonAddressBoc.parse(raw.trim());
            return p.workchain() != 0 || !isAllZero(p.hash());
        } catch (TonRpcException e) {
            LOG.debug("resolveJettonWallet unparseable address → absent: {}", e.getMessage());
            return false;
        }
    }

    private static boolean isAllZero(byte[] hash) {
        for (byte b : hash) {
            if (b != 0) {
                return false;
            }
        }
        return true;
    }

    private Mono<BigInteger> fetchBurnBalanceNano(String userAddress) {
        return getUserJettonWalletAddress(userAddress)
                .flatMap(walletAddr -> tonService.runGetMethod(walletAddr, "get_wallet_data", List.of()))
                .map(this::extractWalletBalance)
                .onErrorResume(this::balanceFallbackZero);
    }

    private Mono<String> getUserJettonWalletAddress(String userAddress) {
        String master = requireJettonMaster();
        List<Object> args = List.of(TonAddressBoc.sliceStackArg(userAddress));
        return tonService.runGetMethod(master, "get_wallet_address", args).map(this::extractAddress);
    }

    private BigInteger extractWalletBalance(JsonNode result) {
        JsonNode stack = stackList(result);
        if (stack == null || stack.size() < 1) {
            return BigInteger.ZERO;
        }
        return parseNum(stack.get(0));
    }

    private JettonInfo parseJettonInfo(JsonNode result) {
        List<JsonNode> flat = flattenStack(result);
        if (flat.size() < 5) {
            throw new TonRpcException("get_jetton_data: stack too small");
        }
        BigInteger total = parseNum(flat.get(0));
        boolean mint = parseNum(flat.get(1)).compareTo(BigInteger.ZERO) != 0;
        // REST DTO is circulatingNano + mintable; admin/code must not fail the snapshot.
        String admin = decodeAdminOrEmpty(flat.get(2));
        String codeB64 = decodeWalletCodeOrEmpty(flat.get(4));
        return new JettonInfo(total, mint, admin, codeB64, "");
    }

    private boolean parseExcludedBool(JsonNode result) {
        List<JsonNode> flat = flattenStack(result);
        if (flat.isEmpty()) {
            return false;
        }
        BigInteger n = parseNum(flat.get(0));
        if (n.equals(BigInteger.ONE.negate())) {
            return true;
        }
        BigInteger mask64 = BigInteger.ONE.shiftLeft(64).subtract(BigInteger.ONE);
        return n.and(mask64).equals(mask64);
    }

    private EffectiveFeeParams parseEffectiveFees(JsonNode result) {
        List<JsonNode> flat = flattenStack(result);
        if (flat.size() < 3) {
            throw new TonRpcException("get_effective_fee_params: stack too small");
        }
        int burn = parseNum(flat.get(0)).intValueExact();
        int stake = parseNum(flat.get(1)).intValueExact();
        int treas = parseNum(flat.get(2)).intValueExact();
        return new EffectiveFeeParams(burn, stake, treas);
    }

    private String extractAddress(JsonNode result) {
        JsonNode stack = stackList(result);
        if (stack == null || stack.size() < 1) {
            throw new TonRpcException("get_wallet_address: empty stack");
        }
        return TonAddressBoc.decodeRawAddressFromSingleRootBoc(cellBase64(stack.get(0)));
    }

    private BigDecimal toBurnDecimal(BigInteger nano) {
        return new BigDecimal(nano)
                .movePointLeft(BALANCE_DECIMALS)
                .setScale(BALANCE_DECIMALS, RoundingMode.UNNECESSARY);
    }

    private Mono<BigInteger> balanceFallbackZero(Throwable e) {
        if (e instanceof TonContractException) {
            LOG.debug("getBurnBalance contract exit → 0: {}", e.toString());
            return Mono.just(BigInteger.ZERO);
        }
        LOG.debug("getBurnBalance error → 0: {}", e.toString());
        return Mono.just(BigInteger.ZERO);
    }

    private List<JsonNode> flattenStack(JsonNode result) {
        JsonNode stack = stackList(result);
        if (stack == null) {
            return List.of();
        }
        if (stack.size() == 1 && stack.get(0).isArray()) {
            JsonNode sole = stack.get(0);
            if (sole.size() >= 2 && "tuple".equalsIgnoreCase(textAt(sole, 0))) {
                JsonNode tuple = sole.get(1);
                List<JsonNode> out = new ArrayList<>();
                if (tuple != null && tuple.isArray()) {
                    for (JsonNode n : tuple) {
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

    private JsonNode stackList(JsonNode result) {
        JsonNode stack = result.get("stack");
        if (stack != null && stack.isArray()) {
            return stack;
        }
        return null;
    }

    private BigInteger parseNum(JsonNode item) {
        return TonCenterStack.parseNum(item);
    }

    private String decodeAdminOrEmpty(JsonNode stackEntry) {
        try {
            return TonAddressBoc.decodeRawAddressFromSingleRootBoc(cellBase64(stackEntry));
        } catch (RuntimeException e) {
            LOG.warn("get_jetton_data: admin cell skipped: {}", e.toString());
            return "";
        }
    }

    private String decodeWalletCodeOrEmpty(JsonNode stackEntry) {
        try {
            return cellBase64(stackEntry);
        } catch (RuntimeException e) {
            LOG.warn("get_jetton_data: wallet code skipped: {}", e.toString());
            return "";
        }
    }

    private String cellBase64(JsonNode stackEntry) {
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
        throw new TonRpcException("Cannot read cell/slice payload");
    }

    private String textAt(JsonNode arr, int i) {
        return arr.get(i).asText("");
    }

    private Mono<String> readCache(String key) {
        return stringRedis.opsForValue()
                .get(key)
                .filter(s -> s != null && !s.isBlank())
                .doOnNext(ignored -> LOG.trace("jetton cache hit {}", key));
    }

    private Mono<Boolean> writeCache(String key, String json, Duration ttl) {
        if (ttl.isZero() || ttl.isNegative()) {
            return Mono.just(true);
        }
        return stringRedis.opsForValue().set(key, json, ttl).defaultIfEmpty(false);
    }

    private String balanceCacheKey(String userAddress) {
        return "ton:jetton:balance:" + CACHE_VER + ":" + TonAddressBoc.normalizeKey(userAddress);
    }

    private String jettonInfoCacheKey(String jettonMaster) {
        return "ton:jetton:info:" + CACHE_VER + ":" + TonAddressBoc.normalizeKey(jettonMaster);
    }

    private String feeParamsCacheKey(String jettonMaster) {
        return "ton:jetton:fees:" + CACHE_VER + ":" + TonAddressBoc.normalizeKey(jettonMaster);
    }

    private String requireJettonMaster() {
        String m = settings.getAddresses().getJettonMaster();
        if (m == null || m.isBlank()) {
            throw new TonRpcException("app.ton.addresses.jetton-master is not configured");
        }
        return m.trim();
    }
}
