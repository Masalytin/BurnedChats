package dev.burnedchats.repository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Redis repository for ECDH P-256 public keys of room members.
 *
 * <p>Key pattern: {@code room_member_pubkey:{roomId}} — Hash: {@code tgId} → Base64 SPKI public key.
 * TTL: 30 days (matches room lifetime).
 *
 * <p>A public key is stored when:
 * <ul>
 *   <li>Room created — owner's key stored via {@link #put}.</li>
 *   <li>Member joins BY_PASSWORD — key stored during join.</li>
 *   <li>Join request accepted (BY_REQUEST) — key stored from the join request.</li>
 * </ul>
 *
 * <p>Public keys are used by the owner to wrap the group key for each member
 * during initial key delivery (P2-3.2.1) and rekey after a member leaves (P2-3.2.2).
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class RoomMemberPublicKeyRepository {

    private static final String KEY_PREFIX = "room_member_pubkey:";

    public static final Duration TTL = Duration.ofDays(30);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Store (or overwrite) a member's ECDH public key for a room.
     *
     * @param roomId    room UUID
     * @param tgId      member's Telegram ID
     * @param publicKey Base64 SPKI-encoded ECDH P-256 public key
     * @return Mono completing when stored
     */
    public Mono<Void> put(String roomId, Long tgId, String publicKey) {
        if (publicKey == null || publicKey.isBlank()) {
            return Mono.empty();
        }
        String key = keyFor(roomId);
        return redisTemplate.opsForHash()
                .put(key, String.valueOf(tgId), publicKey)
                .then(redisTemplate.expire(key, TTL))
                .then()
                .doOnSuccess(v -> log.debug("Stored public key for member {} in room {}", tgId, roomId))
                .onErrorResume(e -> {
                    log.error("Failed to store public key for member {} in room {}: {}", tgId, roomId, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Get the ECDH public key for a specific member.
     *
     * @param roomId room UUID
     * @param tgId   member's Telegram ID
     * @return Mono with Base64 public key, or empty if not found
     */
    public Mono<String> get(String roomId, Long tgId) {
        return redisTemplate.opsForHash()
                .get(keyFor(roomId), (Object) String.valueOf(tgId))
                .filter(v -> v != null)
                .map(String::valueOf)
                .filter(v -> !v.isBlank())
                .onErrorResume(e -> {
                    log.error("Failed to get public key for member {} in room {}: {}", tgId, roomId, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Get all member ECDH public keys for a room.
     *
     * @param roomId room UUID
     * @return Mono with a map of {@code tgId (string)} → Base64 public key
     */
    public Mono<Map<String, String>> getAll(String roomId) {
        return redisTemplate.opsForHash()
                .entries(keyFor(roomId))
                .collectMap(
                        entry -> String.valueOf(entry.getKey()),
                        entry -> String.valueOf(entry.getValue())
                )
                .doOnSuccess(m -> log.debug("Fetched {} public keys for room {}", m.size(), roomId))
                .onErrorResume(e -> {
                    log.error("Failed to get public keys for room {}: {}", roomId, e.getMessage());
                    return Mono.just(Map.of());
                });
    }

    /**
     * Remove a member's public key (called when member leaves or is removed).
     *
     * @param roomId room UUID
     * @param tgId   member's Telegram ID
     * @return Mono completing when removed
     */
    public Mono<Void> remove(String roomId, Long tgId) {
        return redisTemplate.opsForHash()
                .remove(keyFor(roomId), (Object) String.valueOf(tgId))
                .then()
                .doOnSuccess(v -> log.debug("Removed public key for member {} in room {}", tgId, roomId));
    }

    /**
     * Delete all public keys for a room (called on BURN_ROOM).
     *
     * @param roomId room UUID
     * @return Mono completing when deleted
     */
    public Mono<Void> deleteRoom(String roomId) {
        return redisTemplate.delete(keyFor(roomId))
                .then()
                .doOnSuccess(v -> log.debug("Deleted all public keys for room {}", roomId));
    }

    private String keyFor(String roomId) {
        return KEY_PREFIX + roomId;
    }
}
