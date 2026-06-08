package dev.burnedchats.repository;

import dev.burnedchats.model.RoomJoinRequest;
import dev.burnedchats.util.InternalIds;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;
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
 *   <li>{@code room_join_request:{roomId}:{senderInternalId}} — Hash with request data, TTL 24 h.</li>
 *   <li>{@code room_join_requests:{roomId}} — Set of {@code senderInternalId} strings (index), TTL 24 h.</li>
 * </ul>
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class RoomJoinRequestRepository {

    private static final String HASH_PREFIX = "room_join_request:";
    private static final String INDEX_PREFIX = "room_join_requests:";
    private static final Duration TTL = Duration.ofHours(RoomJoinRequest.TTL_HOURS);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public Mono<Void> save(RoomJoinRequest request) {
        String senderInternalId = request.getSenderInternalId();
        String hashKey = hashKey(request.getRoomId(), senderInternalId);
        String indexKey = indexKey(request.getRoomId());

        return redisTemplate.opsForHash()
                .putAll(hashKey, toHash(request))
                .then(redisTemplate.expire(hashKey, TTL))
                .then(redisTemplate.opsForSet().add(indexKey, senderInternalId))
                .then(redisTemplate.expire(indexKey, TTL))
                .then()
                .doOnSuccess(v -> LOG.debug("Saved join request: roomId={}, senderInternalId={}",
                        request.getRoomId(), senderInternalId))
                .onErrorResume(e -> {
                    LOG.error("Failed to save join request: roomId={}, senderInternalId={}: {}",
                            request.getRoomId(), senderInternalId, e.getMessage());
                    return Mono.error(e);
                });
    }

    public Flux<RoomJoinRequest> listByRoom(String roomId) {
        String indexKey = indexKey(roomId);

        return redisTemplate.opsForSet()
                .members(indexKey)
                .flatMap(senderInternalId -> findByRoomAndSender(roomId, senderInternalId))
                .doOnComplete(() -> LOG.debug("Listed join requests for room {}", roomId));
    }

    public Mono<RoomJoinRequest> findByRoomAndSender(String roomId, String senderInternalId) {
        String hashKey = hashKey(roomId, senderInternalId);

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
     * @deprecated Use {@link #findByRoomAndSender(String, String)}.
     */
    @Deprecated
    public Mono<RoomJoinRequest> findByRoomAndSender(String roomId, Long senderTgId) {
        return findByRoomAndSender(roomId, InternalIds.forTelegramId(senderTgId));
    }

    public Mono<Boolean> exists(String roomId, String senderInternalId) {
        return redisTemplate.hasKey(hashKey(roomId, senderInternalId));
    }

    /**
     * @deprecated Use {@link #exists(String, String)}.
     */
    @Deprecated
    public Mono<Boolean> exists(String roomId, Long senderTgId) {
        return exists(roomId, InternalIds.forTelegramId(senderTgId));
    }

    public Mono<Void> remove(String roomId, String senderInternalId) {
        String hashKey = hashKey(roomId, senderInternalId);
        String indexKey = indexKey(roomId);

        return redisTemplate.delete(hashKey)
                .then(redisTemplate.opsForSet().remove(indexKey, senderInternalId))
                .then()
                .doOnSuccess(v -> LOG.debug("Removed join request: roomId={}, senderInternalId={}",
                        roomId, senderInternalId))
                .onErrorResume(e -> {
                    LOG.error("Failed to remove join request: roomId={}, senderInternalId={}: {}",
                            roomId, senderInternalId, e.getMessage());
                    return Mono.error(e);
                });
    }

    /**
     * @deprecated Use {@link #remove(String, String)}.
     */
    @Deprecated
    public Mono<Void> remove(String roomId, Long senderTgId) {
        return remove(roomId, InternalIds.forTelegramId(senderTgId));
    }

    public Mono<Void> deleteAll(String roomId) {
        return redisTemplate.opsForSet()
                .members(indexKey(roomId))
                .flatMap(senderInternalId -> redisTemplate.delete(hashKey(roomId, senderInternalId)))
                .then(redisTemplate.delete(indexKey(roomId)))
                .then()
                .doOnSuccess(v -> LOG.debug("Deleted all join requests for room {}", roomId));
    }

    private String hashKey(String roomId, String senderInternalId) {
        return HASH_PREFIX + roomId + ":" + senderInternalId;
    }

    private String indexKey(String roomId) {
        return INDEX_PREFIX + roomId;
    }

    private Map<String, String> toHash(RoomJoinRequest request) {
        Map<String, String> map = new HashMap<>();
        map.put("roomId", request.getRoomId());
        map.put("senderInternalId", request.getSenderInternalId());
        if (request.getSenderTgId() != null) {
            map.put("senderTgId", String.valueOf(request.getSenderTgId()));
        }
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
        String senderInternalId = hash.get("senderInternalId");
        if (!StringUtils.hasText(senderInternalId) && hash.containsKey("senderTgId")) {
            senderInternalId = InternalIds.forTelegramId(Long.parseLong(hash.get("senderTgId")));
        }
        Long senderTgId = null;
        if (hash.containsKey("senderTgId") && StringUtils.hasText(hash.get("senderTgId"))) {
            senderTgId = Long.parseLong(hash.get("senderTgId"));
        }
        return RoomJoinRequest.builder()
                .roomId(hash.get("roomId"))
                .senderInternalId(senderInternalId)
                .senderTgId(senderTgId)
                .username(username.isBlank() ? null : username)
                .firstName(firstName.isBlank() ? null : firstName)
                .createdAt(Long.parseLong(hash.get("createdAt")))
                .publicKey(publicKey.isBlank() ? null : publicKey)
                .build();
    }
}
