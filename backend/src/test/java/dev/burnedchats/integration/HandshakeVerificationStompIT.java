package dev.burnedchats.integration;

import dev.burnedchats.dto.event.IncomingRequestEvent;
import dev.burnedchats.dto.event.PeerPublicKeyEvent;
import dev.burnedchats.dto.event.SessionAcceptedEvent;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.event.VerificationEvent;
import dev.burnedchats.dto.request.AcceptSessionRequest;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.PublicKeyRequest;
import dev.burnedchats.dto.request.VerificationRequest;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.SessionTokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.NonNull;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.spec.ECGenParameterSpec;
import java.time.Duration;
import java.util.Base64;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * STOMP handshake + visual-verification critical path (IMP-AUDIT-16).
 *
 * <p>Drives a session to HANDSHAKE, performs the ECDH public-key relay
 * ({@code HandshakeHandler}) so both peers receive each other's key and the session
 * becomes ACTIVE, then runs the mutual fingerprint confirmation ({@code VerificationHandler})
 * until {@code bothVerified} is reported to both sides.
 *
 * <p>The server is a zero-knowledge relay: it never parses keys, only relays them. Keys here are
 * real P-256 SPKI public keys generated client-side, matching the format the frontend sends.
 */
@Tag("integration")
class HandshakeVerificationStompIT extends StompIntegrationTestBase {

    private static final String INITIATOR_INTERNAL_ID = "33333333-3333-3333-3333-333333333333";
    private static final String RESPONDER_INTERNAL_ID = "44444444-4444-4444-4444-444444444444";
    private static final String INITIATOR_WALLET = "eq" + "3".repeat(46);
    private static final String RESPONDER_WALLET = "eq" + "4".repeat(46);

    @Autowired
    private SessionTokenService sessionTokenService;

    @Autowired
    private UserIdentityRepository userIdentityRepository;

    @BeforeEach
    void seedWalletUsers() {
        seedWalletUser(INITIATOR_INTERNAL_ID, "Initiator", INITIATOR_WALLET);
        seedWalletUser(RESPONDER_INTERNAL_ID, "Responder", RESPONDER_WALLET);
    }

