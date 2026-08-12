package dev.burnedchats.repository;

import dev.burnedchats.model.DmInviteToken;
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
 * Redis repository for {@link DmInviteToken} under {@code dm_invite:{token}}.
 *
 * <p>Key patterns:
 * <ul>
 *   <li>{@code dm_invite:{token}} — Hash, TTL derived from {@code expiresAt}</li>
 *   <li>{@code dm_invites:{ownerInternalId}} — Set of token strings (reverse index)</li>
 * </ul>
 *
 * <p>Does not share the room {@code invite:} namespace.
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class DmInviteTokenRepository {

    private static final String KEY_PREFIX = "dm_invite:";
    private static final String OWNER_INDEX_PREFIX = "dm_invites:";

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    /**
     * Persist a new DM invite token with TTL matching {@code expiresAt}.
     */
    public Mono<Boolean> save(DmInviteToken token) {
        String key = keyFor(token.getToken());
        Map<String, String> hash = toHash(token);

        long nowMs = Instant.now().toEpochMilli();
        long ttlMs = Math.max(1000L, token.getExpiresAt() - nowMs);
        Duration ttl = Duration.ofMillis(ttlMs);

        return redisTemplate.opsForHash()
                .putAll(key, hash)
                .then(redisTemplate.expire(key, ttl))
                .then(redisTemplate.opsForSet()
                        .add(ownerIndexKeyFor(token.getOwnerInternalId()), token.getToken()))
                .thenReturn(true)
                .doOnSuccess(ok -> LOG.debug("Saved dm invite token for owner={}", token.getOwnerInternalId()))
                .onErrorResume(e -> {
                    LOG.error("Failed to save dm invite token: {}", e.getMessage());
                    return Mono.just(false);
                });
    }

    /**
     * Find a DM invite by token value.
     */
    public Mono<DmInviteToken> findByToken(String token) {
        return redisTemplate.opsForHash()
                .entries(keyFor(token))
                .collectMap(
                        entry -> String.valueOf(entry.getKey()),
                        entry -> String.valueOf(entry.getValue())
                )
                .filter(map -> !map.isEmpty())
                .map(this::fromHash)
                .doOnNext(t -> LOG.debug("Found dm invite token for owner={}", t.getOwnerInternalId()))
                .onErrorResume(e -> {
                    LOG.error("Failed to find dm invite token: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Atomically increment {@code usedCount} and return the new value.
     */
    public Mono<Long> incrementUseCount(String token) {
        return redisTemplate.opsForHash()
                .increment(keyFor(token), "usedCount", 1)
                .doOnNext(count -> LOG.debug("Incremented dm invite use count: {}", count))
                .onErrorResume(e -> {
                    LOG.error("Failed to increment dm invite use count: {}", e.getMessage());
                    return Mono.just(-1L);
                });
    }

    /**
     * Delete token hash and remove from owner reverse index.
     */
    public Mono<Void> deleteTokenAndIndex(String token, String ownerInternalId) {
        return redisTemplate.delete(keyFor(token))
                .then(redisTemplate.opsForSet().remove(ownerIndexKeyFor(ownerInternalId), token))
                .then()
                .doOnSuccess(v -> LOG.debug("Deleted dm invite token for owner={}", ownerInternalId));
    }

    private String keyFor(String token) {
        return KEY_PREFIX + token;
    }

    private String ownerIndexKeyFor(String ownerInternalId) {
        return OWNER_INDEX_PREFIX + ownerInternalId;
    }

    private Map<String, String> toHash(DmInviteToken token) {
        Map<String, String> map = new HashMap<>();
        map.put("token", token.getToken());
        map.put("ownerInternalId", token.getOwnerInternalId());
        map.put("expiresAt", String.valueOf(token.getExpiresAt()));
        map.put("maxUses", String.valueOf(token.getMaxUses() != null
                ? token.getMaxUses()
                : DmInviteToken.DEFAULT_MAX_USES));
        map.put("usedCount", String.valueOf(token.getUsedCount() != null ? token.getUsedCount() : 0));
        return map;
    }

    private DmInviteToken fromHash(Map<String, String> hash) {
        return DmInviteToken.builder()
                .token(hash.get("token"))
                .ownerInternalId(hash.get("ownerInternalId"))
                .expiresAt(Long.parseLong(hash.get("expiresAt")))
                .maxUses(Integer.parseInt(hash.getOrDefault("maxUses",
                        String.valueOf(DmInviteToken.DEFAULT_MAX_USES))))
                .usedCount(Integer.parseInt(hash.getOrDefault("usedCount", "0")))
                .build();
    }
}
