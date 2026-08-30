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
     * Reads the stored internal id without deleting the challenge.
     */
    public Mono<String> peekInternalId(String challengeId) {
        String key = challengeKey(challengeId);
        if (key == null) {
            return Mono.empty();
        }
        return redisTemplate.opsForValue().get(key);
    }

    /**
     * Deletes a challenge after a successful telegram link.
     */
    public Mono<Void> consume(String challengeId) {
        String key = challengeKey(challengeId);
        if (key == null) {
            return Mono.empty();
        }
        return redisTemplate.delete(key).then();
    }

    /**
     * Validates and consumes a challenge id, returning the stored internal id.
     * Prefer {@link #peekInternalId} then {@link #consume} so a failed link can retry.
     */
    public Mono<String> takeInternalId(String challengeId) {
        return peekInternalId(challengeId)
                .flatMap(value -> consume(challengeId).thenReturn(value));
    }

    private static String challengeKey(String challengeId) {
        if (challengeId == null || challengeId.isBlank()) {
            return null;
        }
        String trimmed = challengeId.trim().toLowerCase();
        if (!trimmed.matches("[a-f0-9]{32}")) {
            return null;
        }
        return PREFIX + trimmed;
    }
}
