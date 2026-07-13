package dev.burnedchats.repository;

import dev.burnedchats.model.TelegramUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Redis repository for Telegram user cache.
 *
 * <p>Caches user information using Redis Hash with key pattern: {@code user:{tgId}}
 *
 * <p>User fields stored:
 * <ul>
 *   <li>id - Telegram user ID</li>
 *   <li>username - Telegram username (without @)</li>
 *   <li>firstName - user's first name</li>
 *   <li>lastName - user's last name</li>
 *   <li>languageCode - user's language preference</li>
 *   <li>photoUrl - profile photo URL</li>
 *   <li>isPremium - whether user is Telegram Premium</li>
 *   <li>cachedAt - when this data was cached</li>
 * </ul>
 *
 * <p>Default TTL: 7 days (refreshed on each access).
 *
 * @see TelegramUser
 */
@Repository
public class UserRepository {

    private static final Logger LOG = LoggerFactory.getLogger(UserRepository.class);

    private static final String KEY_PREFIX = "user:";
    private static final Duration DEFAULT_TTL = Duration.ofDays(7);

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public UserRepository(ReactiveRedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Find user by Telegram ID.
     *
     * @param tgId Telegram user ID
     * @return user if cached, empty Mono otherwise
     */
    public Mono<TelegramUser> findById(Long tgId) {
        String key = keyFor(tgId);

        return redisTemplate.opsForHash()
                .entries(key)
                .collectMap(
                        entry -> entry.getKey().toString(),
                        entry -> entry.getValue().toString()
                )
                .filter(map -> !map.isEmpty())
                .map(this::mapToUser)
                .doOnSuccess(user -> {
                    if (user != null) {
                        LOG.debug("Found cached user: {}", tgId);
                    } else {
                        LOG.debug("User not in cache: {}", tgId);
                    }
                });
    }

    /**
     * Find user by username.
     *
     * <p>Note: This is an expensive operation as it scans all user keys.
     * Consider maintaining a username->id index for frequent lookups.
     *
     * @param username Telegram username (without @)
     * @return user if found
     */
    public Mono<TelegramUser> findByUsername(String username) {
        if (username == null || username.isEmpty()) {
            return Mono.empty();
        }

        String normalizedUsername = username.toLowerCase().replaceFirst("^@", "");

        return redisTemplate.keys(KEY_PREFIX + "*")
                // Skip sub-namespaces like "user:deadman:*" — they hold non-hash values
                // and HGETALL on them fails the whole scan with WRONGTYPE.
                .filter(key -> key.indexOf(':', KEY_PREFIX.length()) < 0)
                .flatMap(key -> redisTemplate.opsForHash().entries(key)
                        .collectMap(
                                entry -> entry.getKey().toString(),
                                entry -> entry.getValue().toString()
                        )
                        .filter(map -> !map.isEmpty())
                        .map(this::mapToUser)
                        .onErrorResume(err -> {
                            LOG.warn("Skipping unreadable user key '{}' during username scan: {}",
                                    key, err.getMessage());
                            return Mono.empty();
                        }))
                .filter(user -> user.getUsername() != null
                        && user.getUsername().toLowerCase().equals(normalizedUsername))
                .next()
                .doOnSuccess(user -> {
                    if (user != null) {
                        LOG.debug("Found user by username: {}", username);
                    } else {
                        LOG.debug("User not found by username: {}", username);
                    }
                });
    }

    /**
     * Save or update user in cache.
     *
     * @param user user to cache
     * @return true if saved
     */
    public Mono<Boolean> save(TelegramUser user) {
        return save(user, null);
    }

    /**
     * Save or update Telegram user cache, optionally storing linked internal id.
     */
    public Mono<Boolean> save(TelegramUser user, String internalId) {
        if (user.getId() == null) {
            return Mono.error(new IllegalArgumentException("User ID cannot be null"));
        }

        String key = keyFor(user.getId());
        Map<String, String> hash = userToMap(user, internalId);

        return redisTemplate.opsForHash()
                .putAll(key, hash)
                .then(redisTemplate.expire(key, DEFAULT_TTL))
                .doOnSuccess(result -> LOG.debug("Saved user to cache: {} (@{})",
                        user.getId(), user.getUsername()));
    }

    /**
     * Save user and refresh TTL.
     *
     * <p>Use this method when user logs in to extend cache lifetime.
     *
     * @param user user to cache
     * @return true if saved
     */
    public Mono<Boolean> saveAndRefreshTtl(TelegramUser user) {
        TelegramUser updatedUser = TelegramUser.builder()
                .id(user.getId())
                .username(user.getUsername())
                .firstName(user.getFirstName())
                .lastName(user.getLastName())
                .languageCode(user.getLanguageCode())
                .photoUrl(user.getPhotoUrl())
                .isPremium(user.isPremium())
                .cachedAt(Instant.now())
                .build();

        return save(updatedUser);
    }

    /**
     * Delete user from cache.
     *
     * @param tgId Telegram user ID
     * @return number of keys deleted
     */
    public Mono<Long> delete(Long tgId) {
        String key = keyFor(tgId);

        return redisTemplate.delete(key)
                .doOnSuccess(count -> LOG.debug("Deleted user from cache: {}", tgId));
    }

    /**
     * Check if user is cached.
     *
     * @param tgId Telegram user ID
     * @return true if cached
     */
    public Mono<Boolean> exists(Long tgId) {
        return redisTemplate.hasKey(keyFor(tgId));
    }

    /**
     * Refresh TTL for cached user.
     *
     * @param tgId Telegram user ID
     * @return true if TTL was set
     */
    public Mono<Boolean> refreshTtl(Long tgId) {
        return redisTemplate.expire(keyFor(tgId), DEFAULT_TTL);
    }

    /**
     * Update specific user fields.
     *
     * @param tgId Telegram user ID
     * @param fields map of field names to values
     * @return true if updated
     */
    public Mono<Boolean> updateFields(Long tgId, Map<String, String> fields) {
        String key = keyFor(tgId);

        return redisTemplate.opsForHash()
                .putAll(key, fields)
                .doOnSuccess(result -> LOG.debug("Updated user fields: {}", tgId));
    }

    /**
     * Get user's display name.
     *
     * @param tgId Telegram user ID
     * @return display name or empty string
     */
    public Mono<String> getDisplayName(Long tgId) {
        return findById(tgId)
                .map(TelegramUser::getDisplayName)
                .defaultIfEmpty("User " + tgId);
    }

    private String keyFor(Long tgId) {
        return KEY_PREFIX + tgId;
    }

    /**
     * Read cached internal id for a Telegram user, if present.
     */
    public Mono<String> findCachedInternalId(Long tgId) {
        String key = keyFor(tgId);
        return redisTemplate.opsForHash()
                .get(key, "internalId")
                .map(Object::toString)
                .filter(value -> !value.isBlank());
    }

    private TelegramUser mapToUser(Map<String, String> hash) {
        return TelegramUser.builder()
                .id(parseLongOrNull(hash.get("id")))
                .username(hash.get("username"))
                .firstName(hash.get("firstName"))
                .lastName(hash.get("lastName"))
                .languageCode(hash.get("languageCode"))
                .photoUrl(hash.get("photoUrl"))
                .isPremium(parseBoolean(hash.get("isPremium")))
                .cachedAt(parseInstantOrNow(hash.get("cachedAt")))
                .build();
    }

    private Map<String, String> userToMap(TelegramUser user, String internalId) {
        Map<String, String> map = new HashMap<>();

        if (user.getId() != null) {
            map.put("id", user.getId().toString());
        }
        if (internalId != null && !internalId.isBlank()) {
            map.put("internalId", internalId);
        }
        if (user.getUsername() != null) {
            map.put("username", user.getUsername());
        }
        if (user.getFirstName() != null) {
            map.put("firstName", user.getFirstName());
        }
        if (user.getLastName() != null) {
            map.put("lastName", user.getLastName());
        }
        if (user.getLanguageCode() != null) {
            map.put("languageCode", user.getLanguageCode());
        }
        if (user.getPhotoUrl() != null) {
            map.put("photoUrl", user.getPhotoUrl());
        }

        map.put("isPremium", String.valueOf(user.isPremium()));
        map.put("cachedAt", String.valueOf(
                user.getCachedAt() != null
                        ? user.getCachedAt().toEpochMilli()
                        : Instant.now().toEpochMilli()));

        return map;
    }

    private Long parseLongOrNull(String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private Instant parseInstantOrNow(String value) {
        if (value == null || value.isEmpty()) {
            return Instant.now();
        }
        try {
            return Instant.ofEpochMilli(Long.parseLong(value));
        } catch (NumberFormatException e) {
            return Instant.now();
        }
    }

    private boolean parseBoolean(String value) {
        return Boolean.parseBoolean(value);
    }
}