    @Test
    void handshakeRelayThenMutualVerification() throws Exception {
        WebSocketStompClient initiatorClient = StompTestSupport.createStompClient();
        WebSocketStompClient responderClient = StompTestSupport.createStompClient();
        try {
            StompSession initiator = connect(initiatorClient, INITIATOR_INTERNAL_ID);
            StompSession responder = connect(responderClient, RESPONDER_INTERNAL_ID);

            String sessionId = createAndAccept(initiator, responder);

            // 1. handshake key relay — each side receives the peer's public key, session → ACTIVE
            relayHandshake(initiator, responder, sessionId);

            // 2. mutual verification — both confirm; both eventually see bothVerified=true
            BlockingQueue<VerificationEvent> initiatorVerifications = new LinkedBlockingQueue<>();
            BlockingQueue<VerificationEvent> responderVerifications = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/verification",
                    typedHandler(VerificationEvent.class, initiatorVerifications));
            responder.subscribe("/user/queue/verification",
                    typedHandler(VerificationEvent.class, responderVerifications));
            StompTestSupport.awaitSubscriptionProcessed();

            // Concurrent confirmations — regression for IMP-AUDIT-29 lost-update race on verified flags.
            initiator.send("/app/verification.confirm",
                    VerificationRequest.builder().sessionId(sessionId).confirmed(true).build());
            responder.send("/app/verification.confirm",
                    VerificationRequest.builder().sessionId(sessionId).confirmed(true).build());

            // IMP-CCVF-07: a successful flow must NOT deliver any error event (e.g. a false
            // INTERNAL_ERROR caused by HSET returning 0 for already-existing verified fields).
            awaitBothVerifiedNoError(initiatorVerifications);
            awaitBothVerifiedNoError(responderVerifications);
        } finally {
            initiatorClient.stop();
            responderClient.stop();
        }
    }

    @Test
    void singleConfirmReportsVerifiedWithoutError() throws Exception {
        WebSocketStompClient initiatorClient = StompTestSupport.createStompClient();
        WebSocketStompClient responderClient = StompTestSupport.createStompClient();
        try {
            StompSession initiator = connect(initiatorClient, INITIATOR_INTERNAL_ID);
            StompSession responder = connect(responderClient, RESPONDER_INTERNAL_ID);

            String sessionId = createAndAccept(initiator, responder);
            relayHandshake(initiator, responder, sessionId);

            BlockingQueue<VerificationEvent> initiatorVerifications = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/verification",
                    typedHandler(VerificationEvent.class, initiatorVerifications));
            StompTestSupport.awaitSubscriptionProcessed();

            // IMP-CCVF-07: a single confirm must produce one success event (verified=true) and
            // never a (false) INTERNAL_ERROR — the regression always existed before the peer confirmed.
            initiator.send("/app/verification.confirm",
                    VerificationRequest.builder().sessionId(sessionId).confirmed(true).build());

            VerificationEvent event = initiatorVerifications.poll(5, TimeUnit.SECONDS);
            assertThat(event).isNotNull();
            assertThat(event.isSuccess()).isTrue();
            assertThat(event.getError()).isNull();
            assertThat(event.getVerified()).isTrue();
            // peer has not confirmed yet → not both verified
            assertThat(event.getBothVerified()).isNotEqualTo(Boolean.TRUE);

            // no late/extra error event must follow the success
            assertThat(initiatorVerifications.poll(1, TimeUnit.SECONDS)).isNull();
        } finally {
            initiatorClient.stop();
            responderClient.stop();
        }
    }

    /**
     * Regression: client retry after timeout/reconnect generates a new ECDH pair and re-sends
     * its public key while the peer has not submitted yet. The server must overwrite the pending
     * key so both sides receive the same pair at relay (fixes fingerprint mismatch).
     */
    @Test
    void handshakeReplacesPendingKeyBeforePeerSubmits() throws Exception {
        WebSocketStompClient initiatorClient = StompTestSupport.createStompClient();
        WebSocketStompClient responderClient = StompTestSupport.createStompClient();
        try {
            StompSession initiator = connect(initiatorClient, INITIATOR_INTERNAL_ID);
            StompSession responder = connect(responderClient, RESPONDER_INTERNAL_ID);

            String sessionId = createAndAccept(initiator, responder);

            BlockingQueue<PeerPublicKeyEvent> initiatorPeerKeys = new LinkedBlockingQueue<>();
            BlockingQueue<PeerPublicKeyEvent> responderPeerKeys = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/peer-key", typedHandler(PeerPublicKeyEvent.class, initiatorPeerKeys));
            responder.subscribe("/user/queue/peer-key", typedHandler(PeerPublicKeyEvent.class, responderPeerKeys));
            StompTestSupport.awaitSubscriptionProcessed();

            String supersededInitiatorKey = generateP256PublicKeyBase64();
            String replacementInitiatorKey = generateP256PublicKeyBase64();
            String responderKey = generateP256PublicKeyBase64();

            initiator.send("/app/handshake.key",
                    PublicKeyRequest.builder().sessionId(sessionId).publicKey(supersededInitiatorKey).build());
            initiator.send("/app/handshake.key",
                    PublicKeyRequest.builder().sessionId(sessionId).publicKey(replacementInitiatorKey).build());

            assertThat(responderPeerKeys.poll(1, TimeUnit.SECONDS)).isNull();

            responder.send("/app/handshake.key",
                    PublicKeyRequest.builder().sessionId(sessionId).publicKey(responderKey).build());

            PeerPublicKeyEvent initiatorReceived = initiatorPeerKeys.poll(5, TimeUnit.SECONDS);
            PeerPublicKeyEvent responderReceived = responderPeerKeys.poll(5, TimeUnit.SECONDS);
            assertThat(initiatorReceived).isNotNull();
            assertThat(initiatorReceived.isSuccess()).isTrue();
            assertThat(initiatorReceived.getPublicKey()).isEqualTo(responderKey);
            assertThat(responderReceived).isNotNull();
            assertThat(responderReceived.isSuccess()).isTrue();
            assertThat(responderReceived.getPublicKey())
                    .as("relay must use the latest initiator key, not the superseded one")
                    .isEqualTo(replacementInitiatorKey);
            assertThat(responderReceived.getPublicKey()).isNotEqualTo(supersededInitiatorKey);
        } finally {
            initiatorClient.stop();
            responderClient.stop();
        }
    }

    @Test
    void verificationMismatchNotifiesBothParticipants() throws Exception {
        WebSocketStompClient initiatorClient = StompTestSupport.createStompClient();
        WebSocketStompClient responderClient = StompTestSupport.createStompClient();
        try {
            StompSession initiator = connect(initiatorClient, INITIATOR_INTERNAL_ID);
            StompSession responder = connect(responderClient, RESPONDER_INTERNAL_ID);

            String sessionId = createAndAccept(initiator, responder);

            BlockingQueue<VerificationEvent> initiatorVerifications = new LinkedBlockingQueue<>();
            BlockingQueue<VerificationEvent> responderVerifications = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/verification",
                    typedHandler(VerificationEvent.class, initiatorVerifications));
            responder.subscribe("/user/queue/verification",
                    typedHandler(VerificationEvent.class, responderVerifications));
            StompTestSupport.awaitSubscriptionProcessed();

            // initiator reports a fingerprint mismatch — both sides get a MITM warning
            initiator.send("/app/verification.confirm",
                    VerificationRequest.builder().sessionId(sessionId).confirmed(false).build());

            VerificationEvent reporterEvent = initiatorVerifications.poll(5, TimeUnit.SECONDS);
            VerificationEvent peerEvent = responderVerifications.poll(5, TimeUnit.SECONDS);
            assertThat(reporterEvent).isNotNull();
            assertThat(reporterEvent.getError()).isEqualTo("FINGERPRINT_MISMATCH");
            assertThat(peerEvent).isNotNull();
            assertThat(peerEvent.getError()).isEqualTo("FINGERPRINT_MISMATCH");
        } finally {
            initiatorClient.stop();
            responderClient.stop();
        }
    }

    private String createAndAccept(StompSession initiator, StompSession responder) throws Exception {
        BlockingQueue<SessionCreatedEvent> created = new LinkedBlockingQueue<>();
        BlockingQueue<IncomingRequestEvent> incoming = new LinkedBlockingQueue<>();
        BlockingQueue<SessionAcceptedEvent> initiatorAccepted = new LinkedBlockingQueue<>();
        initiator.subscribe("/user/queue/session-created", typedHandler(SessionCreatedEvent.class, created));
        initiator.subscribe("/user/queue/session-accepted",
                typedHandler(SessionAcceptedEvent.class, initiatorAccepted));
        responder.subscribe("/user/queue/incoming-request", typedHandler(IncomingRequestEvent.class, incoming));
        StompTestSupport.awaitSubscriptionProcessed();

        CreateSessionRequest createRequest = new CreateSessionRequest();
        createRequest.setRecipientInternalId(RESPONDER_INTERNAL_ID);
        initiator.send("/app/session.create", createRequest);

        SessionCreatedEvent createdEvent = created.poll(5, TimeUnit.SECONDS);
        assertThat(createdEvent).isNotNull();
        assertThat(createdEvent.isSuccess()).isTrue();
        String sessionId = createdEvent.getSessionId();
        assertThat(incoming.poll(5, TimeUnit.SECONDS)).isNotNull();

        responder.send("/app/session.accept", AcceptSessionRequest.builder().sessionId(sessionId).build());
        SessionAcceptedEvent accepted = initiatorAccepted.poll(5, TimeUnit.SECONDS);
        assertThat(accepted).isNotNull();
        assertThat(accepted.isSuccess()).isTrue();
        return sessionId;
    }

    /**
     * Performs the ECDH public-key relay so both peers receive each other's key and the
     * session transitions to ACTIVE, ready for fingerprint verification.
     */
    private void relayHandshake(StompSession initiator, StompSession responder, String sessionId)
            throws Exception {
        BlockingQueue<PeerPublicKeyEvent> initiatorPeerKeys = new LinkedBlockingQueue<>();
        BlockingQueue<PeerPublicKeyEvent> responderPeerKeys = new LinkedBlockingQueue<>();
        initiator.subscribe("/user/queue/peer-key", typedHandler(PeerPublicKeyEvent.class, initiatorPeerKeys));
        responder.subscribe("/user/queue/peer-key", typedHandler(PeerPublicKeyEvent.class, responderPeerKeys));
        StompTestSupport.awaitSubscriptionProcessed();

        String initiatorKey = generateP256PublicKeyBase64();
        String responderKey = generateP256PublicKeyBase64();

        initiator.send("/app/handshake.key",
                PublicKeyRequest.builder().sessionId(sessionId).publicKey(initiatorKey).build());
        // no peer-key relayed yet — server buffers until both keys arrive
        assertThat(responderPeerKeys.poll(1, TimeUnit.SECONDS)).isNull();

        responder.send("/app/handshake.key",
                PublicKeyRequest.builder().sessionId(sessionId).publicKey(responderKey).build());

        PeerPublicKeyEvent initiatorReceived = initiatorPeerKeys.poll(5, TimeUnit.SECONDS);
        PeerPublicKeyEvent responderReceived = responderPeerKeys.poll(5, TimeUnit.SECONDS);
        assertThat(initiatorReceived).isNotNull();
        assertThat(initiatorReceived.isSuccess()).isTrue();
        assertThat(initiatorReceived.getSessionId()).isEqualTo(sessionId);
        assertThat(initiatorReceived.getPublicKey()).isEqualTo(responderKey);
        assertThat(responderReceived).isNotNull();
        assertThat(responderReceived.isSuccess()).isTrue();
        assertThat(responderReceived.getPublicKey()).isEqualTo(initiatorKey);
    }

    /**
     * Drains the verification queue until {@code bothVerified=true} is observed, asserting that
     * every delivered event is a success without an error code. Fails if an error event arrives
     * or {@code bothVerified} is never reported.
     */
    private static void awaitBothVerifiedNoError(BlockingQueue<VerificationEvent> queue)
            throws InterruptedException {
        long deadline = System.currentTimeMillis() + 5000;
        boolean bothVerified = false;
        while (System.currentTimeMillis() < deadline && !bothVerified) {
            VerificationEvent event = queue.poll(5, TimeUnit.SECONDS);
            if (event == null) {
                break;
            }
            assertThat(event.getError())
                    .as("no error event must be delivered during a successful verification flow")
                    .isNull();
            assertThat(event.isSuccess())
                    .as("every event in a successful verification flow must be success=true")
                    .isTrue();
            if (Boolean.TRUE.equals(event.getBothVerified())) {
                bothVerified = true;
            }
        }
        assertThat(bothVerified).as("bothVerified=true must be received").isTrue();
    }

    private static String generateP256PublicKeyBase64() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        KeyPair keyPair = generator.generateKeyPair();
        return Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded());
    }

    private void seedWalletUser(String internalId, String displayName, String walletAddress) {
        UnifiedUser user = new UnifiedUser(internalId, AuthType.WALLET, displayName, null, walletAddress, null);
        Boolean saved = userIdentityRepository.save(user).block(Duration.ofSeconds(10));
        assertThat(saved).isTrue();
    }

    private StompSession connect(WebSocketStompClient client, String internalId) throws Exception {
        String token = sessionTokenService.issueToken(internalId).block(Duration.ofSeconds(10));
        assertThat(token).isNotBlank();
        return StompTestSupport.connectWallet(client, serverPort, token);
    }

    private static <T> StompFrameHandler typedHandler(Class<T> payloadType, BlockingQueue<T> sink) {
        return new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(StompHeaders headers) {
                return payloadType;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                if (!sink.offer(payloadType.cast(payload))) {
                    throw new IllegalStateException("unbounded queue must accept event");
                }
            }
        };
    }
}
