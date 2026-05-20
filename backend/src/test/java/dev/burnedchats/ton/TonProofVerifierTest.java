package dev.burnedchats.ton;

import dev.burnedchats.exception.WalletProofException;
import dev.burnedchats.security.AuthCredentials;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("TonProofVerifier")
class TonProofVerifierTest {

    private static final String RAW_ADDR = "0:" + "aa".repeat(32);
    private static final String DUMMY_SIG =
            Base64.getEncoder().encodeToString(new byte[64]);

    private MockWebServer tonApi;
    private TonProofVerifier verifier;
    private ReactiveRedisTemplate<String, String> redisTemplate;
    private ReactiveValueOperations<String, String> valueOps;
    private final ConcurrentHashMap<String, String> redisBacking = new ConcurrentHashMap<>();

    @BeforeEach
    void setUp() throws IOException {
        redisBacking.clear();
        tonApi = new MockWebServer();
        tonApi.start();

        @SuppressWarnings("unchecked")
        ReactiveRedisTemplate<String, String> template = mock(ReactiveRedisTemplate.class);
        redisTemplate = template;
        valueOps = mock(ReactiveValueOperations.class);
        when(template.opsForValue()).thenReturn(valueOps);
        when(valueOps.set(anyString(), anyString(), any(Duration.class)))
                .thenAnswer(inv -> {
                    redisBacking.put(inv.getArgument(0), inv.getArgument(1));
                    return Mono.just(true);
                });
        when(redisTemplate.hasKey(anyString()))
                .thenAnswer(inv -> Mono.just(redisBacking.containsKey(inv.getArgument(0))));
        when(redisTemplate.delete(anyString())).thenReturn(Mono.just(1L));

        verifier = new TonProofVerifier(
                redisTemplate,
                new WalletStateInitParser(),
                Duration.ofMinutes(5),
                Duration.ofMinutes(5),
                "burnedchats.net",
                tonApi.url("/api/v2").toString(),
                "");
    }

    @AfterEach
    void tearDown() throws IOException {
        tonApi.shutdown();
    }

    @Test
    @DisplayName("rejects expired proof with PROOF_EXPIRED")
    void rejectsExpiredProof() {
        long oldTs = Instant.now().minus(Duration.ofMinutes(10)).getEpochSecond();
        AuthCredentials creds = walletCreds(proofJson(oldTs, "burnedchats.net", "nonce-1"));

        StepVerifier.create(verifier.verify(creds))
                .expectErrorSatisfies(err -> assertReason(err, WalletProofException.Reason.PROOF_EXPIRED))
                .verify();
    }

    @Test
    @DisplayName("rejects domain mismatch with DOMAIN_MISMATCH")
    void rejectsDomainMismatch() {
        redisBacking.put("auth_nonce:nonce-2", "1");
        long ts = Instant.now().getEpochSecond();
        AuthCredentials creds = walletCreds(proofJson(ts, "www.burnedchats.net", "nonce-2"));

        StepVerifier.create(verifier.verify(creds))
                .expectErrorSatisfies(err -> assertReason(err, WalletProofException.Reason.DOMAIN_MISMATCH))
                .verify();
    }

    @Test
    @DisplayName("rejects missing nonce with NONCE_MISSING")
    void rejectsMissingNonce() {
        long ts = Instant.now().getEpochSecond();
        AuthCredentials creds = walletCreds(proofJson(ts, "burnedchats.net", ""));

        StepVerifier.create(verifier.verify(creds))
                .expectErrorSatisfies(err -> assertReason(err, WalletProofException.Reason.NONCE_MISSING))
                .verify();
    }

    @Test
    @DisplayName("rejects unknown nonce with NONCE_UNKNOWN")
    void rejectsUnknownNonce() {
        long ts = Instant.now().getEpochSecond();
        AuthCredentials creds = walletCreds(proofJson(ts, "burnedchats.net", "missing-nonce"));

        StepVerifier.create(verifier.verify(creds))
                .expectErrorSatisfies(err -> assertReason(err, WalletProofException.Reason.NONCE_UNKNOWN))
                .verify();
    }

