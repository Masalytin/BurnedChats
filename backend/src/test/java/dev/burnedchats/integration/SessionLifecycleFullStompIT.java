package dev.burnedchats.integration;

import dev.burnedchats.dto.event.ActiveSessionsListEvent;
import dev.burnedchats.dto.event.IncomingRequestEvent;
import dev.burnedchats.dto.event.SessionAcceptedEvent;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.event.SessionRejectedEvent;
import dev.burnedchats.dto.event.SessionResumedEvent;
import dev.burnedchats.dto.request.AcceptSessionRequest;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.RejectSessionRequest;
import dev.burnedchats.dto.request.ResumeSessionRequest;
import dev.burnedchats.dto.request.SessionStatusRequest;
import dev.burnedchats.model.Session.SessionStatus;
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
import java.time.Duration;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Full DM session lifecycle over real STOMP + Redis: create → accept → active-list → resume,
 * plus the create → reject path. Covers {@code SessionHandler} and {@link dev.burnedchats.service.SessionLifecycleService}
 * end-to-end across two distinct participants (IMP-AUDIT-16).
 *
 * <p>Uses wallet identities (Telegram id {@code null}) so the two-user flow needs no Telegram
 * notification stubbing — see {@code IMP-AUDIT-16} decision-log.
 */
@Tag("integration")
class SessionLifecycleFullStompIT extends StompIntegrationTestBase {

    private static final String INITIATOR_INTERNAL_ID = "11111111-1111-1111-1111-111111111111";
    private static final String RESPONDER_INTERNAL_ID = "22222222-2222-2222-2222-222222222222";
    private static final String INITIATOR_WALLET = "eq" + "1".repeat(46);
    private static final String RESPONDER_WALLET = "eq" + "2".repeat(46);

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
    void createAcceptListResume_fullHappyPath() throws Exception {
        WebSocketStompClient initiatorClient = StompTestSupport.createStompClient();
        WebSocketStompClient responderClient = StompTestSupport.createStompClient();
        try {
            StompSession initiator = connect(initiatorClient, INITIATOR_INTERNAL_ID);
            StompSession responder = connect(responderClient, RESPONDER_INTERNAL_ID);

            // 1. create — initiator gets session-created, responder gets incoming-request
            BlockingQueue<SessionCreatedEvent> created = new LinkedBlockingQueue<>();
            BlockingQueue<IncomingRequestEvent> incoming = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/session-created", typedHandler(SessionCreatedEvent.class, created));
            responder.subscribe("/user/queue/incoming-request", typedHandler(IncomingRequestEvent.class, incoming));
            StompTestSupport.awaitSubscriptionProcessed();

            CreateSessionRequest createRequest = new CreateSessionRequest();
            createRequest.setRecipientInternalId(RESPONDER_INTERNAL_ID);
            initiator.send("/app/session.create", createRequest);

            SessionCreatedEvent createdEvent = created.poll(5, TimeUnit.SECONDS);
            assertThat(createdEvent).isNotNull();
            assertThat(createdEvent.isSuccess()).isTrue();
            String sessionId = createdEvent.getSessionId();
            assertThat(sessionId).isNotBlank();

            IncomingRequestEvent incomingEvent = incoming.poll(5, TimeUnit.SECONDS);
            assertThat(incomingEvent).isNotNull();
            assertThat(incomingEvent.getSessionId()).isEqualTo(sessionId);
            assertThat(incomingEvent.getFromInternalId()).isEqualTo(INITIATOR_INTERNAL_ID);

            // 2. accept — both participants receive session-accepted; session moves to HANDSHAKE
            BlockingQueue<SessionAcceptedEvent> initiatorAccepted = new LinkedBlockingQueue<>();
            BlockingQueue<SessionAcceptedEvent> responderAccepted = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/session-accepted",
                    typedHandler(SessionAcceptedEvent.class, initiatorAccepted));
            responder.subscribe("/user/queue/session-accepted",
                    typedHandler(SessionAcceptedEvent.class, responderAccepted));
            StompTestSupport.awaitSubscriptionProcessed();

            AcceptSessionRequest acceptRequest = AcceptSessionRequest.builder().sessionId(sessionId).build();
            responder.send("/app/session.accept", acceptRequest);

            SessionAcceptedEvent initiatorEvent = initiatorAccepted.poll(5, TimeUnit.SECONDS);
            SessionAcceptedEvent responderEvent = responderAccepted.poll(5, TimeUnit.SECONDS);
            assertThat(initiatorEvent).isNotNull();
            assertThat(initiatorEvent.isSuccess()).isTrue();
            assertThat(initiatorEvent.getSessionId()).isEqualTo(sessionId);
            assertThat(responderEvent).isNotNull();
            assertThat(responderEvent.isSuccess()).isTrue();

            // 3. active-list — initiator sees exactly one active session
            BlockingQueue<ActiveSessionsListEvent> activeSessions = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/active-sessions",
                    typedHandler(ActiveSessionsListEvent.class, activeSessions));
            StompTestSupport.awaitSubscriptionProcessed();

