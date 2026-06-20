package dev.burnedchats.repository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;

/**
 * Redis repository for room ban list stored under key {@code room_bans:{roomId}}.
 *
 * <p>Uses a Redis Set where each member is a banned user's internal ID string.
 * TTL is aligned with {@link RoomRepository#DEFAULT_TTL} and refreshed on mutations
 * and via {@link #extendTtl(String)}.
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class RoomBansRepository {

    private static final String KEY_PREFIX = "room_bans:";

    /** Ban list TTL aligned with room lifetime. */
    public static final Duration TTL = RoomRepository.DEFAULT_TTL;

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Add an internal ID to the room ban list.
     *
     * @param roomId the room UUID
     * @param internalId the user internal ID to ban
     * @return Mono with the number of entries added (0 if already banned)
     */
    public Mono<Long> add(String roomId, String internalId) {
        return redisTemplate.opsForSet()
                .add(keyFor(roomId), internalId)
                .flatMap(n -> refreshTtl(roomId).thenReturn(n))
                .doOnSuccess(n -> LOG.debug("Added ban {} in room {} (added={})", internalId, roomId, n));
    }

    /**
     * Remove an internal ID from the room ban list.
     *
     * @param roomId the room UUID
     * @param internalId the user internal ID to unban
     * @return Mono with the number of entries removed
     */
    public Mono<Long> remove(String roomId, String internalId) {
        return redisTemplate.opsForSet()
                .remove(keyFor(roomId), internalId)
                .flatMap(n -> {
                    if (n > 0) {
                        return refreshTtl(roomId).thenReturn(n);
                    }
                    return Mono.just(n);
                })
                .doOnSuccess(n -> LOG.debug("Removed ban {} from room {} (removed={})", internalId, roomId, n));
    }

    /**
     * Check whether a user is banned from the room.
     *
     * @param roomId the room UUID
     * @param internalId the user internal ID
     * @return Mono with {@code true} if the user is banned
     */
    public Mono<Boolean> isBanned(String roomId, String internalId) {
        return redisTemplate.opsForSet()
                .isMember(keyFor(roomId), internalId);
    }

    /**
     * List all banned internal IDs for a room.
     *
     * @param roomId the room UUID
     * @return Flux of banned internalId strings
     */
    public Flux<String> list(String roomId) {
        return redisTemplate.opsForSet()
                .members(keyFor(roomId))
                .doOnComplete(() -> LOG.debug("Fetched ban list for room {}", roomId));
    }

    /**
     * Extend TTL on the room ban set (e.g. alongside room activity).
     *
     * @param roomId the room UUID
     * @return Mono with {@code true} if TTL was set
     */
    public Mono<Boolean> extendTtl(String roomId) {
        return redisTemplate.expire(keyFor(roomId), TTL)
                .doOnSuccess(ok -> LOG.debug("Extended ban list TTL for room {}", roomId));
    }

    /**
     * Delete the entire ban list for a room (called on BURN_ROOM).
     *
     * @param roomId the room UUID
     * @return Mono completing when deletion is done
     */
    public Mono<Void> deleteAll(String roomId) {
        return redisTemplate.delete(keyFor(roomId))
                .doOnSuccess(n -> LOG.debug("Deleted ban list for room {}", roomId))
                .then();
    }

    private Mono<Void> refreshTtl(String roomId) {
        return redisTemplate.expire(keyFor(roomId), TTL).then();
    }

    private String keyFor(String roomId) {
        return KEY_PREFIX + roomId;
    }
}
