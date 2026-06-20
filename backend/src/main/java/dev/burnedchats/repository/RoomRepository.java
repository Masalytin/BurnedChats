package dev.burnedchats.repository;

import dev.burnedchats.model.Room;
import dev.burnedchats.util.InternalIds;
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
    /** Dedicated trigger key; expiry fires deterministic auto-burn (not extended on activity). */
    public static final String AUTO_BURN_TRIGGER_PREFIX = "room:autoburn:";
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
                .then(refreshTtl(room.getId(), room))
                .doOnSuccess(ok -> LOG.debug("Saved room {}", room.getId()))
                .onErrorResume(e -> {
                    LOG.error("Failed to save room {}: {}", room.getId(), e.getMessage());
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
                .doOnNext(room -> LOG.debug("Found room {}", roomId))
                .onErrorResume(e -> {
                    LOG.error("Failed to find room {}: {}", roomId, e.getMessage());
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
                .doOnSuccess(n -> LOG.debug("Deleted room key {} (result={})", roomId, n));
    }

    /**
     * Extend the TTL of an existing room (called on activity).
     *
     * <p>When {@code autoBurnAt} is set on the room, the effective TTL is capped so activity
     * cannot extend the room beyond that instant.
     *
     * @param roomId the room UUID
     * @param ttl    requested TTL duration
     * @return Mono with {@code true} if TTL was set
     */
    public Mono<Boolean> extendTtl(String roomId, Duration ttl) {
        return findById(roomId)
                .flatMap(room -> applyTtl(roomId, effectiveTtl(room, ttl)))
                .switchIfEmpty(applyTtl(roomId, ttl))
                .doOnSuccess(ok -> LOG.debug("Extended TTL for room {}", roomId));
    }

    /**
     * Persist {@code autoBurnAt} on the room hash, align {@code room:{roomId}} TTL, and schedule
     * the dedicated auto-burn trigger key.
     *
     * @param roomId     room UUID
     * @param autoBurnAt absolute burn instant (epoch ms), must be in the future
     * @return Mono completing when hash, room TTL, and trigger key are updated
     */
    public Mono<Boolean> updateAutoBurnAt(String roomId, long autoBurnAt) {
        long remainingMs = autoBurnAt - System.currentTimeMillis();
        if (remainingMs <= 0) {
            return Mono.error(new IllegalArgumentException("AUTO_BURN_IN_PAST"));
        }
        Duration untilBurn = Duration.ofMillis(remainingMs);
        String key = keyFor(roomId);
        return redisTemplate.opsForHash()
                .put(key, "autoBurnAt", String.valueOf(autoBurnAt))
                .then(scheduleAutoBurnTrigger(roomId, untilBurn))
                .then(applyTtl(roomId, untilBurn))
                .doOnSuccess(ok -> LOG.debug("Updated autoBurnAt for room {} to {}", roomId, autoBurnAt))
                .onErrorResume(e -> {
                    LOG.error("Failed to update autoBurnAt for room {}: {}", roomId, e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Set or refresh the dedicated auto-burn trigger key (not extended on room activity).
     */
    public Mono<Boolean> scheduleAutoBurnTrigger(String roomId, Duration ttl) {
        if (ttl.isZero() || ttl.isNegative()) {
            return Mono.just(true);
        }
        return redisTemplate.opsForValue()
                .set(autoBurnKeyFor(roomId), roomId, ttl)
                .doOnSuccess(ok -> LOG.debug("Scheduled auto-burn trigger for room {} in {}", roomId, ttl));
    }

    /**
     * Remove the auto-burn trigger key (e.g. after manual burn).
     */
    public Mono<Long> cancelAutoBurnTrigger(String roomId) {
        return redisTemplate.delete(autoBurnKeyFor(roomId));
    }

    /**
     * Compute TTL capped at {@code autoBurnAt} when present.
     */
    public static Duration effectiveTtl(Room room, Duration requested) {
        if (room == null || room.getAutoBurnAt() == null) {
            return requested;
        }
        long remainingMs = room.getAutoBurnAt() - System.currentTimeMillis();
        if (remainingMs <= 0) {
            return Duration.ZERO;
        }
        return Duration.ofMillis(Math.min(remainingMs, requested.toMillis()));
    }

    public static boolean isAutoBurnTriggerKey(String key) {
        return key != null && key.startsWith(AUTO_BURN_TRIGGER_PREFIX);
    }

    public static String parseRoomIdFromAutoBurnKey(String key) {
        if (!isAutoBurnTriggerKey(key)) {
            return null;
        }
        return key.substring(AUTO_BURN_TRIGGER_PREFIX.length());
    }

    /**
     * Update encrypted room name fields and refresh TTL.
     *
     * @param roomId         room UUID
     * @param nameEncrypted  Base64 AES-GCM ciphertext (opaque to server)
     * @param nameIv         Base64 12-byte GCM IV
     * @return Mono completing when both hash fields and TTL are updated
     */
    public Mono<Boolean> updateEncryptedName(String roomId, String nameEncrypted, String nameIv) {
        String key = keyFor(roomId);
        return redisTemplate.opsForHash()
                .put(key, "nameEncrypted", nameEncrypted != null ? nameEncrypted : "")
                .then(redisTemplate.opsForHash().put(key, "nameIv", nameIv != null ? nameIv : ""))
                .then(refreshTtl(roomId, null))
                .doOnSuccess(ok -> LOG.debug("Updated encrypted name for room {}", roomId))
                .onErrorResume(e -> {
                    LOG.error("Failed to update encrypted name for room {}: {}", roomId, e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Update per-room message auto-destruction timer and refresh room TTL.
     *
     * @param roomId            room UUID
     * @param messageTtlSeconds seconds; {@code 0} disables per-message pruning
     * @return Mono completing when the hash field and TTL are updated
     */
    public Mono<Boolean> updateMessageTtl(String roomId, int messageTtlSeconds) {
        if (messageTtlSeconds < 0) {
            return Mono.error(new IllegalArgumentException("INVALID_MESSAGE_TTL"));
        }
        String key = keyFor(roomId);
        return redisTemplate.opsForHash()
                .put(key, "messageTtl", String.valueOf(messageTtlSeconds))
                .then(refreshTtl(roomId, null))
                .doOnSuccess(ok -> LOG.debug("Updated messageTtl={} for room {}", messageTtlSeconds, roomId))
                .onErrorResume(e -> {
                    LOG.error("Failed to update messageTtl for room {}: {}", roomId, e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Update read-only mode and refresh TTL.
     *
     * @param roomId   room UUID
     * @param readOnly when {@code true}, only the owner may send messages
     * @return Mono completing when the hash field and TTL are updated
     */
    public Mono<Boolean> updateReadOnly(String roomId, boolean readOnly) {
        String key = keyFor(roomId);
        return redisTemplate.opsForHash()
                .put(key, "readOnly", String.valueOf(readOnly))
                .then(refreshTtl(roomId, null))
                .doOnSuccess(ok -> LOG.debug("Updated readOnly={} for room {}", readOnly, roomId))
                .onErrorResume(e -> {
                    LOG.error("Failed to update readOnly for room {}: {}", roomId, e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Update room owner internal ID and refresh TTL.
     *
     * @param roomId              room UUID
     * @param newOwnerInternalId  canonical internal ID of the new owner
     * @return Mono completing when the hash field and TTL are updated
     */
    public Mono<Boolean> updateOwnerInternalId(String roomId, String newOwnerInternalId) {
        String key = keyFor(roomId);
        String value = newOwnerInternalId != null ? newOwnerInternalId : "";
        return redisTemplate.opsForHash()
                .put(key, "ownerInternalId", value)
                .then(refreshTtl(roomId, null))
                .doOnSuccess(ok -> LOG.debug("Updated ownerInternalId for room {}", roomId))
                .onErrorResume(e -> {
                    LOG.error("Failed to update owner for room {}: {}", roomId, e.getMessage());
                    return Mono.just(false);
                });
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private String keyFor(String roomId) {
        return KEY_PREFIX + roomId;
    }

    private String autoBurnKeyFor(String roomId) {
        return AUTO_BURN_TRIGGER_PREFIX + roomId;
    }

    private Mono<Boolean> applyTtl(String roomId, Duration ttl) {
        if (ttl.isZero() || ttl.isNegative()) {
            return Mono.just(true);
        }
        return redisTemplate.expire(keyFor(roomId), ttl);
    }

    private Mono<Boolean> refreshTtl(String roomId, Room knownRoom) {
        if (knownRoom != null) {
            return applyTtl(roomId, effectiveTtl(knownRoom, DEFAULT_TTL));
        }
        return findById(roomId)
                .flatMap(room -> applyTtl(roomId, effectiveTtl(room, DEFAULT_TTL)))
                .switchIfEmpty(applyTtl(roomId, DEFAULT_TTL));
    }

    private Map<String, String> toHash(Room room) {
        Map<String, String> map = new HashMap<>();
        map.put("id", room.getId());
        map.put("ownerInternalId", room.getOwnerInternalId() != null ? room.getOwnerInternalId() : "");
        map.put("ownerTgId", room.getOwnerTgId() != null ? String.valueOf(room.getOwnerTgId()) : "");
        map.put("salt", room.getSalt() != null ? room.getSalt() : "");
        map.put("passwordProofHash", room.getPasswordProofHash() != null ? room.getPasswordProofHash() : "");
        map.put("joinMode", room.getJoinMode().name());
        map.put("createdAt", String.valueOf(room.getCreatedAt()));
        map.put("nameEncrypted", room.getNameEncrypted() != null ? room.getNameEncrypted() : "");
        map.put("nameIv", room.getNameIv() != null ? room.getNameIv() : "");
        map.put("readOnly", String.valueOf(room.isReadOnly()));
        if (room.getAutoBurnAt() != null) {
            map.put("autoBurnAt", String.valueOf(room.getAutoBurnAt()));
        }
        if (room.getMessageTtl() > 0) {
            map.put("messageTtl", String.valueOf(room.getMessageTtl()));
        }
        return map;
    }

    private Room fromHash(Map<String, String> hash) {
        String nameEncrypted = hash.getOrDefault("nameEncrypted", "");
        String nameIv = hash.getOrDefault("nameIv", "");
        String salt = hash.getOrDefault("salt", "");
        String passwordProofHash = hash.getOrDefault("passwordProofHash", "");
        String ownerInternalRaw = hash.getOrDefault("ownerInternalId", "");
        Long ownerTgId = parseLongOrNull(hash.get("ownerTgId"));
        String ownerInternalId = normalizeStoredOwnerInternalId(ownerInternalRaw, ownerTgId);
        Long autoBurnAt = parseLongOrNull(hash.get("autoBurnAt"));
        int messageTtl = parseIntOrDefault(hash.get("messageTtl"), 0);
        return Room.builder()
                .id(hash.get("id"))
                .ownerInternalId(ownerInternalId)
                .ownerTgId(ownerTgId)
                .salt(salt.isEmpty() ? null : salt)
                .passwordProofHash(passwordProofHash.isEmpty() ? null : passwordProofHash)
                .joinMode(Room.JoinMode.valueOf(hash.get("joinMode")))
                .createdAt(Long.parseLong(hash.get("createdAt")))
                .nameEncrypted(nameEncrypted.isBlank() ? null : nameEncrypted)
                .nameIv(nameIv.isBlank() ? null : nameIv)
                .readOnly(parseBooleanOrDefault(hash.get("readOnly"), false))
                .autoBurnAt(autoBurnAt)
                .messageTtl(messageTtl)
                .build();
    }

    private static int parseIntOrDefault(String value, int defaultValue) {
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private static boolean parseBooleanOrDefault(String value, boolean defaultValue) {
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        return Boolean.parseBoolean(value);
    }

    /**
     * Legacy rows may omit {@code ownerInternalId} or store a numeric Telegram id in that field.
     */
    private static String normalizeStoredOwnerInternalId(String raw, Long ownerTgId) {
        if (raw != null && !raw.isBlank()) {
            boolean allDigits = raw.chars().allMatch(Character::isDigit);
            if (allDigits) {
                try {
                    long asTg = Long.parseLong(raw);
                    if (ownerTgId == null || ownerTgId.equals(asTg)) {
                        return InternalIds.forTelegramId(asTg);
                    }
                } catch (NumberFormatException ignored) {
                    // keep raw
                }
            }
            return raw;
        }
        if (ownerTgId != null) {
            return InternalIds.forTelegramId(ownerTgId);
        }
        return "";
    }

    private Long parseLongOrNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
