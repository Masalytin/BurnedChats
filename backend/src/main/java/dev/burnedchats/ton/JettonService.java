package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.JsonNode;
import dev.burnedchats.ton.TonConfig.TonSettings;
import dev.burnedchats.ton.exception.TonContractException;
import dev.burnedchats.ton.exception.TonRpcException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.math.BigInteger;
import java.time.Duration;
import java.util.List;

/**
 * Jetton (BURN) balance reads and jetton-wallet resolve via Ton Center.
 */
@Service
public class JettonService {

    private static final Logger LOG = LoggerFactory.getLogger(JettonService.class);

    private static final Duration BALANCE_TTL = Duration.ofSeconds(30);
    private static final String CACHE_VER = "v1";

    private final TonService tonService;
    private final TonSettings settings;
    private final ReactiveRedisTemplate<String, String> stringRedis;

    public JettonService(
            TonService tonService,
            TonSettings settings,
            ReactiveRedisTemplate<String, String> stringRedis) {
        this.tonService = tonService;
        this.settings = settings;
        this.stringRedis = stringRedis;
    }

    public Mono<BigInteger> getBurnBalance(String userAddress) {
        String key = balanceCacheKey(userAddress);
        return readCache(key)
                .flatMap(json -> Mono.fromCallable(() -> new BigInteger(json)))
                .switchIfEmpty(Mono.defer(() -> fetchBurnBalanceNano(userAddress)
                        .flatMap(v -> writeCache(key, v.toString(), BALANCE_TTL).thenReturn(v))));
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

    private String extractAddress(JsonNode result) {
        JsonNode stack = stackList(result);
        if (stack == null || stack.size() < 1) {
            throw new TonRpcException("get_wallet_address: empty stack");
        }
        return TonAddressBoc.decodeRawAddressFromSingleRootBoc(cellBase64(stack.get(0)));
    }

    private Mono<BigInteger> balanceFallbackZero(Throwable e) {
        if (e instanceof TonContractException) {
            LOG.debug("getBurnBalance contract exit → 0: {}", e.toString());
            return Mono.just(BigInteger.ZERO);
        }
        LOG.debug("getBurnBalance error → 0: {}", e.toString());
        return Mono.just(BigInteger.ZERO);
    }

    private JsonNode stackList(JsonNode result) {
        JsonNode stack = result.get("stack");
        if (stack != null && stack.isArray()) {
            return stack;
        }
        return null;
    }

    private BigInteger parseNum(JsonNode item) {
        String raw = valueText(item);
        if (raw.startsWith("0x") || raw.startsWith("0X")) {
            return new BigInteger(raw.substring(2), 16);
        }
        return new BigInteger(raw);
    }

    private String valueText(JsonNode stackEntry) {
        if (stackEntry.isArray() && stackEntry.size() >= 2) {
            return stackEntry.get(1).asText();
        }
        if (stackEntry.has("value")) {
            return stackEntry.get("value").asText();
        }
        throw new TonRpcException("Cannot read stack num value");
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

    private String requireJettonMaster() {
        String m = settings.getAddresses().getJettonMaster();
        if (m == null || m.isBlank()) {
            throw new TonRpcException("app.ton.addresses.jetton-master is not configured");
        }
        return m.trim();
    }
}
