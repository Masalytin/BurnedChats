package dev.burnedchats.service;

import dev.burnedchats.config.FileStorageProperties;
import dev.burnedchats.exception.BurnedChatsException;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.util.ValidationConstants;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Duration;

/**
 * Validates file upload requests and enforces concurrent download limits.
 *
 * <p>Server-side validation is limited to size and rate limiting since
 * files are encrypted — MIME type validation is the client's responsibility.
 *
 * @see ValidationConstants
 */
@Slf4j
@Service
public class FileValidationService {

    private static final String DOWNLOAD_SLOT_KEY_PREFIX = "filedownload:active:";
    private static final Duration CONCURRENT_DOWNLOAD_RETRY_AFTER = Duration.ofSeconds(5);

    private final FileStorageProperties fileStorageProperties;
    private final RateLimitService rateLimitService;
    private final ReactiveRedisTemplate<String, String> redisTemplate;

    public FileValidationService(FileStorageProperties fileStorageProperties,
                                 RateLimitService rateLimitService,
                                 ReactiveRedisTemplate<String, String> redisTemplate) {
        this.fileStorageProperties = fileStorageProperties;
        this.rateLimitService = rateLimitService;
        this.redisTemplate = redisTemplate;
    }

    /**
     * Validate an upload request: file size, context type, and rate limit.
     *
     * @param size          declared file size in bytes
     * @param contextType   "session" or "room"
     * @param uploaderTgId  Telegram user ID of the uploader
     * @return Mono completing normally if valid; error signal otherwise
     */
    public Mono<Void> validateUpload(long size, String contextType, String uploaderTgId) {
        long maxSize = fileStorageProperties.getMaxFileSize();

        if (size <= 0 || size > maxSize) {
            return Mono.error(new BurnedChatsException(
                    "File size must be between 1 and " + maxSize + " bytes",
                    "FILE_TOO_LARGE"));
        }

        if (!ValidationConstants.CONTEXT_TYPE_SESSION.equals(contextType)
                && !ValidationConstants.CONTEXT_TYPE_ROOM.equals(contextType)) {
            return Mono.error(new BurnedChatsException(
                    "Invalid context type: " + contextType + ". Must be 'session' or 'room'",
                    "INVALID_CONTEXT_TYPE"));
        }

        return rateLimitService.checkRateLimit(uploaderTgId, RateLimitService.RateLimitType.FILE_UPLOAD)
                .then();
    }

    /**
     * Reserve a concurrent download slot for the user.
     *
     * <p>Must be called after authentication and membership checks succeed.
     * Pair every successful acquire with {@link #releaseDownloadSlot(String)}.
     *
     * @param internalId stable internal user identifier
     * @return Mono completing when a slot is reserved; {@link RateLimitException} if limit exceeded
     */
    public Mono<Void> acquireDownloadSlot(String internalId) {
        int maxSlots = fileStorageProperties.getMaxConcurrentDownloadsPerUser();
        if (maxSlots <= 0) {
            return Mono.empty();
        }

        String key = downloadSlotKey(internalId);
        Duration slotTtl = fileStorageProperties.getConcurrentDownloadSlotTtl();

        return redisTemplate.opsForValue()
                .increment(key)
                .flatMap(count -> redisTemplate.expire(key, slotTtl).thenReturn(count))
                .flatMap(count -> {
                    if (count > maxSlots) {
                        LOG.warn("Concurrent download limit exceeded: internalId={}, active={}/{}",
                                internalId, count, maxSlots);
                        return redisTemplate.opsForValue()
                                .decrement(key)
                                .then(cleanupDownloadSlotKey(key))
                                .then(Mono.error(new RateLimitException(
                                        "Concurrent download limit exceeded. Please try again later.",
                                        CONCURRENT_DOWNLOAD_RETRY_AFTER)));
                    }
                    LOG.trace("Download slot acquired: internalId={}, active={}/{}",
                            internalId, count, maxSlots);
                    return Mono.empty();
                })
                .then();
    }

    /**
     * Release a previously acquired download slot.
     *
     * @param internalId stable internal user identifier
     * @return Mono completing when the slot counter is decremented
     */
    public Mono<Void> releaseDownloadSlot(String internalId) {
        int maxSlots = fileStorageProperties.getMaxConcurrentDownloadsPerUser();
        if (maxSlots <= 0) {
            return Mono.empty();
        }

        String key = downloadSlotKey(internalId);

        return redisTemplate.opsForValue()
                .decrement(key)
                .flatMap(count -> {
                    if (count <= 0) {
                        return redisTemplate.delete(key).thenReturn(0L);
                    }
                    return Mono.just(count);
                })
                .doOnSuccess(remaining -> LOG.trace(
                        "Download slot released: internalId={}, remaining={}", internalId, remaining))
                .then();
    }

    private Mono<Boolean> cleanupDownloadSlotKey(String key) {
        return redisTemplate.opsForValue()
                .get(key)
                .defaultIfEmpty("0")
                .flatMap(value -> {
                    try {
                        if (Long.parseLong(value) <= 0) {
                            return redisTemplate.delete(key).map(deleted -> deleted > 0);
                        }
                    } catch (NumberFormatException ignored) {
                        return redisTemplate.delete(key).map(deleted -> deleted > 0);
                    }
                    return Mono.just(false);
                });
    }

    private static String downloadSlotKey(String internalId) {
        return DOWNLOAD_SLOT_KEY_PREFIX + internalId;
    }
}
