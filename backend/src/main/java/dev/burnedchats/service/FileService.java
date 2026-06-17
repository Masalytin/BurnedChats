package dev.burnedchats.service;

import dev.burnedchats.exception.BurnedChatsException;
import dev.burnedchats.model.FileMetadata;
import dev.burnedchats.repository.FileMetadataRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.RestIdentityAuthService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.UUID;

/**
 * Business logic for file upload and download operations.
 *
 * <p>Orchestrates authentication, authorization, validation,
 * file storage, and metadata persistence for encrypted file transfers.
 *
 * @see FileStorageService
 * @see FileMetadataRepository
 * @see FileValidationService
 */
@Slf4j
@Service
public class FileService {

    private final RestIdentityAuthService restIdentityAuthService;
    private final FileStorageService fileStorageService;
    private final FileMetadataRepository fileMetadataRepository;
    private final SessionRepository sessionRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final FileValidationService fileValidationService;

    public FileService(RestIdentityAuthService restIdentityAuthService,
                       FileStorageService fileStorageService,
                       FileMetadataRepository fileMetadataRepository,
                       SessionRepository sessionRepository,
                       RoomMembersRepository roomMembersRepository,
                       FileValidationService fileValidationService) {
        this.restIdentityAuthService = restIdentityAuthService;
        this.fileStorageService = fileStorageService;
        this.fileMetadataRepository = fileMetadataRepository;
        this.sessionRepository = sessionRepository;
        this.roomMembersRepository = roomMembersRepository;
        this.fileValidationService = fileValidationService;
    }

    /**
     * Result of a successful file upload.
     *
     * @param fileId generated UUID for the stored file
     * @param size   size of the uploaded blob in bytes
     */
    public record UploadResult(String fileId, long size) {}

    /**
     * Result of a successful file download preparation.
     *
     * @param data reactive stream of encrypted binary data
     * @param size size of the file in bytes
     */
    public record DownloadResult(Flux<DataBuffer> data, long size) {}

    /**
     * Upload an encrypted file blob.
     *
     * <p>Pipeline: authenticate → validate (size + rate limit + context type)
     * → validate membership → save blob → save metadata → return result.
     *
     * @param authType      {@code telegram} or {@code wallet}; defaults to {@code telegram}
     * @param initData      Telegram Mini App initData (telegram mode)
     * @param authToken     opaque wallet session token (wallet mode)
     * @param contextType   "session" or "room"
     * @param contextId     session ID or room ID the file belongs to
     * @param contentLength declared size of the blob in bytes
     * @param data          reactive stream of encrypted binary data
     * @return upload result containing fileId and size
     */
    public Mono<UploadResult> upload(String authType, String initData, String authToken,
                                     String contextType, String contextId,
                                     long contentLength, Flux<DataBuffer> data) {
        return restIdentityAuthService.resolve(authType, initData, authToken)
                .flatMap(identity -> {
                    String internalId = identity.internalId();
                    String fileId = UUID.randomUUID().toString();

                    return fileValidationService.validateUpload(contentLength, contextType, internalId)
                            .then(validateMembership(internalId, contextType, contextId))
                            .then(fileStorageService.save(fileId, data))
                            .then(verifyStoredSizeMatchesContentLength(fileId, contentLength))
                            .then(Mono.defer(() -> {
                                FileMetadata metadata = FileMetadata.builder()
                                        .fileId(fileId)
                                        .uploaderTgId(identity.uploaderTgId())
                                        .contextType(contextType)
                                        .contextId(contextId)
                                        .size(contentLength)
                                        .createdAt(Instant.now().toEpochMilli())
                                        .build();
                                return fileMetadataRepository.save(metadata);
                            }))
                            .thenReturn(new UploadResult(fileId, contentLength))
                            .doOnSuccess(r -> LOG.info(
                                    "File uploaded: fileId={}, internalId={}, context={}:{}, size={}",
                                    fileId, internalId, contextType, contextId, contentLength))
                            .doOnError(e -> {
                                fileStorageService.delete(fileId).subscribe();
                                LOG.error("File upload failed: internalId={}, context={}:{}",
                                        internalId, contextType, contextId, e);
                            });
                });
    }

