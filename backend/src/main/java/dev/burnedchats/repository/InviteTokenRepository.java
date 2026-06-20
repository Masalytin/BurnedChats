package dev.burnedchats.repository;

import dev.burnedchats.model.InviteToken;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Redis repository for {@link InviteToken} stored under key {@code invite:{token}}.
 *
 * <p>Uses a Redis Hash per token to allow atomic increment of {@code usedCount}.
 *
 * <p>Key patterns:
 * <ul>
 *   <li>{@code invite:{token}} — Hash, TTL derived from {@code expiresAt}</li>
 *   <li>{@code room_invites:{roomId}} — Set of token strings for reverse lookup (BURN_ROOM)</li>
 * </ul>
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class InviteTokenRepository {

    private static final String KEY_PREFIX = "invite:";
    private static final String ROOM_INVITES_PREFIX = "room_invites:";

    /**
     * Invite token fields loaded from Redis, including {@code createdAt} for owner listing.
     */
    public record StoredInviteToken(
            String token,
            String roomId,
            Long createdBy,
            Long expiresAt,
            Long createdAt,
            Integer maxUses,
            Integer usedCount
    ) {
    }

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Persist a new invite token with a TTL matching its expiry.
     *
     * @param token the invite token to store
     * @return Mono completing with {@code true} on success
     */
    public Mono<Boolean> save(InviteToken token) {
        String key = keyFor(token.getToken());
        Map<String, String> hash = toHash(token, Instant.now().toEpochMilli());

        long nowMs = Instant.now().toEpochMilli();
        long ttlMs = Math.max(1000L, token.getExpiresAt() - nowMs);
        Duration ttl = Duration.ofMillis(ttlMs);

        return redisTemplate.opsForHash()
                .putAll(key, hash)
                .then(redisTemplate.expire(key, ttl))
                .then(redisTemplate.opsForSet()
                        .add(roomInvitesKeyFor(token.getRoomId()), token.getToken()))
                .thenReturn(true)
                .doOnSuccess(ok -> LOG.debug("Saved invite token {} for room {}", token.getToken(), token.getRoomId()))
                .onErrorResume(e -> {
                    LOG.error("Failed to save invite token {}: {}", token.getToken(), e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Find an invite token by its value.
     *
     * @param token the token string
     * @return Mono with the token, or empty if not found or expired
     */
    public Mono<InviteToken> findByToken(String token) {
        String key = keyFor(token);

        return redisTemplate.opsForHash()
                .entries(key)
                .collectMap(
                        entry -> String.valueOf(entry.getKey()),
                        entry -> String.valueOf(entry.getValue())
                )
                .filter(map -> !map.isEmpty())
                .map(this::fromHashToStored)
                .map(this::toInviteToken)
                .doOnNext(t -> LOG.debug("Found invite token {} -> room {}", token, t.getRoomId()))
                .onErrorResume(e -> {
                    LOG.error("Failed to find invite token {}: {}", token, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Atomically increment the {@code usedCount} field and return the new value.
     *
     * <p>Callers should check the result against {@code maxUses} to decide whether the token
     * is still valid after this use.
     *
     * @param token the token string
     * @return Mono with the new usedCount value
     */
    public Mono<Long> incrementUseCount(String token) {
        String key = keyFor(token);

        return redisTemplate.opsForHash()
                .increment(key, "usedCount", 1)
                .doOnNext(count -> LOG.debug("Incremented use count for token {}: {}", token, count))
                .onErrorResume(e -> {
                    LOG.error("Failed to increment use count for token {}: {}", token, e.getMessage());
                    return Mono.just(-1L);
                });
    }

    /**
     * Load all active invite tokens for a room via {@code room_invites:{roomId}}.
     *
     * @param roomId the room UUID
     * @return flux of stored tokens (stale set members without a hash are skipped)
     */
    public Flux<StoredInviteToken> findAllByRoomId(String roomId) {
        return redisTemplate.opsForSet()
                .members(roomInvitesKeyFor(roomId))
                .flatMap(token -> redisTemplate.opsForHash()
                        .entries(keyFor(token))
                        .collectMap(
                                entry -> String.valueOf(entry.getKey()),
                                entry -> String.valueOf(entry.getValue())
                        )
                        .filter(map -> !map.isEmpty())
                        .map(this::fromHashToStored));
    }

    /**
     * Delete an invite token hash and remove it from the room reverse index.
     *
     * @param token  the token string
     * @param roomId the room UUID
     * @return Mono completing when both keys are updated
     */
    public Mono<Void> deleteTokenAndIndex(String token, String roomId) {
        return redisTemplate.delete(keyFor(token))
                .then(redisTemplate.opsForSet().remove(roomInvitesKeyFor(roomId), token))
                .then()
                .doOnSuccess(v -> LOG.debug("Deleted invite token {} for room {}", token, roomId));
    }

    /**
     * Delete an invite token immediately (e.g. after maxUses is reached).
     *
     * @param token the token string
     * @return Mono with the number of keys deleted
     * @deprecated Prefer {@link #deleteTokenAndIndex(String, String)} to keep the room index consistent.
     */
    @Deprecated
    public Mono<Long> delete(String token) {
        return redisTemplate.delete(keyFor(token))
                .doOnSuccess(n -> LOG.debug("Deleted invite token {} (result={})", token, n));
    }

    /**
     * Delete all invite tokens for a room (called on BURN_ROOM).
     *
     * <p>Uses the reverse index {@code room_invites:{roomId}} to locate all token keys,
     * deletes each token hash, then removes the reverse index set.
     *
     * @param roomId the room UUID
     * @return Mono completing when all tokens are removed
     */
    public Mono<Void> deleteAllForRoom(String roomId) {
        String roomInvitesKey = roomInvitesKeyFor(roomId);

        return redisTemplate.opsForSet()
                .members(roomInvitesKey)
                .collectList()
                .flatMap(tokens -> {
                    if (tokens.isEmpty()) {
                        return redisTemplate.delete(roomInvitesKey).then();
                    }
                    String[] tokenKeys = tokens.stream()
                            .map(this::keyFor)
                            .toArray(String[]::new);
                    return redisTemplate.delete(tokenKeys)
                            .then(redisTemplate.delete(roomInvitesKey))
                            .then();
                })
                .doOnSuccess(v -> LOG.debug("Deleted all invite tokens for room {}", roomId))
                .onErrorResume(e -> {
                    LOG.error("Failed to delete invite tokens for room {}: {}", roomId, e.getMessage());
                    return Mono.empty();
                });
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private String keyFor(String token) {
        return KEY_PREFIX + token;
    }

    private String roomInvitesKeyFor(String roomId) {
        return ROOM_INVITES_PREFIX + roomId;
    }

    private Map<String, String> toHash(InviteToken token, long createdAtMs) {
        Map<String, String> map = new HashMap<>();
        map.put("token", token.getToken());
        map.put("roomId", token.getRoomId());
        // createdBy is the owner's Telegram ID and is null for wallet-only owners. Store "" rather
        // than String.valueOf(null)="null", which fromHash would otherwise fail to parse as a Long.
        map.put("createdBy", token.getCreatedBy() != null ? String.valueOf(token.getCreatedBy()) : "");
        map.put("createdAt", String.valueOf(createdAtMs));
        map.put("expiresAt", String.valueOf(token.getExpiresAt()));
        map.put("maxUses", token.getMaxUses() != null ? String.valueOf(token.getMaxUses()) : "");
        map.put("usedCount", String.valueOf(token.getUsedCount() != null ? token.getUsedCount() : 0));
        return map;
    }

    private StoredInviteToken fromHashToStored(Map<String, String> hash) {
        String maxUsesStr = hash.getOrDefault("maxUses", "");
        String createdAtStr = hash.getOrDefault("createdAt", "");
        return new StoredInviteToken(
                hash.get("token"),
                hash.get("roomId"),
                parseNullableLong(hash.get("createdBy")),
                Long.parseLong(hash.get("expiresAt")),
                createdAtStr.isBlank() ? null : Long.parseLong(createdAtStr),
                maxUsesStr.isBlank() ? null : Integer.parseInt(maxUsesStr),
                Integer.parseInt(hash.getOrDefault("usedCount", "0"))
        );
    }

    private InviteToken toInviteToken(StoredInviteToken stored) {
        return InviteToken.builder()
                .token(stored.token())
                .roomId(stored.roomId())
                .createdBy(stored.createdBy())
                .expiresAt(stored.expiresAt())
                .maxUses(stored.maxUses())
                .usedCount(stored.usedCount())
                .build();
    }

    /** Wallet-only owners have a null createdBy; tolerate "" and legacy "null" hash values. */
    private static Long parseNullableLong(String value) {
        if (value == null || value.isBlank() || "null".equals(value)) {
            return null;
        }
        return Long.parseLong(value);
    }
}
