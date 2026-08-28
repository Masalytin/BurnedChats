package dev.burnedchats.handler;

import dev.burnedchats.dto.request.PeerDisconnectRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.StompAuthInterceptor.WalletPrincipal;
import dev.burnedchats.service.SessionLifecycleService;
import dev.burnedchats.telegram.BotMessageService;
import dev.burnedchats.telegram.BurnedChatsBot;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * IMP-DMRD-01: {@code /app/peer.disconnect} must mark the sender offline in Redis.
 */
@ExtendWith(MockitoExtension.class)
class SessionHandlerPeerDisconnectTest {

    private static final String SESSION = "session-disc-1";
    private static final String SENDER_INTERNAL = "sender-uuid-aaa";
    private static final String PEER_INTERNAL = "peer-uuid-bbb";

    @Mock
    private SessionRepository sessionRepository;
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

    @InjectMocks
    private SessionHandler sessionHandler;

    @Test
    @DisplayName("peer.disconnect after session validation marks sender offline")
    void handlePeerDisconnect_validSession_setsSenderOffline() {
        Session session = Session.builder()
                .id(SESSION)
                .initiatorInternalId(SENDER_INTERNAL)
                .responderInternalId(PEER_INTERNAL)
                .responderTelegramId(99L)
                .status(SessionStatus.ACTIVE)
                .build();
        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(onlineStatusRepository.setOffline(SENDER_INTERNAL)).thenReturn(Mono.just(1L));

        sessionHandler.handlePeerDisconnect(
                new PeerDisconnectRequest(SESSION, "APP_CLOSED"),
                walletPrincipal());

        verify(onlineStatusRepository).setOffline(SENDER_INTERNAL);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(PEER_INTERNAL), eq("/queue/peer-disconnected"), any());
    }

    @Test
    @DisplayName("peer.disconnect does not mark offline when sender is not a participant")
    void handlePeerDisconnect_notParticipant_doesNotSetOffline() {
        Session session = Session.builder()
                .id(SESSION)
                .initiatorInternalId("other-user")
                .responderInternalId(PEER_INTERNAL)
                .status(SessionStatus.ACTIVE)
                .build();
        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));

        sessionHandler.handlePeerDisconnect(
                new PeerDisconnectRequest(SESSION, "APP_CLOSED"),
                walletPrincipal());

        verify(onlineStatusRepository, never()).setOffline(SENDER_INTERNAL);
        verify(stompUserMessenger, never()).convertAndSendToInternalId(any(), any(), any());
    }

    private static WalletPrincipal walletPrincipal() {
        return new WalletPrincipal(new UnifiedUser(
                SENDER_INTERNAL, AuthType.WALLET, "Wallet User", null, "0xabc", null));
    }
}
