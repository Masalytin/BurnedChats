package dev.burnedchats.repository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;


/**
 * Redis repository for room membership stored under key {@code room_members:{roomId}}.
 *
 * <p>Uses a Redis Set where each member is a Telegram user ID (as String).
 * No TTL is set on this key by default — it is deleted explicitly when a room is burned.
 *
 * <p>Also maintains a reverse index {@code member_rooms:{tgId}} — a Set of roomId strings —
 * so that {@link #getRoomsForMember(Long)} can be answered in O(1) without scanning all rooms.
 *
 * <p>Key patterns:
 * <ul>
 *   <li>{@code room_members:{roomId}} — Set of tgId strings</li>
 *   <li>{@code member_rooms:{tgId}} — Set of roomId strings (reverse index)</li>
 * </ul>
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class RoomMembersRepository {

    private static final String KEY_PREFIX = "room_members:";
    private static final String REVERSE_KEY_PREFIX = "member_rooms:";

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Add a member to the room and update the reverse index.
     *
     * @param roomId the room UUID
     * @param tgId   the Telegram user ID to add
     * @return Mono with the number of members added (0 if already present)
     */
    public Mono<Long> add(String roomId, Long tgId) {
        return redisTemplate.opsForSet()
                .add(keyFor(roomId), String.valueOf(tgId))
                .flatMap(n -> redisTemplate.opsForSet()
                        .add(reverseKeyFor(tgId), roomId)
                        .thenReturn(n))
                .doOnSuccess(n -> LOG.debug("Added member {} to room {} (added={})", tgId, roomId, n));
    }

    /**
     * Remove a member from the room and update the reverse index.
     *
     * @param roomId the room UUID
     * @param tgId   the Telegram user ID to remove
     * @return Mono with the number of members removed
     */
    public Mono<Long> remove(String roomId, Long tgId) {
        return redisTemplate.opsForSet()
                .remove(keyFor(roomId), String.valueOf(tgId))
                .flatMap(n -> redisTemplate.opsForSet()
                        .remove(reverseKeyFor(tgId), (Object) roomId)
                        .thenReturn(n))
                .doOnSuccess(n -> LOG.debug("Removed member {} from room {} (removed={})", tgId, roomId, n));
    }

    /**
     * Get all member Telegram IDs for a room.
     *
     * @param roomId the room UUID
     * @return Flux of tgId strings
     */
    public Flux<String> getMembers(String roomId) {
        return redisTemplate.opsForSet()
                .members(keyFor(roomId))
                .doOnComplete(() -> LOG.debug("Fetched members for room {}", roomId));
    }

    /**
     * Get all room IDs where the given user is a member (reverse index lookup).
     *
     * @param tgId the Telegram user ID
     * @return Flux of roomId strings
     */
    public Flux<String> getRoomsForMember(Long tgId) {
        return redisTemplate.opsForSet()
                .members(reverseKeyFor(tgId))
                .doOnComplete(() -> LOG.debug("Fetched rooms for member {}", tgId));
    }

    /**
     * Check whether a user is a member of the room.
     *
     * @param roomId the room UUID
     * @param tgId   the Telegram user ID
     * @return Mono with {@code true} if the user is a member
     */
    public Mono<Boolean> isMember(String roomId, Long tgId) {
        return redisTemplate.opsForSet()
                .isMember(keyFor(roomId), (Object) String.valueOf(tgId));
    }

    /**
     * Get the number of members in a room.
     *
     * @param roomId the room UUID
     * @return Mono with member count
     */
    public Mono<Long> count(String roomId) {
        return redisTemplate.opsForSet().size(keyFor(roomId));
    }

    /**
     * Delete the entire members set for a room and remove the room from every member's
     * reverse index (called on BURN_ROOM).
     *
     * @param roomId the room UUID
     * @return Mono completing when deletion is done
     */
    public Mono<Void> deleteAll(String roomId) {
        return redisTemplate.opsForSet()
                .members(keyFor(roomId))
                .flatMap(tgIdStr -> {
                    long tgId = Long.parseLong(tgIdStr);
                    return redisTemplate.opsForSet().remove(reverseKeyFor(tgId), (Object) roomId);
                })
                .then(redisTemplate.delete(keyFor(roomId)))
                .doOnSuccess(n -> LOG.debug("Deleted members set for room {}", roomId))
                .then();
    }

    private String keyFor(String roomId) {
        return KEY_PREFIX + roomId;
    }

    private String reverseKeyFor(Long tgId) {
        return REVERSE_KEY_PREFIX + tgId;
    }
}
