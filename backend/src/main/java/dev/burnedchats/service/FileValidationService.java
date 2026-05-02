package dev.burnedchats.service;

import dev.burnedchats.config.FileStorageProperties;
import dev.burnedchats.exception.BurnedChatsException;
import dev.burnedchats.util.ValidationConstants;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * Validates file upload requests.
 *
 * <p>Server-side validation is limited to size and rate limiting since
 * files are encrypted — MIME type validation is the client's responsibility.
 *
 * @see ValidationConstants
 */
@Slf4j
@Service
public class FileValidationService {

    private final FileStorageProperties fileStorageProperties;
    private final RateLimitService rateLimitService;

    public FileValidationService(FileStorageProperties fileStorageProperties,
                                 RateLimitService rateLimitService) {
        this.fileStorageProperties = fileStorageProperties;
        this.rateLimitService = rateLimitService;
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
}
