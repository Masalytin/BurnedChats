package dev.burnedchats.repository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import dev.burnedchats.util.InternalIds;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;

/**
 * Redis repository for user online status tracking.
 *
 * <p>Tracks user presence using Redis String with key pattern: {@code online:{tgId}}
 *
 * <p>Online status is maintained via heartbeat mechanism:
 * <ul>
 *   <li>Client sends heartbeat every 20 seconds</li>
 *   <li>Server sets key with 30-second TTL</li>
 *   <li>Key automatically expires if no heartbeat received</li>
 * </ul>
 *
 * <p>Value stored is the timestamp of last heartbeat (epoch millis).
 *
 * <p>Default TTL: 30 seconds.
 *
 * @see <a href="https://redis.io/docs/manual/keyspace-notifications/">Redis Keyspace Notifications</a>
 */
@Repository
@SuppressWarnings("checkstyle:JavadocMethod")
public class OnlineStatusRepository {

    private static final Logger LOG = LoggerFactory.getLogger(OnlineStatusRepository.class);

    private static final String KEY_PREFIX = "online:";
    private static final Duration DEFAULT_TTL = Duration.ofSeconds(30);

    /**
     * Heartbeat interval recommended for clients (in seconds).
     */
    public static final int HEARTBEAT_INTERVAL_SECONDS = 20;

    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public OnlineStatusRepository(ReactiveRedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Set user as online (heartbeat).
     *
     * <p>This should be called on:
     * <ul>
     *   <li>WebSocket connection established</li>
     *   <li>Periodic heartbeat from client</li>
     *   <li>Any user activity</li>
     * </ul>
     *
     * @param tgId Telegram user ID
     * @return true if status was set
     */
    public Mono<Boolean> setOnline(String internalId) {
        String key = keyFor(internalId);
        String timestamp = String.valueOf(Instant.now().toEpochMilli());

        return redisTemplate.opsForValue()
                .set(key, timestamp, DEFAULT_TTL)
                .doOnSuccess(result -> LOG.trace("User {} marked online", internalId));
    }

    public Mono<Boolean> setOnline(Long telegramId) {
        return setOnline(InternalIds.forTelegramId(telegramId));
    }

    /**
     * Explicitly set user as offline.
     *
     * <p>Called when:
     * <ul>
     *   <li>WebSocket disconnects</li>
     *   <li>User closes Mini App</li>
     *   <li>Explicit logout</li>
     * </ul>
     *
     * @param tgId Telegram user ID
     * @return number of keys deleted (0 or 1)
     */
    public Mono<Long> setOffline(String internalId) {
        String key = keyFor(internalId);

        return redisTemplate.delete(key)
                .doOnSuccess(count -> LOG.debug("User {} marked offline", internalId));
    }

    public Mono<Long> setOffline(Long telegramId) {
        return setOffline(InternalIds.forTelegramId(telegramId));
    }

    /**
     * Check if user is currently online.
     *
     * @param tgId Telegram user ID
     * @return true if online
     */
    public Mono<Boolean> isOnline(String internalId) {
        return redisTemplate.hasKey(keyFor(internalId))
                .doOnSuccess(online -> LOG.trace("User {} online status: {}", internalId, online));
    }

    public Mono<Boolean> isOnline(Long telegramId) {
        return isOnline(InternalIds.forTelegramId(telegramId));
    }

    /**
     * Get last seen timestamp for user.
     *
     * <p>Returns the timestamp of last heartbeat. If user is offline
     * (key expired), returns empty Mono.
     *
     * @param tgId Telegram user ID
     * @return last seen instant, or empty if offline
     */
    public Mono<Instant> getLastSeen(String internalId) {
        String key = keyFor(internalId);

        return redisTemplate.opsForValue()
                .get(key)
                .map(timestamp -> Instant.ofEpochMilli(Long.parseLong(timestamp)))
                .doOnSuccess(instant -> {
                    if (instant != null) {
                        LOG.trace("User {} last seen: {}", internalId, instant);
                    }
                });
    }

    /**
     * Check online status for multiple users.
     *
     * @param tgIds collection of Telegram user IDs
     * @return flux of online user IDs
     */
    public Flux<String> getOnlineUsers(Collection<String> internalIds) {
        return Flux.fromIterable(internalIds)
                .filterWhen(this::isOnline)
                .doOnComplete(() -> LOG.debug("Checked online status for {} users", internalIds.size()));
    }

    /**
     * Count currently online users.
     *
     * <p>Note: This scans all online keys - use sparingly in production.
     *
     * @return count of online users
     */
    public Mono<Long> countOnline() {
        return redisTemplate.keys(KEY_PREFIX + "*")
                .count()
                .doOnSuccess(count -> LOG.debug("Online users count: {}", count));
    }

    /**
     * Get all currently online user IDs.
     *
     * <p>Note: This scans all online keys - use sparingly in production.
     *
     * @return flux of online user IDs
     */
    public Flux<String> getAllOnlineUserIds() {
        return redisTemplate.keys(KEY_PREFIX + "*")
                .map(key -> key.substring(KEY_PREFIX.length()))
                .doOnComplete(() -> LOG.debug("Retrieved all online user IDs"));
    }

    /**
     * Get remaining TTL for user's online status.
     *
     * <p>Useful for debugging or determining when user will go offline.
     *
     * @param tgId Telegram user ID
     * @return remaining TTL duration, or empty if not online
     */
    public Mono<Duration> getRemainingTtl(String internalId) {
        String key = keyFor(internalId);

        return redisTemplate.getExpire(key)
                .doOnSuccess(ttl -> {
                    if (ttl != null) {
                        LOG.trace("User {} TTL remaining: {}", internalId, ttl);
                    }
                });
    }

    /**
     * Extend user's online TTL.
     *
     * <p>Same as setOnline but doesn't update timestamp.
     *
     * @param tgId Telegram user ID
     * @return true if TTL was extended
     */
    public Mono<Boolean> extendTtl(String internalId) {
        String key = keyFor(internalId);

        return redisTemplate.expire(key, DEFAULT_TTL)
                .doOnSuccess(result -> LOG.trace("Extended TTL for user {}: {}", internalId, result));
    }

    /**
     * Batch set multiple users as online.
     *
     * <p>Useful for reconnection scenarios.
     *
     * @param tgIds collection of Telegram user IDs
     * @return count of users marked online
     */
    public Mono<Long> setOnlineBatch(Collection<String> internalIds) {
        return Flux.fromIterable(internalIds)
                .flatMap(this::setOnline)
                .filter(result -> result)
                .count()
                .doOnSuccess(count -> LOG.debug("Set {} users online", count));
    }

    /**
     * Batch set multiple users as offline.
     *
     * @param tgIds collection of Telegram user IDs
     * @return count of keys deleted
     */
    public Mono<Long> setOfflineBatch(Collection<String> internalIds) {
        return Flux.fromIterable(internalIds)
                .flatMap(this::setOffline)
                .reduce(0L, Long::sum)
                .doOnSuccess(count -> LOG.debug("Set {} users offline", count));
    }

    private String keyFor(String internalId) {
        return KEY_PREFIX + internalId;
    }

    public static boolean isOnlineKey(String redisKey) {
        return redisKey != null && redisKey.startsWith(KEY_PREFIX) && redisKey.length() > KEY_PREFIX.length();
    }

    public static String parseInternalIdFromOnlineKey(String redisKey) {
        if (!isOnlineKey(redisKey)) {
            return null;
        }
        return redisKey.substring(KEY_PREFIX.length());
    }
}
