package dev.burnedchats.service;

import dev.burnedchats.model.FileMetadata;
import dev.burnedchats.repository.FileMetadataRepository;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * Validates file messages during STOMP relay.
 *
 * <p>Before relaying a file message to peers or room subscribers, the server
 * must verify:
 * <ul>
 *   <li>The file exists in Redis ({@code file_meta:{fileId}})</li>
 *   <li>The uploader matches the message sender (ownership by {@code internalId})</li>
 *   <li>The file was uploaded in the same context (session/room) as the message</li>
 * </ul>
 *
 * <p>If a thumbnail file ID is provided, the same checks are applied.
 *
 * <p>Error codes returned via {@link FileValidationException}:
 * <ul>
 *   <li>{@code FILE_NOT_FOUND} — fileId does not exist or has expired</li>
 *   <li>{@code FILE_NOT_OWNED} — uploader does not match the sender</li>
 *   <li>{@code FILE_CONTEXT_MISMATCH} — file context does not match session/room</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.MessageHandler
 * @see dev.burnedchats.handler.RoomMessageHandler
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FileMessageRelayValidator {

    private static final String TEXT_TYPE = "text";

    private final FileMetadataRepository fileMetadataRepository;

    /**
     * Validate file fields for a non-text message.
     *
     * <p>Validates the main fileId and, if present, the thumbnailFileId.
     * Returns {@link Mono#empty()} on success or signals
     * {@link FileValidationException} on failure.
     *
     * @param fileId             the main file ID (must not be null for non-text)
     * @param thumbnailFileId    the optional thumbnail file ID (may be null)
     * @param senderInternalId   canonical sender identity ({@code internalId})
     * @param senderTgId         optional Telegram user ID (legacy fallback only)
     * @param contextId          session ID or room ID the message belongs to
     * @return empty Mono on success, error signal on failure
     */
    public Mono<Void> validateFileMessage(String fileId, String thumbnailFileId,
                                          String senderInternalId, Long senderTgId,
                                          String contextId) {
        Mono<Void> mainValidation = validateSingleFile(fileId, senderInternalId, senderTgId, contextId);

        if (thumbnailFileId != null && !thumbnailFileId.isBlank()) {
            return mainValidation
                    .then(validateSingleFile(thumbnailFileId, senderInternalId, senderTgId, contextId));
        }
        return mainValidation;
    }

    /**
     * Check whether the given message type represents a file message.
     *
     * @param type message type string (may be null)
     * @return true if the type is a file type (image, video, file)
     */
    public static boolean isFileMessage(String type) {
        return type != null && !TEXT_TYPE.equals(type);
    }

    private Mono<Void> validateSingleFile(String fileId, String senderInternalId,
                                        Long senderTgId, String contextId) {
        return fileMetadataRepository.findById(fileId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.debug("File metadata not found during relay validation: {}", fileId);
                    return Mono.error(new FileValidationException("FILE_NOT_FOUND", fileId));
                }))
                .flatMap(meta -> checkOwnershipAndContext(meta, senderInternalId, senderTgId, contextId))
                .then();
    }

    private Mono<FileMetadata> checkOwnershipAndContext(FileMetadata meta,
                                                         String senderInternalId,
                                                         Long senderTgId,
                                                         String contextId) {
        if (!isOwner(meta, senderInternalId, senderTgId)) {
            LOG.debug("File {} not owned by sender internalId={}, actual uploaderInternalId={}, uploaderTgId={}",
                    meta.getFileId(), senderInternalId, meta.getUploaderInternalId(), meta.getUploaderTgId());
            return Mono.error(new FileValidationException("FILE_NOT_OWNED", meta.getFileId()));
        }
        if (!contextId.equals(meta.getContextId())) {
            LOG.debug("File {} context mismatch: expected {}, actual {}",
                    meta.getFileId(), contextId, meta.getContextId());
            return Mono.error(new FileValidationException("FILE_CONTEXT_MISMATCH", meta.getFileId()));
        }
        return Mono.just(meta);
    }

    /**
     * Ownership check: canonical {@code uploaderInternalId} first; legacy fallback
     * via {@code uploaderTgId} only when internalId was not stored at upload time.
     */
    static boolean isOwner(FileMetadata meta, String senderInternalId, Long senderTgId) {
        if (meta.getUploaderInternalId() != null) {
            return meta.getUploaderInternalId().equals(senderInternalId);
        }
        return senderTgId != null
                && String.valueOf(senderTgId).equals(meta.getUploaderTgId());
    }

    /**
     * Exception thrown when file validation fails during message relay.
     */
    @Getter
    public static class FileValidationException extends RuntimeException {

        private static final long serialVersionUID = 1L;

        private final String errorCode;
        private final String fileId;

        public FileValidationException(String errorCode, String fileId) {
            super(errorCode + ": " + fileId);
            this.errorCode = errorCode;
            this.fileId = fileId;
        }
    }
}
