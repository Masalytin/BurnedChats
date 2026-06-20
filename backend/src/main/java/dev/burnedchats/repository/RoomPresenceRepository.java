package dev.burnedchats.repository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Collections;
import java.util.Map;

/**
 * Redis repository for ephemeral room member presence under key {@code room_presence:{roomId}}.
 *
 * <p>Hash field: internalId → last-seen epoch millis (minute-rounded for privacy).
 * Short TTL; deleted on {@code BURN_ROOM}. Does not store message content or keys.
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class RoomPresenceRepository {

    private static final String KEY_PREFIX = "room_presence:";
    private static final long MINUTE_MS = 60_000L;

    /** Presence hash TTL; stale entries expire without manual cleanup. */
    public static final Duration TTL = Duration.ofMinutes(10);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Round epoch millis down to the start of the minute (privacy-preserving granularity).
     *
     * @param epochMs raw epoch millis
     * @return minute-rounded epoch millis
     */
    public static long roundToMinute(long epochMs) {
        return (epochMs / MINUTE_MS) * MINUTE_MS;
    }

    /**
     * Record or refresh last-seen for a member in the room.
     *
     * @param roomId     room UUID
     * @param internalId member internal id
     * @return mono of the stored minute-rounded last-seen millis
     */
    public Mono<Long> upsertLastSeen(String roomId, String internalId) {
        long lastSeen = roundToMinute(System.currentTimeMillis());
        String key = keyFor(roomId);
        return redisTemplate.opsForHash()
                .put(key, internalId, String.valueOf(lastSeen))
                .flatMap(n -> redisTemplate.expire(key, TTL).thenReturn(lastSeen))
                .doOnSuccess(ts -> LOG.debug("Room presence upsert: roomId={}, internalId={}, lastSeen={}",
                        roomId, internalId, ts));
    }

    /**
     * Read last-seen for one member, if present.
     *
     * @param roomId     room UUID
     * @param internalId member internal id
     * @return mono of last-seen millis, or empty when absent
     */
    public Mono<Long> getLastSeen(String roomId, String internalId) {
        return redisTemplate.opsForHash()
                .get(keyFor(roomId), internalId)
                .map(value -> Long.parseLong(String.valueOf(value)));
    }

    /**
     * Snapshot of all stored last-seen entries for the room.
     *
     * @param roomId room UUID
     * @return mono map internalId → last-seen millis (empty map when key missing)
     */
    public Mono<Map<String, Long>> getAllLastSeen(String roomId) {
        return redisTemplate.opsForHash()
                .entries(keyFor(roomId))
                .collectMap(
                        entry -> String.valueOf(entry.getKey()),
                        entry -> Long.parseLong(String.valueOf(entry.getValue()))
                )
                .defaultIfEmpty(Collections.emptyMap())
                .doOnSuccess(map -> LOG.debug("Room presence snapshot read: roomId={}, entries={}",
                        roomId, map.size()));
    }

    /**
     * Delete the entire presence hash for a room (called on {@code BURN_ROOM}).
     *
     * @param roomId room UUID
     * @return mono completing when deletion is done
     */
    public Mono<Void> deleteAll(String roomId) {
        return redisTemplate.delete(keyFor(roomId))
                .doOnSuccess(n -> LOG.debug("Deleted room presence for room {}", roomId))
                .then();
    }

    private String keyFor(String roomId) {
        return KEY_PREFIX + roomId;
    }
}
