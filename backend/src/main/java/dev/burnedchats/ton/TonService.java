package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.burnedchats.ton.TonConfig.TonSettings;
import dev.burnedchats.ton.dto.TransactionDto;
import dev.burnedchats.ton.exception.TonContractException;
import dev.burnedchats.ton.exception.TonRpcException;
import io.micrometer.core.instrument.MeterRegistry;
import io.netty.handler.timeout.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;

/**
 * Reactive Ton Center v2 HTTP client with Redis caching for stable reads.
 */
@Service
public class TonService {

    private static final Logger LOG = LoggerFactory.getLogger(TonService.class);

    private static final String METRIC_REQUESTS = "burnedchats.ton.rpc.requests";
    private static final String METRIC_ERRORS = "burnedchats.ton.rpc.errors";
    private static final String METRIC_CACHE_HITS = "burnedchats.ton.rpc.cache_hits";
    private static final String TAG_OPERATION = "operation";

    private final WebClient tonWebClient;
    private final TonSettings settings;
    private final ReactiveRedisTemplate<String, String> stringRedis;
    private final ObjectMapper objectMapper;
    private final MeterRegistry meterRegistry;

    public TonService(
            @Qualifier("tonWebClient") WebClient tonWebClient,
            TonSettings settings,
            ReactiveRedisTemplate<String, String> stringRedis,
            ObjectMapper objectMapper,
            MeterRegistry meterRegistry) {
        this.tonWebClient = tonWebClient;
        this.settings = settings;
        this.stringRedis = stringRedis;
        this.objectMapper = objectMapper;
        this.meterRegistry = meterRegistry;
    }

    /**
     * Run a get-method on a contract via {@code POST /runGetMethod}.
     *
     * @param contractAddress Ton address (raw or user-friendly)
     * @param method          method name or id accepted by Ton Center
     * @param args            stack args; each element is a {@link List} of two values {@code [type, value]},
     *                        or a map with keys {@code type} and {@code value} (Ton Center legacy stack)
     */
    public Mono<JsonNode> runGetMethod(String contractAddress, String method, List<Object> args) {
        String addr = normalizeAddress(contractAddress);
        String argsHash = hashArgs(args);
        String cacheKey = cacheKey(addr, method, argsHash);
        Duration cacheTtl = cacheTtl();

        return readFromCache(cacheKey, "runGetMethod")
                .switchIfEmpty(Mono.defer(() -> postRunGetMethod(addr, method, args)
                        .flatMap(result -> writeCache(cacheKey, result, cacheTtl).then(Mono.just(result)))));
    }

    /**
     * Account state and balance via {@code GET /getAddressInformation}.
     */
    public Mono<JsonNode> getAccount(String address) {
        String addr = normalizeAddress(address);
        String cacheKey = cacheKey(addr, "account", "-");
        Duration cacheTtl = cacheTtl();

        return readFromCache(cacheKey, "getAccount")
                .switchIfEmpty(Mono.defer(() -> fetchAddressInformation(addr)
                        .flatMap(result -> writeCache(cacheKey, result, cacheTtl).then(Mono.just(result)))));
    }

    /**
     * Transaction history via {@code GET /getTransactions} (not Redis-cached).
     */
    public Flux<TransactionDto> getTransactions(String address, int limit) {
        String addr = normalizeAddress(address);
        int safeLimit = Math.max(1, Math.min(limit, 100));
        recordRequest("getTransactions");
        long startNs = System.nanoTime();
        Mono<List<TransactionDto>> listMono = fetchTransactions(addr, safeLimit)
                .doOnSuccess(block -> LOG.debug("getTransactions address={} count={} latencyMs={}",
                        addr, block.size(), latencyMs(startNs)));
        return listMono.flatMapMany(Flux::fromIterable);
    }

    private Mono<JsonNode> readFromCache(String cacheKey, String operation) {
        return stringRedis.opsForValue()
                .get(cacheKey)
                .filter(json -> json != null && !json.isBlank())
                .flatMap(json -> Mono.fromCallable(() -> objectMapper.readTree(json))
                        .doOnSuccess(ignored -> recordCacheHit(operation)))
                .onErrorResume(e -> {
                    LOG.debug("TON cache read skipped for {}: {}", cacheKey, e.toString());
                    return Mono.empty();
                });
    }

