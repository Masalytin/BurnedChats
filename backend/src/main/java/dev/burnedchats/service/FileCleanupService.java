package dev.burnedchats.service;

import dev.burnedchats.repository.FileMetadataRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * Periodic cleanup of orphaned files whose Redis metadata has expired.
 *
 * <p>Scans the storage directory and deletes any file that no longer has
 * a corresponding {@code file_meta:{fileId}} key in Redis (TTL expired).
 *
 * <p>The job is idempotent and safe to overlap — it silently handles
 * files that were already deleted between the listing and the delete call.
 */
@Service
@ConditionalOnProperty(name = "app.files.cleanup-enabled", havingValue = "true", matchIfMissing = true)
public class FileCleanupService {

    private static final Logger log = LoggerFactory.getLogger(FileCleanupService.class);

    private final FileStorageService fileStorageService;
    private final FileMetadataRepository fileMetadataRepository;

    public FileCleanupService(FileStorageService fileStorageService,
                              FileMetadataRepository fileMetadataRepository) {
        this.fileStorageService = fileStorageService;
        this.fileMetadataRepository = fileMetadataRepository;
    }

    /**
     * Scheduled cleanup run.
     * Interval is configured via {@code app.files.cleanup-interval} (default 15 min).
     */
    @Scheduled(fixedDelayString = "#{@fileStorageProperties.cleanupInterval.toMillis()}")
    public void cleanup() {
        log.debug("Starting file cleanup scan");
        AtomicInteger deleted = new AtomicInteger(0);

        fileStorageService.listAll()
                .flatMap(fileId ->
                        fileMetadataRepository.exists(fileId)
                                .filter(exists -> !exists)
                                .flatMap(notExists -> fileStorageService.delete(fileId))
                                .doOnNext(wasDeleted -> {
                                    if (wasDeleted) {
                                        deleted.incrementAndGet();
                                    }
                                })
                )
                .doOnComplete(() -> {
                    int count = deleted.get();
                    if (count > 0) {
                        log.info("File cleanup completed: {} orphaned file(s) deleted", count);
                    } else {
                        log.debug("File cleanup completed: no orphaned files found");
                    }
                })
                .doOnError(e -> log.error("File cleanup failed", e))
                .subscribe();
    }
}
