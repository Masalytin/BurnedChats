package dev.burnedchats.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.UUID;

/**
 * One-time challenges for linking a browser wallet session to a Telegram account (Mini App completes the link).
 */
@Repository
@RequiredArgsConstructor
public class WalletTelegramLinkChallengeStore {

    private static final String PREFIX = "wallet_tg_link:";
    private static final Duration TTL = Duration.ofMinutes(15);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Persist internal id under a fresh random challenge id (32 hex chars).
     */
    public Mono<String> createChallengeForInternalId(String internalId) {
        if (internalId == null || internalId.isBlank()) {
            return Mono.error(new IllegalArgumentException("internalId is required"));
        }
        String id = UUID.randomUUID().toString().replace("-", "");
        String key = PREFIX + id;
        return redisTemplate.opsForValue()
                .set(key, internalId, TTL)
                .flatMap(ok -> Boolean.TRUE.equals(ok)
                        ? Mono.just(id)
                        : Mono.error(new IllegalStateException("Failed to store telegram link challenge")));
    }

    /**
     * Validates and consumes a challenge id, returning the stored internal id.
     */
    public Mono<String> takeInternalId(String challengeId) {
        if (challengeId == null || challengeId.isBlank()) {
            return Mono.empty();
        }
        String trimmed = challengeId.trim().toLowerCase();
        if (!trimmed.matches("[a-f0-9]{32}")) {
            return Mono.empty();
        }
        String key = PREFIX + trimmed;
        return redisTemplate.opsForValue()
                .get(key)
                .flatMap(value -> redisTemplate.delete(key).thenReturn(value));
    }
}
