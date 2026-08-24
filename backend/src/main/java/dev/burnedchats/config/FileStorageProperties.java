package dev.burnedchats.config;

import dev.burnedchats.util.ValidationConstants;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Configuration properties for file storage (Phase 4: Media).
 *
 * <p>Binds to properties under the {@code app.files} prefix in application.yml.
 */
@Data
@Component
@ConfigurationProperties(prefix = "app.files")
public class FileStorageProperties {

    /**
     * Filesystem path where encrypted file blobs are stored.
     * Directory is created automatically on startup if it does not exist.
     */
    private String storagePath = "/data/files/";

    /**
     * Maximum allowed file size in bytes (encrypted blob).
     * Default: {@link ValidationConstants#MAX_ENCRYPTED_FILE_SIZE}.
     */
    private long maxFileSize = ValidationConstants.MAX_ENCRYPTED_FILE_SIZE;

    /**
     * TTL for file metadata in Redis.
     * Default: 24 hours.
     */
    private Duration metadataTtl = Duration.ofHours(24);

    /**
     * Interval between cleanup runs that remove orphaned files from filesystem.
     * Default: 15 minutes.
     */
    private Duration cleanupInterval = Duration.ofMinutes(15);

    /**
     * Whether the scheduled cleanup job is enabled.
     * Default: true.
     */
    private boolean cleanupEnabled = true;

    /**
     * Maximum number of concurrent file download streams per user.
     * Default: 3.
     */
    private int maxConcurrentDownloadsPerUser = 3;

    /**
     * TTL for the Redis counter tracking active download slots.
     * Refreshed on each acquire; acts as leak protection if a process crashes
     * before {@code releaseDownloadSlot} runs.
     * Default: 30 minutes.
     */
    private Duration concurrentDownloadSlotTtl = Duration.ofMinutes(30);

    /**
     * File metadata TTL: at least {@code messageTtl} (so a live room feed does not 404 files),
     * not longer than the remaining room-hash TTL, never below one minute.
     */
    public static Duration resolveMetadataTtl(
            Duration defaultTtl,
            Integer messageTtlSeconds,
            Duration roomHashRemaining) {
        Duration ttl = defaultTtl == null || defaultTtl.isZero() || defaultTtl.isNegative()
                ? Duration.ofHours(24)
                : defaultTtl;
        if (messageTtlSeconds != null && messageTtlSeconds > 0) {
            Duration messageTtl = Duration.ofSeconds(messageTtlSeconds.longValue());
            if (messageTtl.compareTo(ttl) > 0) {
                ttl = messageTtl;
            }
        }
        if (roomHashRemaining != null
                && !roomHashRemaining.isNegative()
                && !roomHashRemaining.isZero()
                && roomHashRemaining.compareTo(ttl) < 0) {
            ttl = roomHashRemaining;
        }
        if (ttl.isZero() || ttl.isNegative()) {
            return Duration.ofMinutes(1);
        }
        return ttl;
    }
}
