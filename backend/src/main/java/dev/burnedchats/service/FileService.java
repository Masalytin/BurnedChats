package dev.burnedchats.service;

import dev.burnedchats.config.FileStorageProperties;
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
 * Business logic for file upload operations.
 *
 * <p>Orchestrates authentication, authorization, rate limiting,
 * file storage, and metadata persistence for encrypted file uploads.
 *
 * @see FileStorageService
 * @see FileMetadataRepository
 */
@Slf4j
@Service
public class FileService {

    private final TelegramAuthService telegramAuthService;
    private final FileStorageService fileStorageService;
    private final FileMetadataRepository fileMetadataRepository;
    private final SessionRepository sessionRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final RateLimitService rateLimitService;
    private final FileStorageProperties fileStorageProperties;

    public FileService(TelegramAuthService telegramAuthService,
                       FileStorageService fileStorageService,
                       FileMetadataRepository fileMetadataRepository,
                       SessionRepository sessionRepository,
                       RoomMembersRepository roomMembersRepository,
                       RateLimitService rateLimitService,
                       FileStorageProperties fileStorageProperties) {
        this.telegramAuthService = telegramAuthService;
        this.fileStorageService = fileStorageService;
        this.fileMetadataRepository = fileMetadataRepository;
        this.sessionRepository = sessionRepository;
        this.roomMembersRepository = roomMembersRepository;
        this.rateLimitService = rateLimitService;
        this.fileStorageProperties = fileStorageProperties;
    }

    /**
     * Result of a successful file upload.
     *
     * @param fileId generated UUID for the stored file
     * @param size   size of the uploaded blob in bytes
     */
    public record UploadResult(String fileId, long size) {}

    /**
     * Upload an encrypted file blob.
     *
     * <p>Pipeline: authenticate → rate-limit → validate size → validate membership
     * → save blob → save metadata → return result.
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
        TelegramInitData authData = telegramAuthService.validateInitData(initData);
        Long tgId = authData.getUserId();
        if (tgId == null) {
            return Mono.error(AuthenticationException.missingField("user.id"));
        }

        if (contentLength <= 0 || contentLength > fileStorageProperties.getMaxFileSize()) {
            return Mono.error(new BurnedChatsException(
                    "File size must be between 1 and " + fileStorageProperties.getMaxFileSize() + " bytes",
                    "FILE_SIZE_INVALID"));
        }

        if (!"session".equals(contextType) && !"room".equals(contextType)) {
            return Mono.error(new BurnedChatsException(
                    "Invalid context type: " + contextType + ". Must be 'session' or 'room'",
                    "INVALID_CONTEXT_TYPE"));
        }

        String fileId = UUID.randomUUID().toString();

        return rateLimitService.checkRateLimit(tgId, RateLimitService.RateLimitType.FILE_UPLOAD)
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