    private Mono<Void> writeCache(String cacheKey, JsonNode result, Duration ttl) {
        if (ttl.isZero() || ttl.isNegative()) {
            return Mono.empty();
        }
        try {
            String json = objectMapper.writeValueAsString(result);
            return stringRedis.opsForValue()
                    .set(cacheKey, json, ttl)
                    .then()
                    .onErrorResume(e -> {
                        LOG.warn("TON cache write failed for {}: {}", cacheKey, e.toString());
                        return Mono.empty();
                    });
        } catch (IOException e) {
            return Mono.error(new TonRpcException("serialize TON cache value", e));
        }
    }

    private Mono<JsonNode> postRunGetMethod(String address, String method, List<Object> args) {
        long startNs = System.nanoTime();
        recordRequest("runGetMethod");
        ArrayNode stack = buildStackPayload(args);
        ObjectNode body = objectMapper.createObjectNode();
        body.put("address", address);
        body.set("method", objectMapper.valueToTree(method));
        body.set("stack", stack);

        Mono<String> response = tonWebClient.post()
                .uri("/runGetMethod")
                .contentType(MediaType.APPLICATION_JSON)
                .body(BodyInserters.fromValue(body))
                .retrieve()
                .bodyToMono(String.class)
                .transform(m -> withRetry(m, "runGetMethod"))
                .doOnSuccess(s -> LOG.debug("runGetMethod address={} method={} stackSize={} latencyMs={}",
                        address, method, stack.size(), latencyMs(startNs)));

        return response.flatMap(raw -> parseTonResult(raw, "runGetMethod"))
                .flatMap(this::ensureSuccessfulGetMethod)
                .doOnError(e -> recordError("runGetMethod"));
    }

    private Mono<JsonNode> fetchAddressInformation(String address) {
        long startNs = System.nanoTime();
        recordRequest("getAccount");
        Mono<String> response = tonWebClient.get()
                .uri(uriBuilder -> uriBuilder.path("/getAddressInformation").queryParam("address", address).build())
                .retrieve()
                .bodyToMono(String.class)
                .transform(m -> withRetry(m, "getAccount"))
                .doOnSuccess(s -> LOG.debug("getAddressInformation address={} latencyMs={}",
                        address, latencyMs(startNs)));

        return response.flatMap(raw -> parseTonResult(raw, "getAddressInformation"))
                .doOnError(e -> recordError("getAccount"));
    }

    private Mono<List<TransactionDto>> fetchTransactions(String address, int limit) {
        return tonWebClient.get()
                .uri(uriBuilder -> uriBuilder.path("/getTransactions")
                        .queryParam("address", address)
                        .queryParam("limit", limit)
                        .build())
                .retrieve()
                .bodyToMono(String.class)
                .transform(m -> withRetry(m, "getTransactions"))
                .flatMap(raw -> parseTonResultArray(raw, "getTransactions"))
                .doOnError(e -> recordError("getTransactions"));
    }

    private <T> Mono<T> withRetry(Mono<T> mono, String op) {
        int extraTries = Math.max(0, settings.getRpc().getRetryAttempts() - 1);
        if (extraTries == 0) {
            return mono;
        }
        return mono.retryWhen(Retry.fixedDelay(extraTries, Duration.ofMillis(250))
                .filter(this::isRetryable)
                .doBeforeRetry(sig -> LOG.warn("TON RPC retry op={} cause={}", op, sig.failure().toString())));
    }

    private boolean isRetryable(Throwable t) {
        Throwable e = unwrap(t);
        if (e instanceof WebClientResponseException ex) {
            int code = ex.getStatusCode().value();
            return code >= 500 || code == 429;
        }
        if (e instanceof WebClientRequestException) {
            return true;
        }
        if (e instanceof TimeoutException || e instanceof java.util.concurrent.TimeoutException) {
            return true;
        }
        return e instanceof IOException;
    }

    private static Throwable unwrap(Throwable t) {
        Throwable c = t;
        while (c != null && c.getCause() != null && c != c.getCause()) {
            if (c instanceof WebClientResponseException || c instanceof WebClientRequestException) {
                break;
            }
            if (c instanceof TimeoutException || c instanceof java.util.concurrent.TimeoutException) {
                break;
            }
            if (c instanceof IOException) {
                break;
            }
            c = c.getCause();
        }
        return c == null ? t : c;
    }

