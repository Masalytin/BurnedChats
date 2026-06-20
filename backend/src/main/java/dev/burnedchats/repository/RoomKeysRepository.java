package dev.burnedchats.repository;

import dev.burnedchats.model.EncryptedKeyBundle;
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
 * Redis repository for encrypted group-key bundles.
 *
 * <p>Implements the storage layer described in GROUP_KEY_PROTOCOL.md.
 * The server stores only opaque encrypted blobs — it never has access to
 * the plaintext group key.
 *
 * <h3>Key patterns</h3>
 * <pre>
 * room_keys:{roomId}:{epoch}   — Hash: tgId → serialised {@link EncryptedKeyBundle}
 *   TTL: KEY_BUNDLE_TTL (7 days)
 *
 * room_key_epoch:{roomId}      — String: current epoch number (integer)
 *   TTL: EPOCH_TTL (30 days, matches room TTL)
 * </pre>
 *
 * <h3>Lifecycle</h3>
 * <ol>
 *   <li>Room created → owner wraps the group key for themselves (epoch 0) and calls
 *       {@link #putEncryptedKey}.</li>
 *   <li>New member joins (JOIN_APPROVED) → owner wraps the key for the new member and
 *       calls {@link #putEncryptedKey} for the same epoch.</li>
 *   <li>Member leaves / is removed (rekey) → new epoch generated; owner calls
 *       {@link #putEncryptedKey} for all remaining members with epoch+1, then
 *       {@link #deleteEpoch} to remove the old epoch's blobs.</li>
 *   <li>Room burned → {@link #deleteRoom} removes all epochs and the epoch counter.</li>
 * </ol>
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class RoomKeysRepository {

    /** Key prefix for per-epoch key bundles. */
    private static final String KEYS_PREFIX = "room_keys:";

    /** Key prefix for the current epoch counter. */
    private static final String EPOCH_PREFIX = "room_key_epoch:";

    /** TTL for encrypted key bundles: 7 days (longer than typical room TTL to survive offline members). */
    public static final Duration KEY_BUNDLE_TTL = Duration.ofDays(7);

    /** TTL for the epoch counter: matches room TTL (30 days). */
    public static final Duration EPOCH_TTL = Duration.ofDays(30);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    // -------------------------------------------------------------------------
    // Key Bundle Operations
    // -------------------------------------------------------------------------

    /**
     * Store an encrypted group-key bundle for one member at the given epoch.
     *
     * <p>Uses HSET on {@code room_keys:{roomId}:{epoch}} with field = {@code tgId}.
     * Idempotent — calling again overwrites the previous bundle for that member/epoch.
     *
     * @param bundle the encrypted key bundle to store
     * @return Mono completing with {@code true} on success
     */
    public Mono<Boolean> putEncryptedKey(EncryptedKeyBundle bundle) {
        String key = keysKeyFor(bundle.getRoomId(), bundle.getEpoch());
        String value = serialise(bundle);

        return redisTemplate.opsForHash()
                .put(key, bundle.getRecipientInternalId(), value)
                .then(redisTemplate.expire(key, KEY_BUNDLE_TTL))
                .doOnSuccess(ok -> LOG.debug(
                        "Stored key bundle for member {} in room {} epoch {}",
                        bundle.getRecipientInternalId(), bundle.getRoomId(), bundle.getEpoch()))
                .onErrorResume(e -> {
                    LOG.error("Failed to store key bundle for member {} in room {}: {}",
                            bundle.getRecipientInternalId(), bundle.getRoomId(), e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Retrieve the encrypted group-key bundle for a specific member and epoch.
     *
     * @param roomId the room UUID
     * @param epoch  the key epoch
     * @param recipientInternalId the recipient's internal ID
     * @return Mono with the bundle, or empty if not found
     */
    public Mono<EncryptedKeyBundle> getEncryptedKey(String roomId, int epoch, String recipientInternalId) {
        String key = keysKeyFor(roomId, epoch);

        return redisTemplate.opsForHash()
                .get(key, (Object) recipientInternalId)
                .filter(v -> v != null)
                .map(v -> String.valueOf(v))
                .filter(v -> !v.isBlank())
                .map(v -> deserialise(v, roomId, epoch, recipientInternalId))
                .doOnNext(b -> LOG.debug("Fetched key bundle for member {} in room {} epoch {}",
                        recipientInternalId, roomId, epoch))
                .onErrorResume(e -> {
                    LOG.error("Failed to fetch key bundle for member {} in room {}: {}",
                            recipientInternalId, roomId, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Retrieve all encrypted key bundles for a given room and epoch.
     *
     * <p>Used by the owner to verify all members have received a bundle,
     * or by the server to fan out bundles on JOIN_APPROVED.
     *
     * @param roomId the room UUID
     * @param epoch  the key epoch
     * @return Flux of all bundles stored for that epoch
     */
    public Flux<EncryptedKeyBundle> getEncryptedKeys(String roomId, int epoch) {
        String key = keysKeyFor(roomId, epoch);

        return redisTemplate.opsForHash()
                .entries(key)
                .map(entry -> deserialise(
                        String.valueOf(entry.getValue()),
                        roomId,
                        epoch,
                        String.valueOf(entry.getKey())))
                .doOnComplete(() -> LOG.debug("Fetched all key bundles for room {} epoch {}", roomId, epoch))
                .onErrorResume(e -> {
                    LOG.error("Failed to fetch key bundles for room {} epoch {}: {}", roomId, epoch, e.getMessage());
                    return Flux.empty();
                });
    }

    /**
     * Delete all encrypted key bundles for a specific epoch.
     *
     * <p>Called after a rekey — the old epoch's blobs are no longer needed
     * once all members have received their new bundles.
     *
     * @param roomId the room UUID
     * @param epoch  the epoch to remove
     * @return Mono with the number of Redis keys deleted
     */
    public Mono<Long> deleteEpoch(String roomId, int epoch) {
        return redisTemplate.delete(keysKeyFor(roomId, epoch))
                .doOnSuccess(n -> LOG.debug("Deleted key bundles for room {} epoch {} (result={})", roomId, epoch, n));
    }

    /**
     * Remove a recipient's encrypted key bundle from every stored epoch for a room.
     *
     * <p>Called when a member is kicked or banned so they cannot decrypt messages
     * from any epoch still present in Redis (until the owner completes rekey).
     *
     * @param roomId the room UUID
     * @param recipientInternalId the removed member's internal ID
     * @return Mono with the total number of hash fields removed across all epochs
     */
    public Mono<Long> removeRecipientAllEpochs(String roomId, String recipientInternalId) {
        return getCurrentEpoch(roomId)
                .defaultIfEmpty(0)
                .flatMap(currentEpoch -> Flux.range(0, currentEpoch + 1)
                        .flatMap(epoch -> redisTemplate.opsForHash()
                                .remove(keysKeyFor(roomId, epoch), recipientInternalId))
                        .reduce(0L, Long::sum))
                .doOnSuccess(n -> LOG.debug(
                        "Removed key bundles for member {} in room {} across all epochs (fields={})",
                        recipientInternalId, roomId, n))
                .onErrorResume(e -> {
                    LOG.error("Failed to remove key bundles for member {} in room {}: {}",
                            recipientInternalId, roomId, e.getMessage());
                    return Mono.just(0L);
                });
    }

    /**
     * Delete all key bundles and the epoch counter for a room.
     *
     * <p>Called on BURN_ROOM. Scans all epochs from 0 up to the current epoch
     * (inclusive) and deletes each one, then removes the epoch counter key.
     *
     * @param roomId the room UUID
     * @return Mono completing when all related keys are removed
     */
    public Mono<Void> deleteRoom(String roomId) {
        return getCurrentEpoch(roomId)
                .defaultIfEmpty(0)
                .flatMap(currentEpoch -> {
                    // Build a list of all epoch keys + the epoch counter key
                    String[] keysToDelete = new String[currentEpoch + 2];
                    for (int e = 0; e <= currentEpoch; e++) {
                        keysToDelete[e] = keysKeyFor(roomId, e);
                    }
                    keysToDelete[currentEpoch + 1] = epochKeyFor(roomId);

                    return redisTemplate.delete(keysToDelete)
                            .doOnSuccess(n -> LOG.debug("Deleted all key data for room {} (keys={})", roomId, n));
                })
                .then()
                .onErrorResume(e -> {
                    LOG.error("Failed to delete key data for room {}: {}", roomId, e.getMessage());
                    return Mono.empty();
                });
    }

    // -------------------------------------------------------------------------
    // Epoch Counter Operations
    // -------------------------------------------------------------------------

    /**
     * Get the current key epoch for a room.
     *
     * @param roomId the room UUID
     * @return Mono with the current epoch, or empty if not set
     */
    public Mono<Integer> getCurrentEpoch(String roomId) {
        return redisTemplate.opsForValue()
                .get(epochKeyFor(roomId))
                .map(Integer::parseInt)
                .doOnNext(epoch -> LOG.debug("Current epoch for room {}: {}", roomId, epoch))
                .onErrorResume(e -> {
                    LOG.error("Failed to get epoch for room {}: {}", roomId, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Set (or update) the current key epoch for a room.
     *
     * @param roomId the room UUID
     * @param epoch  the new epoch value
     * @return Mono completing with {@code true} on success
     */
    public Mono<Boolean> setCurrentEpoch(String roomId, int epoch) {
        return redisTemplate.opsForValue()
                .set(epochKeyFor(roomId), String.valueOf(epoch), EPOCH_TTL)
                .doOnSuccess(ok -> LOG.debug("Set epoch {} for room {}", epoch, roomId))
                .onErrorResume(e -> {
                    LOG.error("Failed to set epoch for room {}: {}", roomId, e.getMessage());
                    return Mono.just(false);
                });
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private String keysKeyFor(String roomId, int epoch) {
        return KEYS_PREFIX + roomId + ":" + epoch;
    }

    private String epochKeyFor(String roomId) {
        return EPOCH_PREFIX + roomId;
    }

    /**
     * Serialise a bundle to a pipe-delimited string for Hash storage.
     * Format: {@code ephemeralPublicKey|encryptedKey|iv}
     */
    private String serialise(EncryptedKeyBundle bundle) {
        return bundle.getEphemeralPublicKey()
                + "|" + bundle.getEncryptedKey()
                + "|" + bundle.getIv();
    }

    /**
     * Deserialise a pipe-delimited bundle string back to an {@link EncryptedKeyBundle}.
     */
    private EncryptedKeyBundle deserialise(String value, String roomId, int epoch, String recipientInternalId) {
        String[] parts = value.split("\\|", 3);
        return EncryptedKeyBundle.builder()
                .roomId(roomId)
                .epoch(epoch)
                .recipientInternalId(recipientInternalId)
                .ephemeralPublicKey(parts.length > 0 ? parts[0] : "")
                .encryptedKey(parts.length > 1 ? parts[1] : "")
                .iv(parts.length > 2 ? parts[2] : "")
                .build();
    }

    /**
     * Build a map representation for bulk HSET operations.
     * Not used internally but exposed as a utility for future batch stores.
     */
    public Map<String, String> toBundleMap(java.util.List<EncryptedKeyBundle> bundles) {
        Map<String, String> map = new HashMap<>();
        for (EncryptedKeyBundle b : bundles) {
            map.put(b.getRecipientInternalId(), serialise(b));
        }
        return map;
    }
}
