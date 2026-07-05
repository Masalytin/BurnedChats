package dev.burnedchats.controller;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.exception.BurnedChatsException;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.FileService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.util.Map;

/**
 * REST controller for encrypted file upload and download.
 *
 * <p>Accepts binary encrypted blobs via streaming and delegates
 * to {@link FileService} for authentication, authorization, and storage.
 *
 * <p>Identity headers: {@code X-Auth-Type} ({@code telegram} default, or {@code wallet}),
 * plus {@code X-Telegram-Init-Data} or {@code X-Auth-Token} respectively.
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
     * @param authType      {@code telegram} or {@code wallet}; defaults to {@code telegram}
     * @param initData      Telegram Mini App initData (telegram mode)
     * @param authToken     opaque wallet session token (wallet mode)
     * @param contextType   "session" or "room"
     * @param contextId     session ID or room ID
     * @param contentLength size of the encrypted blob in bytes
     * @param body          raw input stream of encrypted binary data
     * @return JSON response with fileId and size
     */
    @PostMapping(value = "/upload", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public Mono<ResponseEntity<Map<String, Object>>> upload(
            @RequestHeader(value = "X-Auth-Type", required = false) String authType,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData,
            @RequestHeader(value = "X-Auth-Token", required = false) String authToken,
            @RequestHeader("X-Context-Type") String contextType,
            @RequestHeader("X-Context-Id") String contextId,
            @RequestHeader("Content-Length") long contentLength,
            InputStream body) {

        var data = DataBufferUtils.readInputStream(
                () -> body, new DefaultDataBufferFactory(), BUFFER_SIZE);

        return fileService.upload(authType, initData, authToken, contextType, contextId, contentLength, data)
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
                    LOG.error("Unexpected error during file upload", e);
                    return Mono.just(errorResponse(HttpStatus.INTERNAL_SERVER_ERROR,
                            "INTERNAL_ERROR", "An unexpected error occurred"));
                });
    }

    /**
     * Download an encrypted file blob by file ID.
     *
     * <p>Streams the encrypted blob from storage without materializing the
     * entire file in heap memory. Authorization and membership checks complete
     * (blocking on the reactive pipeline) <em>before</em> any status code or
     * response body is written, so failures surface as proper JSON error
     * responses via {@link #handleAuthentication}, {@link #handleRateLimit},
     * and {@link #handleBurnedChats}.
     *
     * <p>The body itself is a {@link StreamingResponseBody}: the encrypted blob
     * is written to the servlet {@link OutputStream} one {@code DataBuffer} at a
     * time (Tomcat-native streaming). The previous {@code Flux<DataBuffer>}
     * response body could not be written by the servlet stack (no
     * {@code HttpMessageConverter}) and produced a 500; this keeps the
     * memory-safe streaming guarantee from IMP-AUDIT-06 without depending on a
     * reactive (Netty) server.
     *
     * @param fileId    unique file identifier (UUID)
     * @param authType  {@code telegram} or {@code wallet}; defaults to {@code telegram}
     * @param initData  Telegram Mini App initData (telegram mode)
     * @param authToken opaque wallet session token (wallet mode)
     * @return streaming binary response with the encrypted file data
     */
    @GetMapping("/{fileId}")
    public ResponseEntity<StreamingResponseBody> download(
            @PathVariable String fileId,
            @RequestHeader(value = "X-Auth-Type", required = false) String authType,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData,
            @RequestHeader(value = "X-Auth-Token", required = false) String authToken) {

        FileService.DownloadResult result;
        try {
            result = fileService.download(authType, initData, authToken, fileId).block();
        } catch (BurnedChatsException e) {
            // Domain errors (auth / access / not-found / rate-limit) -> mapped JSON below.
            throw e;
        } catch (RuntimeException e) {
            LOG.error("Unexpected error during file download: fileId={}", fileId, e);
            throw new BurnedChatsException("An unexpected error occurred", "INTERNAL_ERROR");
        }
        if (result == null) {
            throw new BurnedChatsException("File not found: " + fileId, "FILE_NOT_FOUND");
        }

        StreamingResponseBody body = outputStream -> writeBlob(result.data(), outputStream);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_OCTET_STREAM_VALUE)
                .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(result.size()))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(body);
    }

    /**
     * Stream a reactive blob to the servlet output stream, releasing every
     * {@link DataBuffer} after it is written. Only a single buffer is held in
     * heap at any time (no full-file materialization). Each buffer is flushed so
     * the body is delivered to the client in chunks rather than one block.
     */
    private static void writeBlob(Flux<DataBuffer> data, OutputStream outputStream) {
        data.doOnNext(buffer -> {
            try {
                int readable = buffer.readableByteCount();
                if (readable > 0) {
                    byte[] chunk = new byte[readable];
                    buffer.read(chunk);
                    outputStream.write(chunk);
                    outputStream.flush();
                }
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            } finally {
                DataBufferUtils.release(buffer);
            }
        })
                .doOnDiscard(DataBuffer.class, DataBufferUtils::release)
                .then()
                .block();
    }

    @ExceptionHandler(AuthenticationException.class)
    ResponseEntity<Map<String, Object>> handleAuthentication(AuthenticationException e) {
        return jsonError(HttpStatus.UNAUTHORIZED, e.getErrorCode(), e.getMessage());
    }

    @ExceptionHandler(RateLimitException.class)
    ResponseEntity<Map<String, Object>> handleRateLimit(RateLimitException e) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", String.valueOf(e.getRetryAfterSeconds()))
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of(
                        "error", e.getErrorCode(),
                        "message", e.getMessage(),
                        "retryAfter", e.getRetryAfterSeconds()
                ));
    }

    @ExceptionHandler(BurnedChatsException.class)
    ResponseEntity<Map<String, Object>> handleBurnedChats(BurnedChatsException e) {
        return jsonError(mapErrorCode(e.getErrorCode()), e.getErrorCode(), e.getMessage());
    }

    private static ResponseEntity<Map<String, Object>> errorResponse(
            HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "error", code,
                "message", message
        ));
    }

    private static ResponseEntity<Map<String, Object>> jsonError(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of(
                        "error", code,
                        "message", message
                ));
    }

    private static HttpStatus mapErrorCode(String errorCode) {
        return switch (errorCode) {
            case "ACCESS_DENIED" -> HttpStatus.FORBIDDEN;
            case "CONTEXT_NOT_FOUND", "FILE_NOT_FOUND" -> HttpStatus.NOT_FOUND;
            case "FILE_TOO_LARGE" -> HttpStatus.PAYLOAD_TOO_LARGE;
            case "FILE_SIZE_INVALID", "INVALID_CONTEXT_TYPE" -> HttpStatus.BAD_REQUEST;
            default -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
    }
}