    private Mono<JsonNode> parseTonResult(String body, String operation) {
        return Mono.fromCallable(() -> {
            JsonNode root = objectMapper.readTree(body);
            if (!root.path("ok").asBoolean(false)) {
                String err = root.has("error") ? root.get("error").toString() : body;
                throw new TonRpcException(operation + " Ton Center error: " + err);
            }
            JsonNode result = root.get("result");
            if (result == null || result.isNull()) {
                throw new TonRpcException(operation + " missing result");
            }
            return result;
        });
    }

    private Mono<List<TransactionDto>> parseTonResultArray(String body, String operation) {
        return parseTonResult(body, operation).map(result -> {
            if (!result.isArray()) {
                return List.<TransactionDto>of();
            }
            java.util.ArrayList<TransactionDto> out = new java.util.ArrayList<>(result.size());
            for (JsonNode n : result) {
                out.add(mapTransaction(n));
            }
            return List.copyOf(out);
        });
    }

    private Mono<JsonNode> ensureSuccessfulGetMethod(JsonNode result) {
        int exit = result.path("exit_code").asInt(0);
        if (exit != 0) {
            return Mono.error(new TonContractException("get-method exit_code=" + exit, exit));
        }
        return Mono.just(result);
    }

    private TransactionDto mapTransaction(JsonNode n) {
        String account = n.path("account").asText(null);
        Long utime = n.has("utime") && n.get("utime").canConvertToLong() ? n.get("utime").longValue() : null;
        JsonNode txId = n.get("transaction_id");
        String lt = txId != null ? txId.path("lt").asText(null) : null;
        String hash = txId != null ? txId.path("hash").asText(null) : null;
        return new TransactionDto(account, utime, lt, hash, n);
    }

    private ArrayNode buildStackPayload(List<Object> args) {
        ArrayNode stack = objectMapper.createArrayNode();
        if (args == null || args.isEmpty()) {
            return stack;
        }
        for (Object arg : args) {
            stack.add(normalizeStackEntry(arg));
        }
        return stack;
    }

    private ArrayNode normalizeStackEntry(Object arg) {
        if (arg instanceof List<?> list && list.size() == 2) {
            ArrayNode pair = objectMapper.createArrayNode();
            pair.add(objectMapper.valueToTree(list.get(0)));
            pair.add(objectMapper.valueToTree(list.get(1)));
            return pair;
        }
        if (arg instanceof java.util.Map<?, ?> map) {
            Object type = map.get("type");
            Object value = map.get("value");
            if (type != null && value != null) {
                ArrayNode pair = objectMapper.createArrayNode();
                pair.add(objectMapper.valueToTree(type));
                pair.add(objectMapper.valueToTree(value));
                return pair;
            }
        }
        throw new TonRpcException("Invalid runGetMethod stack arg; use [type, value] list or map type/value");
    }

    private String cacheKey(String address, String method, String argsHash) {
        return "ton:rpc:" + address + ":" + method + ":" + argsHash;
    }

    private String normalizeAddress(String address) {
        Objects.requireNonNull(address, "address");
        return address.trim();
    }

    private Duration cacheTtl() {
        return Duration.ofSeconds(Math.max(0, settings.getCache().getTtlSeconds()));
    }

    private String hashArgs(List<Object> args) {
        try {
            byte[] json = objectMapper.writeValueAsBytes(args == null ? List.of() : args);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(json));
        } catch (IOException | NoSuchAlgorithmException e) {
            throw new TonRpcException("Failed to hash TON get-method args", e);
        }
    }

    private void recordRequest(String operation) {
        meterRegistry.counter(METRIC_REQUESTS, TAG_OPERATION, operation).increment();
    }

    private void recordError(String operation) {
        meterRegistry.counter(METRIC_ERRORS, TAG_OPERATION, operation).increment();
    }

    private void recordCacheHit(String operation) {
        meterRegistry.counter(METRIC_CACHE_HITS, TAG_OPERATION, operation).increment();
    }

    private static long latencyMs(long startNs) {
        return (System.nanoTime() - startNs) / 1_000_000L;
    }
}
