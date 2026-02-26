package dev.burnedchats.repository;

import dev.burnedchats.model.RoomJoinRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

/**
 * Redis repository for {@link RoomJoinRequest}.
 *
 * <p>Two key types are used together:
 * <ul>
 *   <li>{@code room_join_request:{roomId}:{senderTgId}} — Hash with request data, TTL 24 h.</li>
 *   <li>{@code room_join_requests:{roomId}} — Set of {@code senderTgId} strings (index), TTL 24 h.</li>
 * </ul>
 *
 * <p>The index Set allows listing all pending requests for a room without a Redis SCAN.
 * Hash and index entry share the same TTL; both are removed on {@link #remove}.
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class RoomJoinRequestRepository {

    private static final String HASH_PREFIX = "room_join_request:";
    private static final String INDEX_PREFIX = "room_join_requests:";
    private static final Duration TTL = Duration.ofHours(RoomJoinRequest.TTL_HOURS);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Persist a new join request (Hash) and add the sender to the room's index Set.
     *
     * @param request the join request to store
     * @return Mono completing when both writes succeed
     */
    public Mono<Void> save(RoomJoinRequest request) {
        String hashKey = hashKey(request.getRoomId(), request.getSenderTgId());
        String indexKey = indexKey(request.getRoomId());
        String senderStr = String.valueOf(request.getSenderTgId());

        return redisTemplate.opsForHash()
                .putAll(hashKey, toHash(request))
                .then(redisTemplate.expire(hashKey, TTL))
                .then(redisTemplate.opsForSet().add(indexKey, senderStr))
                .then(redisTemplate.expire(indexKey, TTL))
                .then()
                .doOnSuccess(v -> log.debug("Saved join request: roomId={}, senderTgId={}",
                        request.getRoomId(), request.getSenderTgId()))
                .onErrorResume(e -> {
                    log.error("Failed to save join request: roomId={}, senderTgId={}: {}",
                            request.getRoomId(), request.getSenderTgId(), e.getMessage());
                    return Mono.error(e);
                });
    }

    /**
     * List all pending join requests for a room.
     *
     * <p>Reads sender IDs from the index Set and fetches each request Hash.
     * Requests whose Hash has expired (but the index entry remains) are silently skipped.
     *
     * @param roomId the room UUID
     * @return Flux of pending join requests (may be empty)
     */
    public Flux<RoomJoinRequest> listByRoom(String roomId) {
        String indexKey = indexKey(roomId);

        return redisTemplate.opsForSet()
                .members(indexKey)
                .flatMap(senderStr -> {
                    Long senderTgId = Long.parseLong(senderStr);
                    return findByRoomAndSender(roomId, senderTgId);
                })
                .doOnComplete(() -> log.debug("Listed join requests for room {}", roomId));
    }

    /**
     * Find a single join request by room + sender.
     *
     * @param roomId     the room UUID
     * @param senderTgId sender's Telegram ID
     * @return Mono with the request, or empty if not found
     */
    public Mono<RoomJoinRequest> findByRoomAndSender(String roomId, Long senderTgId) {
        String hashKey = hashKey(roomId, senderTgId);

        return redisTemplate.opsForHash()
                .entries(hashKey)
                .collectMap(
                        entry -> String.valueOf(entry.getKey()),
                        entry -> String.valueOf(entry.getValue())
                )
                .filter(map -> !map.isEmpty())
                .map(this::fromHash);
    }

    /**
     * Check whether a join request exists for the given room + sender.
     *
     * @param roomId     the room UUID
     * @param senderTgId sender's Telegram ID
     * @return Mono with {@code true} if a request exists
     */
    public Mono<Boolean> exists(String roomId, Long senderTgId) {
        return redisTemplate.hasKey(hashKey(roomId, senderTgId));
    }

    /**
     * Remove a join request (both Hash and index Set entry).
     *
     * @param roomId     the room UUID
     * @param senderTgId sender's Telegram ID
     * @return Mono completing when removed
     */
    public Mono<Void> remove(String roomId, Long senderTgId) {
        String hashKey = hashKey(roomId, senderTgId);
        String indexKey = indexKey(roomId);
        String senderStr = String.valueOf(senderTgId);

        return redisTemplate.delete(hashKey)
                .then(redisTemplate.opsForSet().remove(indexKey, senderStr))
                .then()
                .doOnSuccess(v -> log.debug("Removed join request: roomId={}, senderTgId={}", roomId, senderTgId))
                .onErrorResume(e -> {
                    log.error("Failed to remove join request: roomId={}, senderTgId={}: {}",
                            roomId, senderTgId, e.getMessage());
                    return Mono.error(e);
                });
    }

    /**
     * Delete all join requests for a room (called when burning the room).
     *
     * @param roomId the room UUID
     * @return Mono completing when both keys are deleted
     */
    public Mono<Void> deleteAll(String roomId) {
        return redisTemplate.opsForSet()
                .members(indexKey(roomId))
                .flatMap(senderStr -> redisTemplate.delete(hashKey(roomId, Long.parseLong(senderStr))))
                .then(redisTemplate.delete(indexKey(roomId)))
                .then()
                .doOnSuccess(v -> log.debug("Deleted all join requests for room {}", roomId));
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private String hashKey(String roomId, Long senderTgId) {
        return HASH_PREFIX + roomId + ":" + senderTgId;
    }

    private String indexKey(String roomId) {
        return INDEX_PREFIX + roomId;
    }

    private Map<String, String> toHash(RoomJoinRequest request) {
        Map<String, String> map = new HashMap<>();
        map.put("roomId", request.getRoomId());
        map.put("senderTgId", String.valueOf(request.getSenderTgId()));
        map.put("username", request.getUsername() != null ? request.getUsername() : "");
        map.put("firstName", request.getFirstName() != null ? request.getFirstName() : "");
        map.put("createdAt", String.valueOf(request.getCreatedAt()));
        map.put("publicKey", request.getPublicKey() != null ? request.getPublicKey() : "");
        return map;
    }

    private RoomJoinRequest fromHash(Map<String, String> hash) {
        String username = hash.getOrDefault("username", "");
        String firstName = hash.getOrDefault("firstName", "");
        String publicKey = hash.getOrDefault("publicKey", "");
        return RoomJoinRequest.builder()
                .roomId(hash.get("roomId"))
                .senderTgId(Long.parseLong(hash.get("senderTgId")))
                .username(username.isBlank() ? null : username)
                .firstName(firstName.isBlank() ? null : firstName)
                .createdAt(Long.parseLong(hash.get("createdAt")))
                .publicKey(publicKey.isBlank() ? null : publicKey)
                .build();
    }
}