            initiator.send("/app/session.active.list", "");

            ActiveSessionsListEvent listEvent = activeSessions.poll(5, TimeUnit.SECONDS);
            assertThat(listEvent).isNotNull();
            assertThat(listEvent.isSuccess()).isTrue();
            assertThat(listEvent.getCount()).isEqualTo(1);
            assertThat(listEvent.getSessions()).hasSize(1);
            assertThat(listEvent.getSessions().get(0).getSessionId()).isEqualTo(sessionId);

            // 4. resume — initiator restores the (HANDSHAKE) session state
            BlockingQueue<SessionResumedEvent> resumed = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/session-resumed",
                    typedHandler(SessionResumedEvent.class, resumed));
            StompTestSupport.awaitSubscriptionProcessed();

            initiator.send("/app/session.resume", new ResumeSessionRequest(sessionId));

            SessionResumedEvent resumedEvent = resumed.poll(5, TimeUnit.SECONDS);
            assertThat(resumedEvent).isNotNull();
            assertThat(resumedEvent.isSuccess()).isTrue();
            assertThat(resumedEvent.getSessionId()).isEqualTo(sessionId);
            assertThat(resumedEvent.getStatus()).isEqualTo(SessionStatus.HANDSHAKE);
        } finally {
            initiatorClient.stop();
            responderClient.stop();
        }
    }

    @Test
    void createReject_initiatorReceivesRejected() throws Exception {
        WebSocketStompClient initiatorClient = StompTestSupport.createStompClient();
        WebSocketStompClient responderClient = StompTestSupport.createStompClient();
        try {
            StompSession initiator = connect(initiatorClient, INITIATOR_INTERNAL_ID);
            StompSession responder = connect(responderClient, RESPONDER_INTERNAL_ID);

            BlockingQueue<SessionCreatedEvent> created = new LinkedBlockingQueue<>();
            BlockingQueue<IncomingRequestEvent> incoming = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/session-created", typedHandler(SessionCreatedEvent.class, created));
            responder.subscribe("/user/queue/incoming-request", typedHandler(IncomingRequestEvent.class, incoming));
            StompTestSupport.awaitSubscriptionProcessed();

            CreateSessionRequest createRequest = new CreateSessionRequest();
            createRequest.setRecipientInternalId(RESPONDER_INTERNAL_ID);
            initiator.send("/app/session.create", createRequest);

            SessionCreatedEvent createdEvent = created.poll(5, TimeUnit.SECONDS);
            assertThat(createdEvent).isNotNull();
            String sessionId = createdEvent.getSessionId();
            assertThat(incoming.poll(5, TimeUnit.SECONDS)).isNotNull();

            BlockingQueue<SessionRejectedEvent> rejected = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/session-rejected",
                    typedHandler(SessionRejectedEvent.class, rejected));
            StompTestSupport.awaitSubscriptionProcessed();

            RejectSessionRequest rejectRequest = RejectSessionRequest.builder().sessionId(sessionId).build();
            responder.send("/app/session.reject", rejectRequest);

            SessionRejectedEvent rejectedEvent = rejected.poll(5, TimeUnit.SECONDS);
            assertThat(rejectedEvent).isNotNull();
            assertThat(rejectedEvent.getSessionId()).isEqualTo(sessionId);

            // session is gone — a status check reports it expired
            BlockingQueue<dev.burnedchats.dto.event.SessionStatusEvent> statuses = new LinkedBlockingQueue<>();
            initiator.subscribe("/user/queue/session-status",
                    typedHandler(dev.burnedchats.dto.event.SessionStatusEvent.class, statuses));
            StompTestSupport.awaitSubscriptionProcessed();

            initiator.send("/app/session.status", new SessionStatusRequest(sessionId));

            dev.burnedchats.dto.event.SessionStatusEvent statusEvent = statuses.poll(5, TimeUnit.SECONDS);
            assertThat(statusEvent).isNotNull();
            assertThat(statusEvent.getSessionId()).isEqualTo(sessionId);
            assertThat(statusEvent.isActive()).isFalse();
        } finally {
            initiatorClient.stop();
            responderClient.stop();
        }
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