    @Test
    @DisplayName("requires walletPublicKey and walletStateInit together")
    void rejectsPartialClientIdentity() {
        redisBacking.put("auth_nonce:nonce-3", "1");
        long ts = Instant.now().getEpochSecond();
        AuthCredentials creds = new AuthCredentials(
                "wallet", null, proofJson(ts, "burnedchats.net", "nonce-3"), RAW_ADDR, "aa", null);

        StepVerifier.create(verifier.verify(creds))
                .expectErrorSatisfies(err -> assertReason(err, WalletProofException.Reason.INVALID_REQUEST))
                .verify();
    }

    @Test
    @DisplayName("maps toncenter failure to PUBLIC_KEY_UNAVAILABLE")
    void toncenterFailureMapsToUnavailable() {
        redisBacking.put("auth_nonce:nonce-4", "1");
        tonApi.enqueue(new MockResponse().setResponseCode(503).setBody("{}"));
        tonApi.enqueue(new MockResponse().setResponseCode(503).setBody("{}"));

        long ts = Instant.now().getEpochSecond();
        AuthCredentials creds = walletCreds(proofJson(ts, "burnedchats.net", "nonce-4"));

        StepVerifier.create(verifier.verify(creds))
                .expectErrorSatisfies(err -> assertReason(err, WalletProofException.Reason.PUBLIC_KEY_UNAVAILABLE))
                .verify();
    }

    @Test
    @DisplayName("uses client-provided identity without toncenter RPC")
    void usesClientProvidedIdentityWithoutToncenter() {
        byte[] pub = HexFormat.of().parseHex("33".repeat(32));
        WalletStateInitParser parser = org.mockito.Mockito.mock(WalletStateInitParser.class);
        TonProofVerifier localVerifier = new TonProofVerifier(
                redisTemplate,
                parser,
                Duration.ofMinutes(5),
                Duration.ofMinutes(5),
                "burnedchats.net",
                tonApi.url("/api/v2").toString(),
                "");

        org.mockito.Mockito.when(parser.tryParse(
                        org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.any()))
                .thenReturn(Optional.of(new WalletStateInitParser.ParsedStateInit(
                        pub, WalletStateInitParser.WalletVersion.V4R2, new byte[32])));

        redisBacking.put("auth_nonce:nonce-5", "1");
        long ts = Instant.now().getEpochSecond();
        AuthCredentials creds = AuthCredentials.wallet(
                proofJson(ts, "burnedchats.net", "nonce-5"),
                RAW_ADDR,
                HexFormat.of().formatHex(pub),
                "dGVzdA==");

        StepVerifier.create(localVerifier.verify(creds))
                .expectErrorSatisfies(err -> {
                    assertThat(tonApi.getRequestCount()).isZero();
                    assertReason(err, WalletProofException.Reason.SIGNATURE_INVALID);
                })
                .verify();
    }

    private static AuthCredentials walletCreds(String walletProof) {
        return AuthCredentials.wallet(walletProof, RAW_ADDR);
    }

    private static String proofJson(long timestamp, String domain, String nonce) {
        return """
                {"address":"%s","proof":{"timestamp":%d,"domain":{"value":"%s","lengthBytes":%d},\
                "signature":"%s","payload":"%s"}}
                """
                .formatted(RAW_ADDR, timestamp, domain, domain.length(), DUMMY_SIG, nonce)
                .trim();
    }

    private static void assertReason(Throwable err, WalletProofException.Reason expected) {
        WalletProofException wpe = findWalletProofException(err);
        assertThat(wpe).isNotNull();
        assertThat(wpe.getReason()).isEqualTo(expected);
    }

    private static WalletProofException findWalletProofException(Throwable err) {
        Throwable current = err;
        while (current != null) {
            if (current instanceof WalletProofException wpe) {
                return wpe;
            }
            current = current.getCause();
        }
        return null;
    }

}
