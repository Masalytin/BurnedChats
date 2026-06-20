package dev.burnedchats.repository;

import dev.burnedchats.model.RoomRole;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

import java.time.Duration;

/**
 * Redis repository for room role overlay stored under key {@code room_roles:{roomId}}.
 *
 * <p>Uses a Redis Hash where field = internalId and value = {@code admin} or {@code member}.
 * {@link RoomRole#OWNER} is never persisted here — it is resolved from
 * {@code room.ownerInternalId}.
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class RoomRolesRepository {

    private static final String KEY_PREFIX = "room_roles:";

    /** Role hash TTL aligned with room lifetime. */
    public static final Duration TTL = RoomRepository.DEFAULT_TTL;

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Set the overlay role for a member ({@code admin} or {@code member}).
     *
     * @param roomId     the room UUID
     * @param internalId the member internal ID
     * @param role       stored role value ({@code admin} or {@code member})
     * @return Mono with {@code true} when the hash field was set
     */
    public Mono<Boolean> setRole(String roomId, String internalId, String role) {
        return redisTemplate.opsForHash()
                .put(keyFor(roomId), internalId, role)
                .flatMap(ok -> refreshTtl(roomId).thenReturn(ok))
                .doOnSuccess(ok -> LOG.debug("Set role {} for {} in room {}", role, internalId, roomId));
    }

    /**
     * Read the stored overlay role for a member.
     *
     * @param roomId     the room UUID
     * @param internalId the member internal ID
     * @return Mono with the stored value, or empty when absent (implicit member)
     */
    public Mono<String> getStoredRole(String roomId, String internalId) {
        return redisTemplate.opsForHash()
                .get(keyFor(roomId), internalId)
                .map(String::valueOf)
                .filter(StringUtils::hasText);
    }

    /**
     * Remove the overlay role entry for a member.
     *
     * @param roomId     the room UUID
     * @param internalId the member internal ID
     * @return Mono with the number of fields removed
     */
    public Mono<Long> remove(String roomId, String internalId) {
        return redisTemplate.opsForHash()
                .remove(keyFor(roomId), internalId)
                .doOnSuccess(n -> LOG.debug("Removed role entry for {} in room {} (removed={})",
                        internalId, roomId, n));
    }

    /**
     * Extend TTL on the room roles hash.
     *
     * @param roomId the room UUID
     * @return Mono with {@code true} if TTL was set
     */
    public Mono<Boolean> extendTtl(String roomId) {
        return redisTemplate.expire(keyFor(roomId), TTL)
                .doOnSuccess(ok -> LOG.debug("Extended roles TTL for room {}", roomId));
    }

    /**
     * Delete the entire roles hash for a room (called on BURN_ROOM).
     *
     * @param roomId the room UUID
     * @return Mono completing when deletion is done
     */
    public Mono<Void> deleteAll(String roomId) {
        return redisTemplate.delete(keyFor(roomId))
                .doOnSuccess(n -> LOG.debug("Deleted roles for room {}", roomId))
                .then();
    }

    private Mono<Void> refreshTtl(String roomId) {
        return redisTemplate.expire(keyFor(roomId), TTL).then();
    }

    private String keyFor(String roomId) {
        return KEY_PREFIX + roomId;
    }
}
