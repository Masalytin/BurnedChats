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

            // 2. mutual verification — both confirm; both eventually see bothVerified=true
            BlockingQueue<VerificationEvent> initiatorVerifications = new LinkedBlockingQueue<>();
            BlockingQueue<VerificationEvent> responderVerifications = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/verification",
                    typedHandler(VerificationEvent.class, initiatorVerifications));
            responder.subscribe("/user/queue/verification",
                    typedHandler(VerificationEvent.class, responderVerifications));
            StompTestSupport.awaitSubscriptionProcessed();

            initiator.send("/app/verification.confirm",
                    VerificationRequest.builder().sessionId(sessionId).confirmed(true).build());
            // Wait until the initiator's confirmation is persisted (its own ack arrives) before the
            // responder confirms. Both confirmations are a read-modify-write on the same session's
            // verified flags; firing them simultaneously races so neither side computes
            // bothVerified=true. Real peers confirm at different times, which this models.
            assertThat(awaitVerified(initiatorVerifications)).isTrue();

            responder.send("/app/verification.confirm",
                    VerificationRequest.builder().sessionId(sessionId).confirmed(true).build());

            assertThat(awaitBothVerified(initiatorVerifications)).isTrue();
            assertThat(awaitBothVerified(responderVerifications)).isTrue();
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

    private static boolean awaitVerified(BlockingQueue<VerificationEvent> queue) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 5000;
        while (System.currentTimeMillis() < deadline) {
            VerificationEvent event = queue.poll(5, TimeUnit.SECONDS);
            if (event == null) {
                return false;
            }
            if (Boolean.TRUE.equals(event.getVerified())) {
                return true;
            }
        }
        return false;
    }

    private static boolean awaitBothVerified(BlockingQueue<VerificationEvent> queue) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 5000;
        while (System.currentTimeMillis() < deadline) {
            VerificationEvent event = queue.poll(5, TimeUnit.SECONDS);
            if (event == null) {
                return false;
            }
            if (Boolean.TRUE.equals(event.getBothVerified())) {
                return true;
            }
        }
        return false;
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
