package dev.burnedchats.integration;

import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.FluxExchangeResult;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * REST integration tests for encrypted file upload/download streaming
 * ({@link dev.burnedchats.controller.FileController}).
 *
 * <p>Covers round-trip relay (octet-stream, no E2EE), 404 FILE_NOT_FOUND,
 * 403 ACCESS_DENIED, and multi-chunk download without full-body materialization.
 */
@Tag("integration")
class FileDownloadRestIT extends StompIntegrationTestBase {

    private static final String INIT_DATA = "it-file-download-init-data";
    private static final long RESPONDER_TELEGRAM_ID = 2002L;
    private static final long OUTSIDER_TELEGRAM_ID = 3003L;
    private static final int MULTI_CHUNK_SIZE = 32 * 1024;

    private static Path tempStorageDir;

    @DynamicPropertySource
    static void registerFileStorage(DynamicPropertyRegistry registry) throws Exception {
        tempStorageDir = Files.createTempDirectory("file-download-it-");
        registry.add("app.files.storage-path", () -> tempStorageDir.toString() + "/");
        registry.add("app.files.cleanup-enabled", () -> "false");
    }

    @Autowired
    private WebTestClient webTestClient;

    @Autowired
    private SessionRepository sessionRepository;

    @BeforeEach
    void resetAuthStub() {
        stubTelegramAuthForTgId(DEFAULT_TELEGRAM_ID);
    }

    @Test
    void uploadThenDownloadMatchesBytesAndHeaders() {
        byte[] blob = deterministicBlob(512);
        String sessionId = createSessionForDefaultUser();

        String fileId = uploadFile(sessionId, blob);
        byte[] downloaded = downloadFile(fileId, blob.length, 1);

        assertThat(downloaded).isEqualTo(blob);
    }

    @Test
    void multiChunkDownloadStreamsWithoutSingleBufferAssert() {
        byte[] blob = deterministicBlob(MULTI_CHUNK_SIZE);
        String sessionId = createSessionForDefaultUser();

        String fileId = uploadFile(sessionId, blob);
        byte[] downloaded = downloadFile(fileId, blob.length, 2);

        assertThat(downloaded).hasSize(MULTI_CHUNK_SIZE);
        assertThat(downloaded).isEqualTo(blob);
    }

    @Test
    void downloadMissingFileReturns404FileNotFound() {
        webTestClient.get()
                .uri("/api/files/{fileId}", UUID.randomUUID().toString())
                .header("X-Telegram-Init-Data", INIT_DATA)
                .exchange()
                .expectStatus().isNotFound()
                .expectHeader().contentType(MediaType.APPLICATION_JSON)
                .expectBody()
                .jsonPath("$.error").isEqualTo("FILE_NOT_FOUND");
    }

    @Test
    void downloadByNonMemberReturns403AccessDenied() {
        byte[] blob = deterministicBlob(256);
        String sessionId = createSessionForDefaultUser();
        String fileId = uploadFile(sessionId, blob);

        stubTelegramAuthForTgId(OUTSIDER_TELEGRAM_ID);

        webTestClient.get()
                .uri("/api/files/{fileId}", fileId)
                .header("X-Telegram-Init-Data", INIT_DATA)
                .exchange()
                .expectStatus().isForbidden()
                .expectHeader().contentType(MediaType.APPLICATION_JSON)
                .expectBody()
                .jsonPath("$.error").isEqualTo("ACCESS_DENIED");
    }

    private String createSessionForDefaultUser() {
        String sessionId = UUID.randomUUID().toString();
        Session session = Session.builder()
                .id(sessionId)
                .initiatorInternalId(InternalIds.forTelegramId(DEFAULT_TELEGRAM_ID))
                .initiatorTelegramId(DEFAULT_TELEGRAM_ID)
                .responderInternalId(InternalIds.forTelegramId(RESPONDER_TELEGRAM_ID))
                .responderTelegramId(RESPONDER_TELEGRAM_ID)
                .status(SessionStatus.ACTIVE)
                .createdAt(Instant.now())
                .lastActivityAt(Instant.now())
                .build();
        sessionRepository.save(session).block(Duration.ofSeconds(10));
        return sessionId;
    }

    private String uploadFile(String sessionId, byte[] blob) {
        AtomicReference<String> fileIdRef = new AtomicReference<>();
        webTestClient.post()
                .uri("/api/files/upload")
                .header("X-Telegram-Init-Data", INIT_DATA)
                .header("X-Context-Type", "session")
                .header("X-Context-Id", sessionId)
                .header("Content-Length", String.valueOf(blob.length))
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .bodyValue(blob)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.fileId").value(id -> fileIdRef.set((String) id))
                .jsonPath("$.size").isEqualTo(blob.length);
        return fileIdRef.get();
    }

    private byte[] downloadFile(String fileId, long expectedSize, int minChunks) {
        FluxExchangeResult<DataBuffer> result = webTestClient.get()
                .uri("/api/files/{fileId}", fileId)
                .header("X-Telegram-Init-Data", INIT_DATA)
                .exchange()
                .expectStatus().isOk()
                .expectHeader().contentType(MediaType.APPLICATION_OCTET_STREAM)
                .expectHeader().valueEquals(HttpHeaders.CONTENT_LENGTH, String.valueOf(expectedSize))
                .returnResult(DataBuffer.class);

        AtomicInteger chunkCount = new AtomicInteger(0);
        ByteArrayOutputStream collected = new ByteArrayOutputStream();
        result.getResponseBody()
                .doOnNext(buffer -> {
                    chunkCount.incrementAndGet();
                    byte[] bytes = new byte[buffer.readableByteCount()];
                    buffer.read(bytes);
                    DataBufferUtils.release(buffer);
                    collected.write(bytes, 0, bytes.length);
                })
                .blockLast(Duration.ofSeconds(30));

        assertThat(chunkCount.get()).isGreaterThanOrEqualTo(minChunks);
        return collected.toByteArray();
    }

    /** Deterministic pseudo-encrypted blob for relay-layer tests (not real E2EE). */
    private static byte[] deterministicBlob(int size) {
        byte[] blob = new byte[size];
        for (int i = 0; i < size; i++) {
            blob[i] = (byte) (i & 0xFF);
        }
        return blob;
    }
}
