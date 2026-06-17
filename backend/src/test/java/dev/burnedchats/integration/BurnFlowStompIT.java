package dev.burnedchats.integration;

import dev.burnedchats.dto.event.BurnSignalEvent;
import dev.burnedchats.dto.event.IncomingRequestEvent;
import dev.burnedchats.dto.event.SessionAcceptedEvent;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.event.SessionStatusEvent;
import dev.burnedchats.dto.request.AcceptSessionRequest;
import dev.burnedchats.dto.request.BurnSessionRequest;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.SessionStatusRequest;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.SessionRepository;
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
import java.time.Duration;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Burn-flow critical path (IMP-AUDIT-16): once a session is established, either participant burns
 * it, both sides receive a {@link BurnSignalEvent}, and the session is purged from Redis.
 *
 * <p>Covers {@code BurnHandler} including the cleanup ({@code session} delete) — verified both via
 * the burn signal and by querying {@link SessionRepository} directly afterwards.
 */
@Tag("integration")
class BurnFlowStompIT extends StompIntegrationTestBase {

    private static final String INITIATOR_INTERNAL_ID = "55555555-5555-5555-5555-555555555555";
    private static final String RESPONDER_INTERNAL_ID = "66666666-6666-6666-6666-666666666666";
    private static final String INITIATOR_WALLET = "eq" + "5".repeat(46);
    private static final String RESPONDER_WALLET = "eq" + "6".repeat(46);

    @Autowired
    private SessionTokenService sessionTokenService;

    @Autowired
    private UserIdentityRepository userIdentityRepository;

    @Autowired
    private SessionRepository sessionRepository;

    @BeforeEach
    void seedWalletUsers() {
        seedWalletUser(INITIATOR_INTERNAL_ID, "Initiator", INITIATOR_WALLET);
        seedWalletUser(RESPONDER_INTERNAL_ID, "Responder", RESPONDER_WALLET);
    }

    @Test
    void burnSession_signalsBothParticipantsAndPurgesSession() throws Exception {
        WebSocketStompClient initiatorClient = StompTestSupport.createStompClient();
        WebSocketStompClient responderClient = StompTestSupport.createStompClient();
        try {
            StompSession initiator = connect(initiatorClient, INITIATOR_INTERNAL_ID);
            StompSession responder = connect(responderClient, RESPONDER_INTERNAL_ID);

            String sessionId = createAndAccept(initiator, responder);
            assertThat(sessionRepository.findById(sessionId).block(Duration.ofSeconds(5))).isNotNull();

            BlockingQueue<BurnSignalEvent> initiatorBurns = new LinkedBlockingQueue<>();
            BlockingQueue<BurnSignalEvent> responderBurns = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/burn-signal", typedHandler(BurnSignalEvent.class, initiatorBurns));
            responder.subscribe("/user/queue/burn-signal", typedHandler(BurnSignalEvent.class, responderBurns));
            StompTestSupport.awaitSubscriptionProcessed();

            // responder burns the session
            responder.send("/app/session.burn", BurnSessionRequest.builder().sessionId(sessionId).build());

            BurnSignalEvent initiatorSignal = initiatorBurns.poll(5, TimeUnit.SECONDS);
            BurnSignalEvent responderSignal = responderBurns.poll(5, TimeUnit.SECONDS);
            assertThat(initiatorSignal).isNotNull();
            assertThat(initiatorSignal.isSuccess()).isTrue();
            assertThat(initiatorSignal.getSessionId()).isEqualTo(sessionId);
            assertThat(responderSignal).isNotNull();
            assertThat(responderSignal.isSuccess()).isTrue();
            assertThat(responderSignal.getSessionId()).isEqualTo(sessionId);

            // session is purged from Redis
            assertThat(sessionRepository.findById(sessionId).block(Duration.ofSeconds(5))).isNull();
        } finally {
            initiatorClient.stop();
            responderClient.stop();
        }
    }

    @Test
    void burnAlreadyBurnedSession_returnsError() throws Exception {
        WebSocketStompClient initiatorClient = StompTestSupport.createStompClient();
        WebSocketStompClient responderClient = StompTestSupport.createStompClient();
        try {
            StompSession initiator = connect(initiatorClient, INITIATOR_INTERNAL_ID);
            StompSession responder = connect(responderClient, RESPONDER_INTERNAL_ID);

            String sessionId = createAndAccept(initiator, responder);

            BlockingQueue<BurnSignalEvent> initiatorBurns = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/burn-signal", typedHandler(BurnSignalEvent.class, initiatorBurns));
            StompTestSupport.awaitSubscriptionProcessed();

            initiator.send("/app/session.burn", BurnSessionRequest.builder().sessionId(sessionId).build());
            BurnSignalEvent firstSignal = initiatorBurns.poll(5, TimeUnit.SECONDS);
            assertThat(firstSignal).isNotNull();
            assertThat(firstSignal.isSuccess()).isTrue();

            // burning a purged session yields a SESSION_NOT_FOUND error rather than a success signal
            initiator.send("/app/session.burn", BurnSessionRequest.builder().sessionId(sessionId).build());
            BurnSignalEvent secondSignal = initiatorBurns.poll(5, TimeUnit.SECONDS);
            assertThat(secondSignal).isNotNull();
            assertThat(secondSignal.isSuccess()).isFalse();
            assertThat(secondSignal.getError()).isEqualTo("SESSION_NOT_FOUND");

            // a status check confirms the session is no longer active
            BlockingQueue<SessionStatusEvent> statuses = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/session-status", typedHandler(SessionStatusEvent.class, statuses));
            StompTestSupport.awaitSubscriptionProcessed();

            initiator.send("/app/session.status", new SessionStatusRequest(sessionId));
            SessionStatusEvent statusEvent = statuses.poll(5, TimeUnit.SECONDS);
            assertThat(statusEvent).isNotNull();
            assertThat(statusEvent.isActive()).isFalse();
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
