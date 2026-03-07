package dev.burnedchats.repository;

import dev.burnedchats.model.Room;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

/**
 * Redis repository for {@link Room} data stored under key {@code room:{roomId}}.
 *
 * <p>Uses a Redis Hash for each room so individual fields can be updated
 * without rewriting the entire object.
 *
 * <p>Key pattern: {@code room:{roomId}} — Hash, TTL {@value Room#DEFAULT_TTL_DAYS} days.
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class RoomRepository {

    private static final String KEY_PREFIX = "room:";
    public static final Duration DEFAULT_TTL = Duration.ofDays(Room.DEFAULT_TTL_DAYS);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Save or update a room in Redis and set its TTL.
     *
     * @param room the room to persist
     * @return Mono completing with {@code true} on success
     */
    public Mono<Boolean> save(Room room) {
        String key = keyFor(room.getId());
        Map<String, String> hash = toHash(room);

        return redisTemplate.opsForHash()
                .putAll(key, hash)
                .then(redisTemplate.expire(key, DEFAULT_TTL))
                .doOnSuccess(ok -> log.debug("Saved room {}", room.getId()))
                .onErrorResume(e -> {
                    log.error("Failed to save room {}: {}", room.getId(), e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Find a room by its ID.
     *
     * @param roomId the room UUID
     * @return Mono with the room, or empty if not found
     */
    public Mono<Room> findById(String roomId) {
        String key = keyFor(roomId);

        return redisTemplate.opsForHash()
                .entries(key)
                .collectMap(
                        entry -> String.valueOf(entry.getKey()),
                        entry -> String.valueOf(entry.getValue())
                )
                .filter(map -> !map.isEmpty())
                .map(this::fromHash)
                .doOnNext(room -> log.debug("Found room {}", roomId))
                .onErrorResume(e -> {
                    log.error("Failed to find room {}: {}", roomId, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Delete a room and all its direct metadata.
     *
     * <p>Does NOT delete {@code room_members:{roomId}} — that is the caller's responsibility.
     *
     * @param roomId the room UUID
     * @return Mono with the number of keys deleted
     */
    public Mono<Long> delete(String roomId) {
        return redisTemplate.delete(keyFor(roomId))
                .doOnSuccess(n -> log.debug("Deleted room key {} (result={})", roomId, n));
    }

    /**
     * Extend the TTL of an existing room (called on activity).
     *
     * @param roomId the room UUID
     * @param ttl    new TTL duration
     * @return Mono with {@code true} if TTL was set
     */
    public Mono<Boolean> extendTtl(String roomId, Duration ttl) {
        return redisTemplate.expire(keyFor(roomId), ttl)
                .doOnSuccess(ok -> log.debug("Extended TTL for room {}", roomId));
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private String keyFor(String roomId) {
        return KEY_PREFIX + roomId;
    }

    private Map<String, String> toHash(Room room) {
        Map<String, String> map = new HashMap<>();
        map.put("id", room.getId());
        map.put("ownerTgId", String.valueOf(room.getOwnerTgId()));
        map.put("salt", room.getSalt() != null ? room.getSalt() : "");
        map.put("passwordProofHash", room.getPasswordProofHash() != null ? room.getPasswordProofHash() : "");
        map.put("joinMode", room.getJoinMode().name());
        map.put("createdAt", String.valueOf(room.getCreatedAt()));
        map.put("nameEncrypted", room.getNameEncrypted() != null ? room.getNameEncrypted() : "");
        return map;
    }

    private Room fromHash(Map<String, String> hash) {
        String nameEncrypted = hash.getOrDefault("nameEncrypted", "");
        String salt = hash.getOrDefault("salt", "");
        String passwordProofHash = hash.getOrDefault("passwordProofHash", "");
        return Room.builder()
                .id(hash.get("id"))
                .ownerTgId(Long.parseLong(hash.get("ownerTgId")))
                .salt(salt.isEmpty() ? null : salt)
                .passwordProofHash(passwordProofHash.isEmpty() ? null : passwordProofHash)
                .joinMode(Room.JoinMode.valueOf(hash.get("joinMode")))
                .createdAt(Long.parseLong(hash.get("createdAt")))
                .nameEncrypted(nameEncrypted.isBlank() ? null : nameEncrypted)
                .build();
    }
}
