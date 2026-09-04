package dev.burnedchats.handler;

import dev.burnedchats.dto.event.SessionMessageTtlUpdatedEvent;
import dev.burnedchats.dto.request.SetSessionMessageTtlRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.StompAuthInterceptor.WalletPrincipal;
import dev.burnedchats.service.PresenceService;
import dev.burnedchats.service.SessionLifecycleService;
import dev.burnedchats.telegram.BotMessageService;
import dev.burnedchats.telegram.BurnedChatsBot;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * IMP-DISAPPEAR-01: {@code /app/session.setMessageTtl} ACL, validation, fan-out.
 */
@ExtendWith(MockitoExtension.class)
class SessionHandlerSetMessageTtlTest {

    private static final String SESSION_ID = "session-ttl-1";
    private static final String INITIATOR = "initiator-uuid";
    private static final String RESPONDER = "responder-uuid";
    private static final String TTL_DESTINATION = "/queue/session-message-ttl-updated";

    @Mock
    private SessionRepository sessionRepository;
    @Mock
    private MessageRepository messageRepository;
    @Mock
    private StompUserMessenger stompUserMessenger;
    @Mock
    private BurnedChatsBot telegramBot;
    @Mock
    private BotMessageService botMessages;
    @Mock
    private WebSocketExceptionHandler webSocketExceptionHandler;
    @Mock
    private SessionLifecycleService sessionLifecycleService;
    @Mock
    private OnlineStatusRepository onlineStatusRepository;
    @Mock
    private PresenceService presenceService;

    @InjectMocks
    private SessionHandler sessionHandler;

    @Test
    @DisplayName("ACTIVE participant set 300s HSETs and fans out to both internals")
    void setMessageTtl_activeParticipant_hsetsAndFansOut() {
        stubActiveSession();
        when(sessionRepository.updateMessageTtl(SESSION_ID, 300)).thenReturn(Mono.just(true));
        when(messageRepository.pruneExpiredMessages(eq(SESSION_ID), eq(INITIATOR), eq(RESPONDER), eq(300)))
                .thenReturn(Mono.empty());

        sessionHandler.setMessageTtl(request(300), walletPrincipal(INITIATOR));

        verify(sessionRepository).updateMessageTtl(SESSION_ID, 300);
        verify(messageRepository).pruneExpiredMessages(SESSION_ID, INITIATOR, RESPONDER, 300);

        ArgumentCaptor<SessionMessageTtlUpdatedEvent> eventCap =
                ArgumentCaptor.forClass(SessionMessageTtlUpdatedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(eq(INITIATOR), eq(TTL_DESTINATION), eventCap.capture());
        verify(stompUserMessenger).convertAndSendToInternalId(eq(RESPONDER), eq(TTL_DESTINATION), eventCap.capture());

        assertThat(eventCap.getAllValues()).hasSize(2);
        for (SessionMessageTtlUpdatedEvent event : eventCap.getAllValues()) {
            assertThat(event.isSuccess()).isTrue();
            assertThat(event.getEventType()).isEqualTo("SESSION_MESSAGE_TTL_UPDATED");
            assertThat(event.getSessionId()).isEqualTo(SESSION_ID);
            assertThat(event.getMessageTtlSeconds()).isEqualTo(300);
            assertThat(event.getUpdatedAt()).isNotNull();
        }
    }

    @Test
    @DisplayName("PENDING participant cannot set TTL — no write, error to caller only")
    void setMessageTtl_pending_noWriteNoSuccessEvent() {
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(session(SessionStatus.PENDING)));

        sessionHandler.setMessageTtl(request(300), walletPrincipal(INITIATOR));

        verify(sessionRepository, never()).updateMessageTtl(any(), anyInt());
        verify(messageRepository, never()).pruneExpiredMessages(any(), any(), any(), anyInt());
        verifyErrorToCallerOnly("SESSION_NOT_ACTIVE");
    }

    @Test
    @DisplayName("HANDSHAKE participant cannot set TTL — no write")
    void setMessageTtl_handshake_noWrite() {
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(session(SessionStatus.HANDSHAKE)));

        sessionHandler.setMessageTtl(request(300), walletPrincipal(RESPONDER));

