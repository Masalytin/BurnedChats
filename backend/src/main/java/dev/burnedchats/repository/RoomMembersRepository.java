package dev.burnedchats.repository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import dev.burnedchats.util.InternalIds;


/**
 * Redis repository for room membership stored under key {@code room_members:{roomId}}.
 *
 * <p>Uses a Redis Set where each member is an internal user ID string.
 * No TTL is set on this key by default — it is deleted explicitly when a room is burned.
 *
 * <p>Also maintains a reverse index {@code member_rooms:{internalId}} — a Set of roomId strings —
 * so that {@link #getRoomsForMember(String)} can be answered in O(1) without scanning all rooms.
 *
 * <p>Key patterns:
 * <ul>
 *   <li>{@code room_members:{roomId}} — Set of internalId strings</li>
 *   <li>{@code member_rooms:{internalId}} — Set of roomId strings (reverse index)</li>
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
     * @param internalId the user internal ID to add
     * @return Mono with the number of members added (0 if already present)
     */
    public Mono<Long> add(String roomId, String internalId) {
        return redisTemplate.opsForSet()
                .add(keyFor(roomId), internalId)
                .flatMap(n -> redisTemplate.opsForSet()
                        .add(reverseKeyFor(internalId), roomId)
                        .thenReturn(n))
                .doOnSuccess(n -> LOG.debug("Added member {} to room {} (added={})", internalId, roomId, n));
    }

    /**
     * @deprecated Use {@link #add(String, String)} with {@link dev.burnedchats.security.AppPrincipal#getInternalId()}.
     */
    @Deprecated
    public Mono<Long> add(String roomId, Long telegramId) {
        return add(roomId, InternalIds.forTelegramId(telegramId));
    }

    /**
     * Remove a member from the room and update the reverse index.
     *
     * @param roomId the room UUID
     * @param internalId the user internal ID to remove
     * @return Mono with the number of members removed
     */
    public Mono<Long> remove(String roomId, String internalId) {
        return redisTemplate.opsForSet()
                .remove(keyFor(roomId), internalId)
                .flatMap(n -> redisTemplate.opsForSet()
                        .remove(reverseKeyFor(internalId), (Object) roomId)
                        .thenReturn(n))
                .doOnSuccess(n -> LOG.debug("Removed member {} from room {} (removed={})", internalId, roomId, n));
    }

    /** @deprecated Use {@link #remove(String, String)}. */
    @Deprecated
    public Mono<Long> remove(String roomId, Long telegramId) {
        return remove(roomId, InternalIds.forTelegramId(telegramId));
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
     * @param internalId the user internal ID
     * @return Flux of roomId strings
     */
    public Flux<String> getRoomsForMember(String internalId) {
        return redisTemplate.opsForSet()
                .members(reverseKeyFor(internalId))
                .doOnComplete(() -> LOG.debug("Fetched rooms for member {}", internalId));
    }

    /** @deprecated Use {@link #getRoomsForMember(String)}. */
    @Deprecated
    public Flux<String> getRoomsForMember(Long telegramId) {
        return getRoomsForMember(InternalIds.forTelegramId(telegramId));
    }

    /**
     * Check whether a user is a member of the room.
     *
     * @param roomId the room UUID
     * @param internalId the user internal ID
     * @return Mono with {@code true} if the user is a member
     */
    public Mono<Boolean> isMember(String roomId, String internalId) {
        return redisTemplate.opsForSet()
                .isMember(keyFor(roomId), (Object) internalId);
    }

    /** @deprecated Use {@link #isMember(String, String)}. */
    @Deprecated
    public Mono<Boolean> isMember(String roomId, Long telegramId) {
        return isMember(roomId, InternalIds.forTelegramId(telegramId));
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
                .flatMap(internalId -> {
                    return redisTemplate.opsForSet().remove(reverseKeyFor(internalId), (Object) roomId);
                })
                .then(redisTemplate.delete(keyFor(roomId)))
                .doOnSuccess(n -> LOG.debug("Deleted members set for room {}", roomId))
                .then();
    }

    private String keyFor(String roomId) {
        return KEY_PREFIX + roomId;
    }

    private String reverseKeyFor(String internalId) {
        return REVERSE_KEY_PREFIX + internalId;
    }
}
