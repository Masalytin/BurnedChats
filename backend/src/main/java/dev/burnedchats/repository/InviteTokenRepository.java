package dev.burnedchats.repository;

import dev.burnedchats.model.InviteToken;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
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

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Persist a new invite token with a TTL matching its expiry.
     *
     * @param token the invite token to store
     * @return Mono completing with {@code true} on success
     */
    public Mono<Boolean> save(InviteToken token) {
        String key = keyFor(token.getToken());
        Map<String, String> hash = toHash(token);

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
                .map(this::fromHash)
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
     * Delete an invite token immediately (e.g. after maxUses is reached).
     *
     * @param token the token string
     * @return Mono with the number of keys deleted
     */
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

    private Map<String, String> toHash(InviteToken token) {
        Map<String, String> map = new HashMap<>();
        map.put("token", token.getToken());
        map.put("roomId", token.getRoomId());
        map.put("createdBy", String.valueOf(token.getCreatedBy()));
        map.put("expiresAt", String.valueOf(token.getExpiresAt()));
        map.put("maxUses", token.getMaxUses() != null ? String.valueOf(token.getMaxUses()) : "");
        map.put("usedCount", String.valueOf(token.getUsedCount() != null ? token.getUsedCount() : 0));
        return map;
    }

    private InviteToken fromHash(Map<String, String> hash) {
        String maxUsesStr = hash.getOrDefault("maxUses", "");
        return InviteToken.builder()
                .token(hash.get("token"))
                .roomId(hash.get("roomId"))
                .createdBy(Long.parseLong(hash.get("createdBy")))
                .expiresAt(Long.parseLong(hash.get("expiresAt")))
                .maxUses(maxUsesStr.isBlank() ? null : Integer.parseInt(maxUsesStr))
                .usedCount(Integer.parseInt(hash.getOrDefault("usedCount", "0")))
                .build();
    }
}
