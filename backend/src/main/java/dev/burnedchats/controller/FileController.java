package dev.burnedchats.controller;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.exception.BurnedChatsException;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.FileService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.io.InputStream;
import java.util.Map;

/**
 * REST controller for encrypted file upload.
 *
 * <p>Accepts binary encrypted blobs via streaming and delegates
 * to {@link FileService} for authentication, authorization, and storage.
 */
@Slf4j
@RestController
@RequestMapping("/api/files")
public class FileController {

    private static final int BUFFER_SIZE = 8192;

    private final FileService fileService;

    public FileController(FileService fileService) {
        this.fileService = fileService;
    }

    /**
     * Upload an encrypted file blob.
     *
     * <p>The request body is streamed directly to storage without
     * buffering the entire file in memory.
     *
     * @param initData      Telegram Mini App initData for authentication
     * @param contextType   "session" or "room"
     * @param contextId     session ID or room ID
     * @param contentLength size of the encrypted blob in bytes
     * @param body          raw input stream of encrypted binary data
     * @return JSON response with fileId and size
     */
    @PostMapping(value = "/upload", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public Mono<ResponseEntity<Map<String, Object>>> upload(
            @RequestHeader("X-Telegram-Init-Data") String initData,
            @RequestHeader("X-Context-Type") String contextType,
            @RequestHeader("X-Context-Id") String contextId,
            @RequestHeader("Content-Length") long contentLength,
            InputStream body) {

        var data = DataBufferUtils.readInputStream(
                () -> body, new DefaultDataBufferFactory(), BUFFER_SIZE);

        return fileService.upload(initData, contextType, contextId, contentLength, data)
                .map(result -> ResponseEntity.ok(Map.<String, Object>of(
                        "fileId", result.fileId(),
                        "size", result.size()
                )))
                .onErrorResume(AuthenticationException.class, e ->
                        Mono.just(errorResponse(HttpStatus.UNAUTHORIZED, e.getErrorCode(), e.getMessage())))
                .onErrorResume(RateLimitException.class, e ->
                        Mono.just(ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                                .header("Retry-After", String.valueOf(e.getRetryAfterSeconds()))
                                .body(Map.of(
                                        "error", e.getErrorCode(),
                                        "message", e.getMessage(),
                                        "retryAfter", e.getRetryAfterSeconds()
                                ))))
                .onErrorResume(BurnedChatsException.class, e -> {
                    HttpStatus status = mapErrorCode(e.getErrorCode());
                    return Mono.just(errorResponse(status, e.getErrorCode(), e.getMessage()));
                })
                .onErrorResume(e -> {
                    log.error("Unexpected error during file upload", e);
                    return Mono.just(errorResponse(HttpStatus.INTERNAL_SERVER_ERROR,
                            "INTERNAL_ERROR", "An unexpected error occurred"));
                });
    }

    private static ResponseEntity<Map<String, Object>> errorResponse(
            HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "error", code,
                "message", message
        ));
    }

    private static HttpStatus mapErrorCode(String errorCode) {
        return switch (errorCode) {
            case "ACCESS_DENIED" -> HttpStatus.FORBIDDEN;
            case "CONTEXT_NOT_FOUND" -> HttpStatus.NOT_FOUND;
            case "FILE_SIZE_INVALID", "INVALID_CONTEXT_TYPE" -> HttpStatus.BAD_REQUEST;
            default -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
    }
}
