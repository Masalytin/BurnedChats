package dev.burnedchats.service;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.exception.BurnedChatsException;
import dev.burnedchats.model.FileMetadata;
import dev.burnedchats.repository.FileMetadataRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.TelegramAuthService;
import dev.burnedchats.security.TelegramInitData;
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

    private final TelegramAuthService telegramAuthService;
    private final FileStorageService fileStorageService;
    private final FileMetadataRepository fileMetadataRepository;
    private final SessionRepository sessionRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final FileValidationService fileValidationService;

    public FileService(TelegramAuthService telegramAuthService,
                       FileStorageService fileStorageService,
                       FileMetadataRepository fileMetadataRepository,
                       SessionRepository sessionRepository,
                       RoomMembersRepository roomMembersRepository,
                       FileValidationService fileValidationService) {
        this.telegramAuthService = telegramAuthService;
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
     * @param initData      Telegram Mini App initData for authentication
     * @param contextType   "session" or "room"
     * @param contextId     session ID or room ID the file belongs to
     * @param contentLength declared size of the blob in bytes
     * @param data          reactive stream of encrypted binary data
     * @return upload result containing fileId and size
     */
    public Mono<UploadResult> upload(String initData, String contextType, String contextId,
                                     long contentLength, Flux<DataBuffer> data) {
        return Mono.defer(() -> {
            TelegramInitData authData = telegramAuthService.validateInitData(initData);
            Long tgId = authData.getUserId();
            if (tgId == null) {
                return Mono.error(AuthenticationException.missingField("user.id"));
            }

            String fileId = UUID.randomUUID().toString();

            return fileValidationService.validateUpload(contentLength, contextType, String.valueOf(tgId))
                    .then(validateMembership(tgId, contextType, contextId))
                    .then(fileStorageService.save(fileId, data))
                    .then(Mono.defer(() -> {
                        FileMetadata metadata = FileMetadata.builder()
                                .fileId(fileId)
                                .uploaderTgId(String.valueOf(tgId))
                                .contextType(contextType)
                                .contextId(contextId)
                                .size(contentLength)
                                .createdAt(Instant.now().toEpochMilli())
                                .build();
                        return fileMetadataRepository.save(metadata);
                    }))
                    .thenReturn(new UploadResult(fileId, contentLength))
                    .doOnSuccess(r -> log.info("File uploaded: fileId={}, tgId={}, context={}:{}, size={}",
                            fileId, tgId, contextType, contextId, contentLength))
                    .doOnError(e -> {
                        fileStorageService.delete(fileId).subscribe();
                        log.error("File upload failed: tgId={}, context={}:{}",
                                tgId, contextType, contextId, e);
                    });
        });
    }

    /**
     * Download an encrypted file blob.
     *
     * <p>Pipeline: authenticate → find metadata → validate membership
     * → verify file exists on storage → return streaming data.
     *
     * @param initData Telegram Mini App initData for authentication
     * @param fileId   unique file identifier
     * @return download result with streaming data and file size
     */
    public Mono<DownloadResult> download(String initData, String fileId) {
        return Mono.defer(() -> {
            TelegramInitData authData = telegramAuthService.validateInitData(initData);
            Long tgId = authData.getUserId();
            if (tgId == null) {
                return Mono.error(AuthenticationException.missingField("user.id"));
            }

            return fileMetadataRepository.findById(fileId)
                    .switchIfEmpty(Mono.error(new BurnedChatsException(
                            "File not found: " + fileId, "FILE_NOT_FOUND")))
                    .flatMap(metadata ->
                            validateMembership(tgId, metadata.getContextType(), metadata.getContextId())
                                    .thenReturn(metadata))
                    .flatMap(metadata ->
                            fileStorageService.exists(fileId)
                                    .flatMap(exists -> {
                                        if (!exists) {
                                            return fileMetadataRepository.delete(fileId)
                                                    .then(Mono.error(new BurnedChatsException(
                                                            "File not found: " + fileId,
                                                            "FILE_NOT_FOUND")));
                                        }
                                        Flux<DataBuffer> data = fileStorageService.get(fileId);
                                        long size = metadata.getSize() != null ? metadata.getSize() : 0;
                                        return Mono.just(new DownloadResult(data, size));
                                    }))
                    .doOnSuccess(r -> log.info("File download started: fileId={}, tgId={}", fileId, tgId))
                    .doOnError(e -> log.error("File download failed: fileId={}, tgId={}", fileId, tgId, e));
        });
    }

    private Mono<Void> validateMembership(Long tgId, String contextType, String contextId) {
        if ("session".equals(contextType)) {
            return sessionRepository.findById(contextId)
                    .switchIfEmpty(Mono.error(new BurnedChatsException(
                            "Session not found: " + contextId, "CONTEXT_NOT_FOUND")))
                    .flatMap(session -> {
                        if (!session.isParticipant(tgId)) {
                            return Mono.<Void>error(new BurnedChatsException(
                                    "User is not a participant of session: " + contextId,
                                    "ACCESS_DENIED"));
                        }
                        return Mono.empty();
                    });
        }

        return roomMembersRepository.isMember(contextId, tgId)
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
