package dev.burnedchats.service;

import dev.burnedchats.config.RateLimitProperties;
import dev.burnedchats.exception.RateLimitException;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Rate limiting service using Redis for distributed rate limiting (5.1.6).
 *
 * <p>Implements fixed-window rate limiting per user (Lua INCR+EXPIRE).
 * Uses Redis for distributed rate limiting across multiple server instances.
 *
 * <p>Enum defaults are fallbacks; {@link RateLimitType#MESSAGE} and
 * {@link RateLimitType#ROOM_PASSWORD_FAIL} are overridden from
 * {@link RateLimitProperties} at startup (API-12 / SEC-8).
 *
 * @see RateLimitException
 */
@Slf4j
@Service
public class RateLimitService {

    private static final String KEY_PREFIX = "ratelimit:";

    /**
     * Atomic INCR + first-hit EXPIRE for a fixed-window counter.
     *
     * <p>Executed server-side so the increment and the one-time TTL assignment cannot interleave
     * across concurrent "first" requests: only the call that observes {@code count == 1} sets the
     * window expiry, and it does so inside the same atomic Redis evaluation. Returns the post-increment
     * counter value.
     *
     * <p>Held as a constant {@link RedisScript} so Spring caches its SHA-1 and uses {@code EVALSHA}.
     */
    private static final RedisScript<Long> INCREMENT_AND_EXPIRE = RedisScript.of(
            """
            local count = redis.call('INCR', KEYS[1])
            if count == 1 then
              redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            return count
            """,
            Long.class);

    /**
     * Rate limit configurations.
     */
    public enum RateLimitType {
        /**
         * User search requests.
         */
        SEARCH(10, Duration.ofMinutes(1)),

        /**
         * Session creation requests.
         */
        SESSION_CREATE(3, Duration.ofMinutes(1)),

        /**
         * Message send requests — overridden by {@code rate-limit.messages.per-minute}.
         */
        MESSAGE(60, Duration.ofMinutes(1)),

        /**
         * Session accept/reject requests.
         */
        SESSION_ACTION(10, Duration.ofMinutes(1)),

        /**
         * Handshake key exchange.
         */
        HANDSHAKE(10, Duration.ofMinutes(1)),

        /**
         * File upload requests.
         */
        FILE_UPLOAD(10, Duration.ofMinutes(1)),

        /**
         * General rate limit.
         */
        GENERAL(100, Duration.ofMinutes(1)),

        /**
         * Message edit (DM and room) — lower cap than new sends.
         */
        MESSAGE_EDIT(10, Duration.ofMinutes(1)),

        /**
         * Delete for everyone (DM and room).
         */
        MESSAGE_DELETE(30, Duration.ofMinutes(1)),

        /**
         * PoW challenge issuance ({@code /app/pow.challenge}).
         *
         * <p>Separate from gated-action limits; prevents Redis/CPU flood on challenge creation
         * without requiring PoW on the issuance route itself (DESIGN.md §6.1).
         */
        POW_CHALLENGE(10, Duration.ofMinutes(1)),

        /**
         * Room read-only queries ({@code room.getMembers}, {@code room.getPresence},
         * {@code room.getBans}) — separate from {@link #GENERAL} so presence heartbeat
         * and room UI polls do not share one bucket.
         */
        ROOM_READ(30, Duration.ofMinutes(1)),

        /**
         * Failed room-password proof attempts — overridden by
         * {@code rate-limit.room-password-fail.*} (SECURITY.md: 5 / 10 min).
         */
        ROOM_PASSWORD_FAIL(5, Duration.ofMinutes(10)),

        /**
         * Telegram bot {@code inline_query} answers (IMP-TGUX-06).
         * Keyed by Telegram user id; prevents inline-query flood.
         */
        INLINE_QUERY(30, Duration.ofMinutes(1)),

        /**
         * Personal DM invite mint ({@code /app/dmInvite.mint}) — after PoW (IMP-DMINVITE-01).
         */
        DM_INVITE_MINT(3, Duration.ofMinutes(1)),

        /**
         * Personal DM invite redeem ({@code /app/dmInvite.redeem}).
         */
        DM_INVITE_REDEEM(10, Duration.ofMinutes(1));

        private final int defaultMaxRequests;
        private final Duration defaultWindow;

        RateLimitType(int maxRequests, Duration window) {
            this.defaultMaxRequests = maxRequests;
            this.defaultWindow = window;
        }

        public int getMaxRequests() {
            return defaultMaxRequests;
        }

        public Duration getWindow() {
            return defaultWindow;
        }
    }

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final RateLimitProperties rateLimitProperties;
    private final Map<RateLimitType, LimitConfig> overrides = new EnumMap<>(RateLimitType.class);

    public RateLimitService(
            ReactiveRedisTemplate<String, String> redisTemplate,
            RateLimitProperties rateLimitProperties) {
        this.redisTemplate = redisTemplate;
        this.rateLimitProperties = rateLimitProperties;
    }

    /**
     * Apply yaml-backed overrides for MESSAGE and ROOM_PASSWORD_FAIL.
     */
    @PostConstruct
    void applyPropertyOverrides() {
        int messagePerMinute = rateLimitProperties.getMessages().getPerMinute();
        overrides.put(RateLimitType.MESSAGE, new LimitConfig(messagePerMinute, Duration.ofMinutes(1)));

        RateLimitProperties.RoomPasswordFail pwFail = rateLimitProperties.getRoomPasswordFail();
        overrides.put(
                RateLimitType.ROOM_PASSWORD_FAIL,
                new LimitConfig(pwFail.getPerWindow(), Duration.ofSeconds(pwFail.getWindowSeconds())));

        LOG.info("Rate limit overrides: MESSAGE={}/min, ROOM_PASSWORD_FAIL={}/{}s",
                messagePerMinute, pwFail.getPerWindow(), pwFail.getWindowSeconds());
    }

    private LimitConfig resolve(RateLimitType type) {
        LimitConfig override = overrides.get(type);
        if (override != null) {
            return override;
        }
        return new LimitConfig(type.getMaxRequests(), type.getWindow());
    }

    private record LimitConfig(int maxRequests, Duration window) {
    }

    /**
     * Check if a request is allowed under the rate limit.
     *
     * <p>Returns true if allowed, throws RateLimitException if limit exceeded.
     *
     * @param userId   Telegram user ID
     * @param type     type of rate limit to check
     * @return Mono<Boolean> true if allowed
     * @throws RateLimitException if rate limit exceeded
     */
    public Mono<Boolean> checkRateLimit(String userId, RateLimitType type) {
        LimitConfig config = resolve(type);
        String key = keyFor(userId, type);
        String windowSeconds = String.valueOf(config.window().getSeconds());

        return redisTemplate.execute(INCREMENT_AND_EXPIRE, List.of(key), List.of(windowSeconds))
                .next()
                .flatMap(count -> {
                    if (count > config.maxRequests()) {
                        LOG.warn("Rate limit exceeded: userId={}, type={}, count={}",
                                userId, type, count);

                        // Calculate retry after
                        return redisTemplate.getExpire(key)
                                .defaultIfEmpty(config.window())
                                .flatMap(ttl -> Mono.error(new RateLimitException(ttl)));
                    }

                    LOG.trace("Rate limit check passed: userId={}, type={}, count={}/{}",
                            userId, type, count, config.maxRequests());
                    return Mono.just(true);
                });
    }

    public Mono<Boolean> checkRateLimit(Long userId, RateLimitType type) {
        return checkRateLimit(String.valueOf(userId), type);
    }

    /**
     * Enforces rate limit for reactive gate chains (throws via {@link Mono#error}).
     *
     * @param userId internal user id
     * @param type   type of rate limit
     * @return empty Mono when allowed
     */
    public Mono<Void> enforceRateLimit(String userId, RateLimitType type) {
        return checkRateLimit(userId, type).then();
    }

    public Mono<Void> enforceRateLimit(Long userId, RateLimitType type) {
        return enforceRateLimit(String.valueOf(userId), type);
    }

    /**
     * Check rate limit synchronously (blocking).
     *
     * <p>For use in interceptors where reactive doesn't fit well.
     *
     * @param userId Telegram user ID
     * @param type   type of rate limit
     * @throws RateLimitException if rate limit exceeded
     */
    public void checkRateLimitBlocking(String userId, RateLimitType type) {
        Boolean allowed = checkRateLimit(userId, type).block();
        if (!Boolean.TRUE.equals(allowed)) {
            throw new RateLimitException(resolve(type).window());
        }
    }

    public void checkRateLimitBlocking(Long userId, RateLimitType type) {
        checkRateLimitBlocking(String.valueOf(userId), type);
    }

    /**
     * Check a configurable rate limit for REST (or other) surfaces keyed by group + client id.
     *
     * @param group       logical bucket (e.g. {@code auth}, {@code rpc})
     * @param clientId    per-client key (IP, identity, etc.)
     * @param maxRequests maximum requests allowed in the window
     * @param window      sliding window duration
     * @throws RateLimitException if rate limit exceeded
     */
    public void checkRateLimitBlocking(String group, String clientId, int maxRequests, Duration window) {
        Boolean allowed = checkRestRateLimit(group, clientId, maxRequests, window).block();
        if (!Boolean.TRUE.equals(allowed)) {
            throw new RateLimitException(window);
        }
    }

    /**
     * Reactive configurable rate limit for REST surfaces.
     */
    public Mono<Boolean> checkRestRateLimit(String group, String clientId, int maxRequests, Duration window) {
        String key = KEY_PREFIX + "rest:" + group + ":" + clientId;
        String windowSeconds = String.valueOf(window.getSeconds());

        return redisTemplate.execute(INCREMENT_AND_EXPIRE, List.of(key), List.of(windowSeconds))
                .next()
                .flatMap(count -> {
                    if (count > maxRequests) {
                        LOG.warn("REST rate limit exceeded: group={}, clientId={}, count={}",
                                group, clientId, count);
                        return redisTemplate.getExpire(key)
                                .defaultIfEmpty(window)
                                .flatMap(ttl -> Mono.error(new RateLimitException(ttl)));
                    }
                    LOG.trace("REST rate limit check passed: group={}, clientId={}, count={}/{}",
                            group, clientId, count, maxRequests);
                    return Mono.just(true);
                });
    }

    /**
     * Get remaining requests for a user.
     *
     * @param userId Telegram user ID
     * @param type   type of rate limit
     * @return remaining requests
     */
    public Mono<Integer> getRemainingRequests(String userId, RateLimitType type) {
        LimitConfig config = resolve(type);
        String key = keyFor(userId, type);

        return redisTemplate.opsForValue()
                .get(key)
                .map(Integer::parseInt)
                .defaultIfEmpty(0)
                .map(count -> Math.max(0, config.maxRequests() - count));
    }

    public Mono<Integer> getRemainingRequests(Long userId, RateLimitType type) {
        return getRemainingRequests(String.valueOf(userId), type);
    }

    /**
     * Reset rate limit for a user (admin use).
     *
     * @param userId Telegram user ID
     * @param type   type of rate limit
     * @return true if reset
     */
    public Mono<Boolean> resetRateLimit(String userId, RateLimitType type) {
        String key = keyFor(userId, type);

        return redisTemplate.delete(key)
                .map(count -> count > 0)
                .doOnSuccess(reset -> {
                    if (reset) {
                        LOG.info("Rate limit reset: userId={}, type={}", userId, type);
                    }
                });
    }

    public Mono<Boolean> resetRateLimit(Long userId, RateLimitType type) {
        return resetRateLimit(String.valueOf(userId), type);
    }

    private String keyFor(String userId, RateLimitType type) {
        return KEY_PREFIX + type.name().toLowerCase() + ":" + userId;
    }
}