    /**
     * Download an encrypted file blob.
     *
     * <p>Pipeline: authenticate → find metadata → validate membership
     * → verify file exists on storage → return streaming data.
     *
     * @param authType  {@code telegram} or {@code wallet}; defaults to {@code telegram}
     * @param initData  Telegram Mini App initData (telegram mode)
     * @param authToken opaque wallet session token (wallet mode)
     * @param fileId    unique file identifier
     * @return download result with streaming data and file size
     */
    public Mono<DownloadResult> download(String authType, String initData, String authToken,
                                         String fileId) {
        return restIdentityAuthService.resolve(authType, initData, authToken)
                .flatMap(identity -> {
                    String internalId = identity.internalId();

                    return fileMetadataRepository.findById(fileId)
                            .switchIfEmpty(Mono.error(new BurnedChatsException(
                                    "File not found: " + fileId, "FILE_NOT_FOUND")))
                            .flatMap(metadata ->
                                    validateMembership(internalId, metadata.getContextType(), metadata.getContextId())
                                            .then(fileValidationService.acquireDownloadSlot(internalId))
                                            .thenReturn(metadata))
                            .flatMap(metadata ->
                                    fileStorageService.exists(fileId)
                                            .flatMap(exists -> {
                                                if (!exists) {
                                                    return fileValidationService.releaseDownloadSlot(internalId)
                                                            .then(fileMetadataRepository.delete(fileId))
                                                            .then(Mono.error(new BurnedChatsException(
                                                                    "File not found: " + fileId,
                                                                    "FILE_NOT_FOUND")));
                                                }
                                                Flux<DataBuffer> blob = fileStorageService.get(fileId)
                                                        .doFinally(signal -> fileValidationService
                                                                .releaseDownloadSlot(internalId)
                                                                .subscribe());
                                                long size = metadata.getSize() != null ? metadata.getSize() : 0;
                                                return Mono.just(new DownloadResult(blob, size));
                                            }))
                            .doOnSuccess(r -> LOG.info("File download started: fileId={}, internalId={}",
                                    fileId, internalId))
                            .doOnError(e -> LOG.error("File download failed: fileId={}, internalId={}",
                                    fileId, internalId, e));
                });
    }

    /**
     * Ensures the bytes written to storage match {@code Content-Length} so truncated
     * uploads (connection drop) do not produce valid metadata + orphaned partial files
     * that look complete.
     */
    private Mono<Void> verifyStoredSizeMatchesContentLength(String fileId, long expectedBytes) {
        return fileStorageService.fileSize(fileId)
                .switchIfEmpty(Mono.defer(() -> {
                    LOG.warn("Upload size check: file missing on disk after save, fileId={}", fileId);
                    return Mono.error(new BurnedChatsException(
                            "Stored file missing after upload", "FILE_SIZE_INVALID"));
                }))
                .flatMap(actual -> {
                    if (!actual.equals(expectedBytes)) {
                        LOG.warn("Upload size mismatch: fileId={}, expected={}, actual={}",
                                fileId, expectedBytes, actual);
                        return fileStorageService.delete(fileId)
                                .then(Mono.error(new BurnedChatsException(
                                        "Uploaded size does not match Content-Length",
                                        "FILE_SIZE_INVALID")));
                    }
                    return Mono.<Void>empty();
                });
    }

    private Mono<Void> validateMembership(String internalId, String contextType, String contextId) {
        if ("session".equals(contextType)) {
            return sessionRepository.findById(contextId)
                    .switchIfEmpty(Mono.error(new BurnedChatsException(
                            "Session not found: " + contextId, "CONTEXT_NOT_FOUND")))
                    .flatMap(session -> {
                        if (!session.isParticipant(internalId)) {
                            return Mono.<Void>error(new BurnedChatsException(
                                    "User is not a participant of session: " + contextId,
                                    "ACCESS_DENIED"));
                        }
                        return Mono.empty();
                    });
        }

        return roomMembersRepository.isMember(contextId, internalId)
                .flatMap(isMember -> {
                    if (!isMember) {
                        return Mono.<Void>error(new BurnedChatsException(
                                "User is not a member of room: " + contextId,
                                "ACCESS_DENIED"));
                    }
                    return Mono.empty();
                });
    }
}
