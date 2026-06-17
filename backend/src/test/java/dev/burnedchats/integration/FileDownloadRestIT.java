package dev.burnedchats.integration;

import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.SessionTokenService;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.reactivestreams.Subscription;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.FluxExchangeResult;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.Disposable;
import reactor.core.publisher.BaseSubscriber;
import reactor.core.publisher.Flux;

import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
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
    private static final String WALLET_OWNER_INTERNAL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    private static final String WALLET_OUTSIDER_INTERNAL_ID = "cccccccc-bbbb-cccc-dddd-111111111111";
    private static final String WALLET_OWNER_ADDRESS = "eq" + "a".repeat(46);
    private static final String WALLET_OUTSIDER_ADDRESS = "eq" + "c".repeat(46);
    private static final int MULTI_CHUNK_SIZE = 32 * 1024;
    private static final int CONCURRENT_DOWNLOAD_LIMIT = 3;
    /** Larger than any TCP socket/window buffer so an idle holder back-pressures the server. */
    private static final int HOLD_OPEN_SIZE = 8 * 1024 * 1024;

    private static Path tempStorageDir;

    @DynamicPropertySource
    static void registerFileStorage(DynamicPropertyRegistry registry) throws Exception {
        tempStorageDir = Files.createTempDirectory("file-download-it-");
        registry.add("app.files.storage-path", () -> tempStorageDir.toString() + "/");
        registry.add("app.files.cleanup-enabled", () -> "false");
        registry.add("app.files.max-concurrent-downloads-per-user", () -> "3");
    }

    @Autowired
    private WebTestClient webTestClient;

    @Autowired
    private SessionRepository sessionRepository;

    @Autowired
    private SessionTokenService sessionTokenService;

    @Autowired
    private UserIdentityRepository userIdentityRepository;

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

    @Test
    void walletUploadThenDownloadMatchesBytesAndHeaders() {
        seedWalletUser(WALLET_OWNER_INTERNAL_ID, WALLET_OWNER_ADDRESS);
        String sessionId = createWalletSession(WALLET_OWNER_INTERNAL_ID);
        String token = issueWalletToken(WALLET_OWNER_INTERNAL_ID);
        byte[] blob = deterministicBlob(512);

        String fileId = uploadFileWallet(sessionId, blob, token);
        byte[] downloaded = downloadFileWallet(fileId, blob.length, 1, token);

        assertThat(downloaded).isEqualTo(blob);
    }

    @Test
    void walletDownloadByNonMemberReturns403AccessDenied() {
        seedWalletUser(WALLET_OWNER_INTERNAL_ID, WALLET_OWNER_ADDRESS);
        seedWalletUser(WALLET_OUTSIDER_INTERNAL_ID, WALLET_OUTSIDER_ADDRESS);
        String sessionId = createWalletSession(WALLET_OWNER_INTERNAL_ID);
        String ownerToken = issueWalletToken(WALLET_OWNER_INTERNAL_ID);
        String outsiderToken = issueWalletToken(WALLET_OUTSIDER_INTERNAL_ID);
        byte[] blob = deterministicBlob(256);
        String fileId = uploadFileWallet(sessionId, blob, ownerToken);

        webTestClient.get()
                .uri("/api/files/{fileId}", fileId)
                .header("X-Auth-Type", "wallet")
                .header("X-Auth-Token", outsiderToken)
                .exchange()
                .expectStatus().isForbidden()
                .expectHeader().contentType(MediaType.APPLICATION_JSON)
                .expectBody()
                .jsonPath("$.error").isEqualTo("ACCESS_DENIED");
    }

    @Test
    void missingAuthReturns401() {
        webTestClient.get()
                .uri("/api/files/{fileId}", UUID.randomUUID().toString())
                .exchange()
                .expectStatus().isUnauthorized()
                .expectHeader().contentType(MediaType.APPLICATION_JSON)
                .expectBody()
                .jsonPath("$.error").isEqualTo("AUTH_ERROR");

        webTestClient.post()
                .uri("/api/files/upload")
                .header("X-Context-Type", "session")
                .header("X-Context-Id", UUID.randomUUID().toString())
                .header("Content-Length", "1")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .bodyValue(new byte[] {0x01})
                .exchange()
                .expectStatus().isUnauthorized()
                .expectHeader().contentType(MediaType.APPLICATION_JSON)
                .expectBody()
                .jsonPath("$.error").isEqualTo("AUTH_ERROR");
    }

    @Test
    void invalidWalletTokenReturns401() {
        webTestClient.get()
                .uri("/api/files/{fileId}", UUID.randomUUID().toString())
                .header("X-Auth-Type", "wallet")
                .header("X-Auth-Token", "invalid-opaque-token")
                .exchange()
                .expectStatus().isUnauthorized()
                .expectHeader().contentType(MediaType.APPLICATION_JSON)
                .expectBody()
                .jsonPath("$.error").isEqualTo("AUTH_ERROR");
    }

    @Test
    void fourthConcurrentDownloadReturns429() throws Exception {
        // Use a blob far larger than the TCP socket buffers so a holder that stops
        // consuming back-pressures the server mid-stream: the server's StreamingResponseBody
        // blocks on OutputStream.write, the download Flux never completes, and the Redis
        // download slot stays held for the whole connection. (A small file would be fully
        // flushed into the socket buffer and release its slot before the 4th request races in.)
        byte[] blob = deterministicBlob(HOLD_OPEN_SIZE);
        String sessionId = createSessionForDefaultUser();
        String fileId = uploadFile(sessionId, blob);

        ExecutorService executor = Executors.newFixedThreadPool(CONCURRENT_DOWNLOAD_LIMIT);
        CountDownLatch slotsHeld = new CountDownLatch(CONCURRENT_DOWNLOAD_LIMIT);
        List<Disposable> heldDownloads = new CopyOnWriteArrayList<>();

        try {
            for (int i = 0; i < CONCURRENT_DOWNLOAD_LIMIT; i++) {
                executor.submit(() -> {
                    Flux<DataBuffer> body = webTestClient.get()
                            .uri("/api/files/{fileId}", fileId)
                            .header("X-Telegram-Init-Data", INIT_DATA)
                            .exchange()
                            .expectStatus().isOk()
                            .returnResult(DataBuffer.class)
                            .getResponseBody();

                    // Request exactly one buffer, then stop requesting (no cancel): the
                    // connection stays open and the server's slot remains held until dispose().
                    heldDownloads.add(body.subscribeWith(new BaseSubscriber<DataBuffer>() {
                        @Override
                        protected void hookOnSubscribe(Subscription subscription) {
                            request(1);
                        }

                        @Override
                        protected void hookOnNext(DataBuffer buffer) {
                            DataBufferUtils.release(buffer);
                            slotsHeld.countDown();
                        }
                    }));
                });
            }

            assertThat(slotsHeld.await(20, TimeUnit.SECONDS)).isTrue();

            webTestClient.get()
                    .uri("/api/files/{fileId}", fileId)
                    .header("X-Telegram-Init-Data", INIT_DATA)
                    .exchange()
                    .expectStatus().isEqualTo(429)
                    .expectHeader().exists("Retry-After")
                    .expectHeader().contentType(MediaType.APPLICATION_JSON)
                    .expectBody()
                    .jsonPath("$.error").isEqualTo("RATE_LIMIT_EXCEEDED")
                    .jsonPath("$.retryAfter").exists();
        } finally {
            heldDownloads.forEach(Disposable::dispose);
            executor.shutdownNow();
        }
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

    private String createWalletSession(String ownerInternalId) {
        String sessionId = UUID.randomUUID().toString();
        Session session = Session.builder()
                .id(sessionId)
                .initiatorInternalId(ownerInternalId)
                .initiatorTelegramId(null)
                .responderInternalId(WALLET_OUTSIDER_INTERNAL_ID)
                .responderTelegramId(null)
                .status(SessionStatus.ACTIVE)
                .createdAt(Instant.now())
                .lastActivityAt(Instant.now())
                .build();
        sessionRepository.save(session).block(Duration.ofSeconds(10));
        return sessionId;
    }

    private void seedWalletUser(String internalId, String walletAddress) {
        UnifiedUser user = new UnifiedUser(internalId, AuthType.WALLET, "Wallet User", null, walletAddress, null);
        Boolean saved = userIdentityRepository.save(user).block(Duration.ofSeconds(10));
        assertThat(saved).isTrue();
    }

    private String issueWalletToken(String internalId) {
        String token = sessionTokenService.issueToken(internalId).block(Duration.ofSeconds(10));
        assertThat(token).isNotBlank();
        return token;
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

    private String uploadFileWallet(String sessionId, byte[] blob, String authToken) {
        AtomicReference<String> fileIdRef = new AtomicReference<>();
        webTestClient.post()
                .uri("/api/files/upload")
                .header("X-Auth-Type", "wallet")
                .header("X-Auth-Token", authToken)
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

    private byte[] downloadFileWallet(String fileId, long expectedSize, int minChunks, String authToken) {
        FluxExchangeResult<DataBuffer> result = webTestClient.get()
                .uri("/api/files/{fileId}", fileId)
                .header("X-Auth-Type", "wallet")
                .header("X-Auth-Token", authToken)
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
