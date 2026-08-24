package dev.burnedchats.repository;

import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;

/**
 * Per-user inbox of burned room facts (roomId + burnedAt only — no names or ciphertext).
 *
 * <p>Key: {@code room_burn_inbox:{internalId}} — Redis list, TTL 7 days.
 */
@Repository
public class RoomBurnInboxRepository {

    private static final String PREFIX = "room_burn_inbox:";
    private static final Duration TTL = Duration.ofDays(7);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public RoomBurnInboxRepository(ReactiveRedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public Mono<Void> recordBurn(String internalId, String roomId, long burnedAtMs) {
        if (internalId == null || internalId.isBlank() || roomId == null || roomId.isBlank()) {
            return Mono.empty();
        }
        String key = PREFIX + internalId;
        String payload = roomId + "|" + burnedAtMs;
        return redisTemplate.opsForList()
                .rightPush(key, payload)
                .then(redisTemplate.expire(key, TTL))
                .then();
    }

    public Flux<String> drain(String internalId) {
        if (internalId == null || internalId.isBlank()) {
            return Flux.empty();
        }
        String key = PREFIX + internalId;
        return redisTemplate.opsForList()
                .range(key, 0, -1)
                .collectList()
                .flatMapMany(items -> redisTemplate.delete(key).thenMany(Flux.fromIterable(items)));
    }
}
