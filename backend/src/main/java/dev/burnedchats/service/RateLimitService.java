package dev.burnedchats.service;

import dev.burnedchats.exception.RateLimitException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Duration;

/**
 * Rate limiting service using Redis for distributed rate limiting (5.1.6).
 *
 * <p>Implements sliding window rate limiting per user.
 * Uses Redis for distributed rate limiting across multiple server instances.
 *
 * <p>Rate limits:
 * <ul>
 *   <li>Search: 10 requests per minute</li>
 *   <li>Session create: 3 requests per minute</li>
 *   <li>PoW challenge issuance: 10 requests per minute</li>
 *   <li>Message send: 60 messages per minute</li>
 *   <li>General: 100 requests per minute</li>
 * </ul>
 *
 * @see RateLimitException
 */
@Slf4j
@Service
public class RateLimitService {

    private static final String KEY_PREFIX = "ratelimit:";

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
         * Message send requests.
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
        POW_CHALLENGE(10, Duration.ofMinutes(1));

        private final int maxRequests;
        private final Duration window;

        RateLimitType(int maxRequests, Duration window) {
            this.maxRequests = maxRequests;
            this.window = window;
        }

        public int getMaxRequests() {
            return maxRequests;
        }

        public Duration getWindow() {
            return window;
        }
    }

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public RateLimitService(ReactiveRedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
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
        String key = keyFor(userId, type);

        return redisTemplate.opsForValue()
                .increment(key)
                .flatMap(count -> {
                    // Set expiry on first request
                    if (count == 1) {
                        return redisTemplate.expire(key, type.getWindow())
                                .thenReturn(count);
                    }
                    return Mono.just(count);
                })
                .flatMap(count -> {
                    if (count > type.getMaxRequests()) {
                        LOG.warn("Rate limit exceeded: userId={}, type={}, count={}",
                                userId, type, count);

                        // Calculate retry after
                        return redisTemplate.getExpire(key)
                                .defaultIfEmpty(type.getWindow())
                                .flatMap(ttl -> Mono.error(new RateLimitException(ttl)));
                    }

                    LOG.trace("Rate limit check passed: userId={}, type={}, count={}/{}",
                            userId, type, count, type.getMaxRequests());
                    return Mono.just(true);
                });
    }

    public Mono<Boolean> checkRateLimit(Long userId, RateLimitType type) {
        return checkRateLimit(String.valueOf(userId), type);
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
            throw new RateLimitException(type.getWindow());
        }
    }

    public void checkRateLimitBlocking(Long userId, RateLimitType type) {
        checkRateLimitBlocking(String.valueOf(userId), type);
    }

    /**
     * Get remaining requests for a user.
     *
     * @param userId Telegram user ID
     * @param type   type of rate limit
     * @return remaining requests
     */
    public Mono<Integer> getRemainingRequests(String userId, RateLimitType type) {
        String key = keyFor(userId, type);

        return redisTemplate.opsForValue()
                .get(key)
                .map(Integer::parseInt)
                .defaultIfEmpty(0)
                .map(count -> Math.max(0, type.getMaxRequests() - count));
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
