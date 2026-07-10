package dev.burnedchats.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Set;

/**
 * Redis storage for the dead man's switch: trigger key with TTL plus a config companion key.
 */
@Repository
public class DeadmanRepository {

    private static final Logger LOG = LoggerFactory.getLogger(DeadmanRepository.class);

    public static final String TRIGGER_PREFIX = "user:deadman:";
    public static final String CFG_PREFIX = "user:deadman:cfg:";
    public static final Set<Integer> ALLOWED_PERIOD_DAYS = Set.of(7, 30, 90);

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;

    public DeadmanRepository(ReactiveRedisTemplate<String, String> redisTemplate,
            ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    public record DeadmanConfig(int periodDays, boolean wipeIdentity) {
    }

    public record DeadmanState(
            boolean enabled,
            Integer periodDays,
            boolean wipeIdentity,
            Long expiresAt) {
    }

    public Mono<DeadmanState> enable(String internalId, DeadmanConfig config) {
        if (!ALLOWED_PERIOD_DAYS.contains(config.periodDays())) {
            return Mono.error(new IllegalArgumentException("INVALID_DEADMAN_PERIOD"));
        }
        Duration ttl = Duration.ofDays(config.periodDays());
        String cfgKey = cfgKeyFor(internalId);
        String triggerKey = triggerKeyFor(internalId);
        return serializeConfig(config)
                .flatMap(json -> redisTemplate.opsForValue().set(cfgKey, json))
                .then(redisTemplate.opsForValue().set(triggerKey, internalId, ttl))
                .then(buildEnabledState(internalId, config));
    }

    public Mono<DeadmanState> disable(String internalId) {
        return redisTemplate.delete(cfgKeyFor(internalId))
                .then(redisTemplate.delete(triggerKeyFor(internalId)))
                .thenReturn(disabledState());
    }

    public Mono<Boolean> refreshOnActivity(String internalId) {
        return getConfig(internalId)
                .flatMap(config -> redisTemplate.hasKey(triggerKeyFor(internalId))
                        .flatMap(exists -> {
                            if (!Boolean.TRUE.equals(exists)) {
                                return Mono.just(false);
                            }
                            Duration ttl = Duration.ofDays(config.periodDays());
                            return redisTemplate.opsForValue()
                                    .set(triggerKeyFor(internalId), internalId, ttl)
                                    .defaultIfEmpty(false);
                        }))
                .defaultIfEmpty(false);
    }

    public Mono<DeadmanState> getState(String internalId) {
        return getConfig(internalId)
                .flatMap(config -> buildEnabledState(internalId, config))
                .defaultIfEmpty(disabledState());
    }

    public Mono<DeadmanConfig> getConfig(String internalId) {
        return redisTemplate.opsForValue()
                .get(cfgKeyFor(internalId))
                .flatMap(this::deserializeConfig);
    }

    public Mono<Long> clearConfig(String internalId) {
        return redisTemplate.delete(cfgKeyFor(internalId));
    }

    public static boolean isDeadmanTriggerKey(String key) {
        return key != null
                && key.startsWith(TRIGGER_PREFIX)
                && !key.startsWith(CFG_PREFIX);
    }

    public static String parseInternalIdFromDeadmanTriggerKey(String key) {
        if (!isDeadmanTriggerKey(key)) {
            return null;
        }
        return key.substring(TRIGGER_PREFIX.length());
    }

    private Mono<DeadmanState> buildEnabledState(String internalId, DeadmanConfig config) {
        return redisTemplate.getExpire(triggerKeyFor(internalId))
                .map(ttl -> {
                    Long expiresAt = null;
                    if (ttl != null && !ttl.isZero() && !ttl.isNegative()) {
                        expiresAt = System.currentTimeMillis() + ttl.toMillis();
                    }
                    return new DeadmanState(true, config.periodDays(), config.wipeIdentity(), expiresAt);
                })
                .defaultIfEmpty(new DeadmanState(
                        true, config.periodDays(), config.wipeIdentity(), null));
    }

    private static DeadmanState disabledState() {
        return new DeadmanState(false, null, false, null);
    }

    private Mono<String> serializeConfig(DeadmanConfig config) {
        return Mono.fromCallable(() -> objectMapper.writeValueAsString(config))
                .onErrorMap(JsonProcessingException.class,
                        e -> new IllegalStateException("Failed to serialize deadman config", e));
    }

    private Mono<DeadmanConfig> deserializeConfig(String json) {
        return Mono.fromCallable(() -> objectMapper.readValue(json, DeadmanConfig.class))
                .onErrorResume(JsonProcessingException.class, e -> {
                    LOG.warn("Invalid deadman config JSON: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    private static String triggerKeyFor(String internalId) {
        return TRIGGER_PREFIX + internalId;
    }

    private static String cfgKeyFor(String internalId) {
        return CFG_PREFIX + internalId;
    }
}
