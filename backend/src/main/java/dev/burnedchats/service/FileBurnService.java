package dev.burnedchats.service;

import dev.burnedchats.repository.FileMetadataRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * Cascade deletion of all files belonging to a session or room context.
 *
 * <p>Used during burn operations — when a session or room is destroyed,
 * all associated encrypted files must be removed from both the filesystem
 * and Redis metadata.
 *
 * <p>Errors deleting individual files are logged but never block the burn
 * operation (fire-and-forget with logging).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FileBurnService {

    private final FileStorageService fileStorageService;
    private final FileMetadataRepository fileMetadataRepository;

    /**
     * Delete all files associated with a given context (session or room).
     *
     * <p>Flow:
     * <ol>
     *   <li>Look up all fileIds in {@code file_context:{contextId}} set</li>
     *   <li>For each fileId: delete from filesystem, then delete Redis metadata</li>
     *   <li>Delete the context index key itself</li>
     * </ol>
     *
     * <p>Individual file deletion errors are swallowed (logged) so the burn
     * operation is never blocked by a single file failure.
     *
     * @param contextId session ID or room ID
     * @return Mono that completes when cascade deletion is done
     */
    public Mono<Void> deleteFilesForContext(String contextId) {
        return fileMetadataRepository.findFileIdsByContextId(contextId)
                .flatMap(fileId -> deleteSingleFile(fileId)
                        .onErrorResume(e -> {
                            LOG.warn("Failed to delete file {} during burn cascade for context {}: {}",
                                    fileId, contextId, e.getMessage());
                            return Mono.empty();
                        })
                )
                .then(fileMetadataRepository.deleteContextKey(contextId))
                .then()
                .doOnSuccess(v -> LOG.info("Burn cascade file cleanup completed for context: {}", contextId))
                .onErrorResume(e -> {
                    LOG.error("Burn cascade file cleanup failed for context {}: {}", contextId, e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * Best-effort removal of a message's file attachment(s) from storage and Redis metadata.
     * Does not block the caller on failures (logs at WARN).
     *
     * @param fileId          main file id, or null
     * @param thumbnailFileId optional thumbnail id, or null
     */
    public void burnFiles(String fileId, String thumbnailFileId) {
        if (fileId != null && !fileId.isBlank()) {
            deleteSingleFile(fileId)
                    .onErrorResume(e -> {
                        LOG.warn("Failed to burn main file {}: {}", fileId, e.getMessage());
                        return Mono.empty();
                    })
                    .subscribe();
        }
        if (thumbnailFileId != null && !thumbnailFileId.isBlank()
                && !thumbnailFileId.equals(fileId)) {
            deleteSingleFile(thumbnailFileId)
                    .onErrorResume(e -> {
                        LOG.warn("Failed to burn thumbnail {}: {}", thumbnailFileId, e.getMessage());
                        return Mono.empty();
                    })
                    .subscribe();
        }
    }

    private Mono<Void> deleteSingleFile(String fileId) {
        return fileStorageService.delete(fileId)
                .doOnNext(deleted -> {
                    if (deleted) {
                        LOG.debug("Deleted file from storage during burn: {}", fileId);
                    } else {
                        LOG.debug("File already absent from storage during burn: {}", fileId);
                    }
                })
                .then(fileMetadataRepository.delete(fileId))
                .then();
    }
}
