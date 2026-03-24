package dev.burnedchats.config;

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
     * Default: 25 MB.
     */
    private long maxFileSize = 25 * 1024 * 1024;

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
}