        verify(sessionRepository, never()).updateMessageTtl(any(), anyInt());
        verifyErrorToCallerOnly(RESPONDER, "SESSION_NOT_ACTIVE");
    }

    @Test
    @DisplayName("non-participant cannot set TTL — no write, no peer event")
    void setMessageTtl_notParticipant_noWrite() {
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(session(SessionStatus.ACTIVE)));

        sessionHandler.setMessageTtl(request(300), walletPrincipal("stranger-uuid"));

        verify(sessionRepository, never()).updateMessageTtl(any(), anyInt());
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq("stranger-uuid"), eq(TTL_DESTINATION), any(SessionMessageTtlUpdatedEvent.class));
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(INITIATOR), eq(TTL_DESTINATION), any());
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(RESPONDER), eq(TTL_DESTINATION), any());
    }

    @Test
    @DisplayName("missing session → SESSION_NOT_FOUND, no write")
    void setMessageTtl_missingSession_notFound() {
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.empty());

        sessionHandler.setMessageTtl(request(300), walletPrincipal(INITIATOR));

        verify(sessionRepository, never()).updateMessageTtl(any(), anyInt());
        ArgumentCaptor<SessionMessageTtlUpdatedEvent> eventCap =
                ArgumentCaptor.forClass(SessionMessageTtlUpdatedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(INITIATOR), eq(TTL_DESTINATION), eventCap.capture());
        assertThat(eventCap.getValue().getError()).isEqualTo("SESSION_NOT_FOUND");
    }

    @Test
    @DisplayName("messageTtlSeconds > 86400 → INVALID_MESSAGE_TTL")
    void setMessageTtl_aboveMax_invalid() {
        sessionHandler.setMessageTtl(request(86401), walletPrincipal(INITIATOR));

        verify(sessionRepository, never()).findById(any());
        verify(sessionRepository, never()).updateMessageTtl(any(), anyInt());
        ArgumentCaptor<SessionMessageTtlUpdatedEvent> eventCap =
                ArgumentCaptor.forClass(SessionMessageTtlUpdatedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(INITIATOR), eq(TTL_DESTINATION), eventCap.capture());
        assertThat(eventCap.getValue().getError()).isEqualTo("INVALID_MESSAGE_TTL");
    }

    @Test
    @DisplayName("messageTtlSeconds < 0 → INVALID_MESSAGE_TTL")
    void setMessageTtl_negative_invalid() {
        sessionHandler.setMessageTtl(request(-1), walletPrincipal(INITIATOR));

        verify(sessionRepository, never()).updateMessageTtl(any(), anyInt());
        ArgumentCaptor<SessionMessageTtlUpdatedEvent> eventCap =
                ArgumentCaptor.forClass(SessionMessageTtlUpdatedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(INITIATOR), eq(TTL_DESTINATION), eventCap.capture());
        assertThat(eventCap.getValue().getError()).isEqualTo("INVALID_MESSAGE_TTL");
    }

    @Test
    @DisplayName("set 5m then 1h: last HSET wins, both get events, updatedAt is monotonic")
    void setMessageTtl_lastWriteWinsMonotonicUpdatedAt() {
        stubActiveSession();
        when(sessionRepository.updateMessageTtl(eq(SESSION_ID), anyInt())).thenReturn(Mono.just(true));
        when(messageRepository.pruneExpiredMessages(eq(SESSION_ID), eq(INITIATOR), eq(RESPONDER), anyInt()))
                .thenReturn(Mono.empty());

        sessionHandler.setMessageTtl(request(300), walletPrincipal(INITIATOR));
        sessionHandler.setMessageTtl(request(3600), walletPrincipal(RESPONDER));

        verify(sessionRepository).updateMessageTtl(SESSION_ID, 300);
        verify(sessionRepository).updateMessageTtl(SESSION_ID, 3600);

        ArgumentCaptor<SessionMessageTtlUpdatedEvent> eventCap =
                ArgumentCaptor.forClass(SessionMessageTtlUpdatedEvent.class);
        verify(stompUserMessenger, times(4))
                .convertAndSendToInternalId(any(), eq(TTL_DESTINATION), eventCap.capture());

        SessionMessageTtlUpdatedEvent first = eventCap.getAllValues().get(0);
        SessionMessageTtlUpdatedEvent last = eventCap.getAllValues().get(3);
        assertThat(first.getMessageTtlSeconds()).isEqualTo(300);
        assertThat(last.getMessageTtlSeconds()).isEqualTo(3600);
        assertThat(last.getUpdatedAt()).isNotNull();
        assertThat(first.getUpdatedAt()).isNotNull();
        assertThat(last.getUpdatedAt().isBefore(first.getUpdatedAt())).isFalse();
    }

    @Test
    @DisplayName("set 0 after 300 disables prune (HSET 0, prune called with 0)")
    void setMessageTtl_zeroResetsPrune() {
        stubActiveSession();
        when(sessionRepository.updateMessageTtl(SESSION_ID, 0)).thenReturn(Mono.just(true));
        when(messageRepository.pruneExpiredMessages(eq(SESSION_ID), eq(INITIATOR), eq(RESPONDER), eq(0)))
                .thenReturn(Mono.empty());

        sessionHandler.setMessageTtl(request(0), walletPrincipal(INITIATOR));

        verify(sessionRepository).updateMessageTtl(SESSION_ID, 0);
        verify(messageRepository).pruneExpiredMessages(SESSION_ID, INITIATOR, RESPONDER, 0);
    }

    private void stubActiveSession() {
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(session(SessionStatus.ACTIVE)));
    }

    private static Session session(SessionStatus status) {
        return Session.builder()
                .id(SESSION_ID)
                .initiatorInternalId(INITIATOR)
                .responderInternalId(RESPONDER)
                .status(status)
                .build();
    }

    private static SetSessionMessageTtlRequest request(int ttlSeconds) {
        return SetSessionMessageTtlRequest.builder()
                .sessionId(SESSION_ID)
                .messageTtlSeconds(ttlSeconds)
                .build();
    }

    private static WalletPrincipal walletPrincipal(String internalId) {
        return new WalletPrincipal(new UnifiedUser(
                internalId, AuthType.WALLET, "Wallet User", null, "0xabc", null));
    }

    private void verifyErrorToCallerOnly(String errorCode) {
        verifyErrorToCallerOnly(INITIATOR, errorCode);
    }

    private void verifyErrorToCallerOnly(String callerInternalId, String errorCode) {
        ArgumentCaptor<SessionMessageTtlUpdatedEvent> eventCap =
                ArgumentCaptor.forClass(SessionMessageTtlUpdatedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(callerInternalId), eq(TTL_DESTINATION), eventCap.capture());
        assertThat(eventCap.getValue().isSuccess()).isFalse();
        assertThat(eventCap.getValue().getError()).isEqualTo(errorCode);
        String peer = INITIATOR.equals(callerInternalId) ? RESPONDER : INITIATOR;
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(peer), eq(TTL_DESTINATION), any());
    }
}
