package dev.burnedchats.integration;

import dev.burnedchats.dto.event.PeerPublicKeyEvent;
import dev.burnedchats.dto.event.SessionAcceptedEvent;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.event.SyncMessagesEvent;
import dev.burnedchats.dto.request.AcceptSessionRequest;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.PublicKeyRequest;
import dev.burnedchats.dto.request.SyncMessagesRequest;
import dev.burnedchats.model.Message;
import dev.burnedchats.model.MessageDeletion;
import dev.burnedchats.model.MessageEdit;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.MessageRepository;
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
import java.time.Instant;
import java.util.Base64;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test: stale offline queues are dropped on DM rekey; deletions survive.
 */
@Tag("integration")
class HandshakeRekeyOfflineQueueIT extends StompIntegrationTestBase {

    private static final String INITIATOR_INTERNAL_ID = "55555555-5555-5555-5555-555555555555";
    private static final String RESPONDER_INTERNAL_ID = "66666666-6666-6666-6666-666666666666";
    private static final String INITIATOR_WALLET = "eq" + "5".repeat(46);
    private static final String RESPONDER_WALLET = "eq" + "6".repeat(46);

    @Autowired
    private SessionTokenService sessionTokenService;

    @Autowired
    private UserIdentityRepository userIdentityRepository;

    @Autowired
    private MessageRepository messageRepository;

    @BeforeEach
    void seedWalletUsers() {
        seedWalletUser(INITIATOR_INTERNAL_ID, "Initiator", INITIATOR_WALLET);
        seedWalletUser(RESPONDER_INTERNAL_ID, "Responder", RESPONDER_WALLET);
    }

