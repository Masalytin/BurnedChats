package dev.burnedchats.repository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import dev.burnedchats.util.InternalIds;

import java.time.Duration;


/**
 * Redis repository for room membership stored under key {@code room_members:{roomId}}.
 *
 * <p>Uses a Redis Set where each member is an internal user ID string.
 * Both forward and reverse index keys carry TTL aligned with {@link RoomRepository#DEFAULT_TTL}
 * and are refreshed on membership mutations and via {@link #extendTtl(String)}.
 *
 * <p>Also maintains a reverse index {@code member_rooms:{internalId}} — a Set of roomId strings —
 * so that {@link #getRoomsForMember(String)} can be answered in O(1) without scanning all rooms.
 *
 * <p>Key patterns:
 * <ul>
 *   <li>{@code room_members:{roomId}} — Set of internalId strings, TTL 30 days</li>
 *   <li>{@code member_rooms:{internalId}} — Set of roomId strings (reverse index), TTL 30 days</li>
 * </ul>
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class RoomMembersRepository {

    private static final String KEY_PREFIX = "room_members:";
    private static final String REVERSE_KEY_PREFIX = "member_rooms:";

    /** Membership TTL aligned with room lifetime; extended on activity via {@link #extendTtl(String)}. */
    public static final Duration TTL = RoomRepository.DEFAULT_TTL;

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Add a member to the room and update the reverse index.
     *
     * @param roomId the room UUID
     * @param internalId the user internal ID to add
     * @return Mono with the number of members added (0 if already present)
     */
    public Mono<Long> add(String roomId, String internalId) {
        String forwardKey = keyFor(roomId);
        String reverseKey = reverseKeyFor(internalId);

        return redisTemplate.opsForSet()
                .add(forwardKey, internalId)
                .flatMap(n -> redisTemplate.opsForSet()
                        .add(reverseKey, roomId)
                        .onErrorResume(e -> compensateForwardRemove(forwardKey, internalId, e)))
                .flatMap(n -> refreshMembershipTtl(roomId, internalId).thenReturn(n))
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
        String forwardKey = keyFor(roomId);
        String reverseKey = reverseKeyFor(internalId);

        return redisTemplate.opsForSet()
                .remove(forwardKey, internalId)
                .flatMap(n -> redisTemplate.opsForSet()
                        .remove(reverseKey, (Object) roomId)
                        .onErrorResume(e -> {
                            LOG.warn(
                                    "Reverse index remove failed for room={}, member={}: {}",
                                    roomId, internalId, e.getMessage());
                            return Mono.just(0L);
                        })
                        .thenReturn(n))
                .flatMap(n -> {
                    if (n > 0) {
                        return refreshMembershipTtl(roomId, internalId).thenReturn(n);
                    }
                    return Mono.just(n);
                })
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
     * Extend TTL on the room membership set and every member's reverse index entry for this room.
     *
     * <p>Callers should invoke this when room activity extends the room key TTL
     * (e.g. alongside {@link RoomRepository#extendTtl(String, Duration)}).
     *
     * @param roomId the room UUID
     * @return Mono with {@code true} if the forward key TTL was set
     */
    public Mono<Boolean> extendTtl(String roomId) {
        return redisTemplate.expire(keyFor(roomId), TTL)
                .flatMap(forwardOk -> getMembers(roomId)
                        .flatMap(internalId -> redisTemplate.expire(reverseKeyFor(internalId), TTL))
                        .then(Mono.just(Boolean.TRUE.equals(forwardOk))))
                .doOnSuccess(ok -> LOG.debug("Extended membership TTL for room {}", roomId));
    }

    /**
     * Best-effort cleanup of a stale reverse-index entry when the forward membership is absent.
     *
     * @param roomId the room UUID
     * @param internalId the user internal ID
     * @return Mono with the number of reverse entries removed (0 if membership still present)
     */
    public Mono<Long> cleanupOrphanReverseEntry(String roomId, String internalId) {
        return isMember(roomId, internalId)
                .flatMap(isMember -> {
                    if (Boolean.TRUE.equals(isMember)) {
                        return Mono.just(0L);
                    }
                    return redisTemplate.opsForSet()
                            .remove(reverseKeyFor(internalId), (Object) roomId)
                            .doOnSuccess(n -> {
                                if (n != null && n > 0) {
                                    LOG.debug("Cleaned orphan reverse entry room={} member={}", roomId, internalId);
                                }
                            });
                });
    }

    /**
     * Delete the entire members set for a room and remove the room from every member's
     * reverse index (called on BURN_ROOM).
     *
     * @param roomId the room UUID
     * @return Mono completing when deletion is done
     */
    public Mono<Void> deleteAll(String roomId) {
        String forwardKey = keyFor(roomId);

        return redisTemplate.opsForSet()
                .members(forwardKey)
                .flatMap(internalId -> redisTemplate.opsForSet()
                        .remove(reverseKeyFor(internalId), (Object) roomId)
                        .onErrorResume(e -> {
                            LOG.warn(
                                    "Reverse index cleanup failed during deleteAll room={}, member={}: {}",
                                    roomId, internalId, e.getMessage());
                            return Mono.just(0L);
                        }))
                .then(redisTemplate.delete(forwardKey))
                .doOnSuccess(n -> LOG.debug("Deleted members set for room {}", roomId))
                .then();
    }

    private Mono<Long> compensateForwardRemove(String forwardKey, String internalId, Throwable cause) {
        LOG.warn("Reverse index add failed, compensating forward remove for member {}: {}",
                internalId, cause.getMessage());
        return redisTemplate.opsForSet()
                .remove(forwardKey, internalId)
                .then(Mono.error(cause));
    }

    private Mono<Void> refreshMembershipTtl(String roomId, String internalId) {
        return redisTemplate.expire(keyFor(roomId), TTL)
                .then(redisTemplate.expire(reverseKeyFor(internalId), TTL))
                .then();
    }

    private String keyFor(String roomId) {
        return KEY_PREFIX + roomId;
    }

    private String reverseKeyFor(String internalId) {
        return REVERSE_KEY_PREFIX + internalId;
    }
}