    @Test
    void rekeyDropsStaleMessagesAndEditsButPreservesDeletions() throws Exception {
        WebSocketStompClient initiatorClient = StompTestSupport.createStompClient();
        WebSocketStompClient responderClient = StompTestSupport.createStompClient();
        try {
            StompSession initiator = connect(initiatorClient, INITIATOR_INTERNAL_ID);
            StompSession responder = connect(responderClient, RESPONDER_INTERNAL_ID);

            String sessionId = createAndAccept(initiator, responder);
            relayHandshake(initiator, responder, sessionId);

            queueStaleOfflinePayloads(sessionId);

            assertThat(messageRepository.getPendingMessages(INITIATOR_INTERNAL_ID, sessionId)
                    .collectList().block(Duration.ofSeconds(5))).hasSize(1);
            assertThat(messageRepository.getPendingEdits(RESPONDER_INTERNAL_ID, sessionId)
                    .collectList().block(Duration.ofSeconds(5))).hasSize(1);

            relayRekey(initiator, responder, sessionId);

            assertThat(messageRepository.getPendingMessages(INITIATOR_INTERNAL_ID, sessionId)
                    .collectList().block(Duration.ofSeconds(5))).isEmpty();
            assertThat(messageRepository.getPendingEdits(RESPONDER_INTERNAL_ID, sessionId)
                    .collectList().block(Duration.ofSeconds(5))).isEmpty();
            assertThat(messageRepository.getPendingDeletions(INITIATOR_INTERNAL_ID, sessionId)
                    .collectList().block(Duration.ofSeconds(5))).hasSize(1);

            BlockingQueue<SyncMessagesEvent> syncEvents = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/sync-messages",
                    typedHandler(SyncMessagesEvent.class, syncEvents));
            StompTestSupport.awaitSubscriptionProcessed();

            initiator.send("/app/message.sync", new SyncMessagesRequest(sessionId));

            SyncMessagesEvent sync = syncEvents.poll(5, TimeUnit.SECONDS);
            assertThat(sync).isNotNull();
            assertThat(sync.isSuccess()).isTrue();
            assertThat(sync.getMessages()).isEmpty();
            assertThat(sync.getEdits()).isEmpty();
            assertThat(sync.getDeletedIds()).containsExactly("deleted-after-rekey");
        } finally {
            initiatorClient.stop();
            responderClient.stop();
        }
    }

    private void queueStaleOfflinePayloads(String sessionId) {
        Message toInitiator = Message.builder()
                .messageId("stale-msg-initiator")
                .sessionId(sessionId)
                .senderInternalId(RESPONDER_INTERNAL_ID)
                .recipientInternalId(INITIATOR_INTERNAL_ID)
                .encryptedContent("k1-ciphertext")
                .iv("iv")
                .clientTimestamp(1L)
                .serverTimestamp(Instant.parse("2025-06-01T12:00:00Z"))
                .type("text")
                .build();
        MessageEdit toResponder = MessageEdit.builder()
                .messageId("stale-edit-responder")
                .sessionId(sessionId)
                .encryptedContent("k1-edit")
                .iv("iv-edit")
                .editedAt(Instant.parse("2025-06-01T12:05:00Z"))
                .build();
        MessageDeletion tombstone = MessageDeletion.builder()
                .messageId("deleted-after-rekey")
                .build();

        assertThat(messageRepository.queueMessage(toInitiator).block(Duration.ofSeconds(5))).isTrue();
        assertThat(messageRepository.queueEdit(RESPONDER_INTERNAL_ID, sessionId, toResponder)
                .block(Duration.ofSeconds(5))).isTrue();
        assertThat(messageRepository.queueDeletion(INITIATOR_INTERNAL_ID, sessionId, tombstone)
                .block(Duration.ofSeconds(5))).isTrue();
    }

    private String createAndAccept(StompSession initiator, StompSession responder) throws Exception {
        BlockingQueue<SessionCreatedEvent> created = new LinkedBlockingQueue<>();
        BlockingQueue<SessionAcceptedEvent> initiatorAccepted = new LinkedBlockingQueue<>();
        initiator.subscribe("/user/queue/session-created", typedHandler(SessionCreatedEvent.class, created));
        initiator.subscribe("/user/queue/session-accepted",
                typedHandler(SessionAcceptedEvent.class, initiatorAccepted));
        StompTestSupport.awaitSubscriptionProcessed();

        CreateSessionRequest createRequest = new CreateSessionRequest();
        createRequest.setRecipientInternalId(RESPONDER_INTERNAL_ID);
        initiator.send("/app/session.create", createRequest);

        SessionCreatedEvent createdEvent = created.poll(5, TimeUnit.SECONDS);
        assertThat(createdEvent).isNotNull();
        assertThat(createdEvent.isSuccess()).isTrue();
        String sessionId = createdEvent.getSessionId();

        responder.send("/app/session.accept", AcceptSessionRequest.builder().sessionId(sessionId).build());
        SessionAcceptedEvent accepted = initiatorAccepted.poll(5, TimeUnit.SECONDS);
        assertThat(accepted).isNotNull();
        assertThat(accepted.isSuccess()).isTrue();
        return sessionId;
    }

    private void relayHandshake(StompSession initiator, StompSession responder, String sessionId) throws Exception {
        relayKeys(initiator, responder, sessionId, generateP256PublicKeyBase64(), generateP256PublicKeyBase64());
    }

    private void relayRekey(StompSession initiator, StompSession responder, String sessionId) throws Exception {
        relayKeys(initiator, responder, sessionId, generateP256PublicKeyBase64(), generateP256PublicKeyBase64());
    }

    private void relayKeys(StompSession initiator, StompSession responder, String sessionId,
            String initiatorKey, String responderKey) throws Exception {
        BlockingQueue<PeerPublicKeyEvent> initiatorPeerKeys = new LinkedBlockingQueue<>();
        BlockingQueue<PeerPublicKeyEvent> responderPeerKeys = new LinkedBlockingQueue<>();
        initiator.subscribe("/user/queue/peer-key", typedHandler(PeerPublicKeyEvent.class, initiatorPeerKeys));
        responder.subscribe("/user/queue/peer-key", typedHandler(PeerPublicKeyEvent.class, responderPeerKeys));
        StompTestSupport.awaitSubscriptionProcessed();

        initiator.send("/app/handshake.key",
                PublicKeyRequest.builder().sessionId(sessionId).publicKey(initiatorKey).build());
        responder.send("/app/handshake.key",
                PublicKeyRequest.builder().sessionId(sessionId).publicKey(responderKey).build());

        assertThat(initiatorPeerKeys.poll(5, TimeUnit.SECONDS)).isNotNull();
        assertThat(responderPeerKeys.poll(5, TimeUnit.SECONDS)).isNotNull();
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
