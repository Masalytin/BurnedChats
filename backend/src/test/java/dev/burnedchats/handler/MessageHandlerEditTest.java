package dev.burnedchats.handler;

import dev.burnedchats.dto.event.MessageEditedEvent;
import dev.burnedchats.dto.request.EditMessageRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.model.DmMessageEditableMeta;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.StompAuthInterceptor.WalletPrincipal;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.FileMessageRelayValidator;
import dev.burnedchats.telegram.BurnedChatsBot;
import dev.burnedchats.telegram.BotMessageService;
import dev.burnedchats.util.InternalIds;
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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MessageHandlerEditTest {

    private static final String SESSION = "session-1";
    private static final String MESSAGE_ID = "msg-1";
    private static final String WALLET_INTERNAL = "wallet-uuid-aaa";
    private static final String PEER_INTERNAL = "peer-uuid-bbb";
    private static final String TG_EDITOR_INTERNAL = InternalIds.forTelegramId(42L);
    private static final long TG_ID = 42L;

    @Mock
    private SessionRepository sessionRepository;
    @Mock
    private MessageRepository messageRepository;
    @Mock
    private OnlineStatusRepository onlineStatusRepository;
    @Mock
    private StompUserMessenger stompUserMessenger;
    @Mock
    private BurnedChatsBot telegramBot;
    @Mock
    private BotMessageService botMessages;
    @Mock
    private FileMessageRelayValidator fileMessageRelayValidator;
    @Mock
    private FileBurnService fileBurnService;
    @Mock
    private OfflineQueueMetrics offlineQueueMetrics;

    @InjectMocks
    private MessageHandler messageHandler;

    @Test
    void editMessage_walletUser_deliveredMessage_succeedsByInternalId() {
        EditMessageRequest req = editRequest();
        WalletPrincipal wallet = walletPrincipal(WALLET_INTERNAL);
        Session session = activeSession(WALLET_INTERNAL, PEER_INTERNAL, null, 99L);

        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(onlineStatusRepository.isOnline(PEER_INTERNAL)).thenReturn(Mono.just(true));
        when(messageRepository.updateMessageInQueue(
                eq(PEER_INTERNAL), eq(SESSION), eq(MESSAGE_ID),
                eq(WALLET_INTERNAL), eq(null),
                eq("cipher"), eq("0123456789abcdef"), any(Instant.class)))
                .thenReturn(Mono.just(false));
        when(messageRepository.getDmMessageEditableMeta(SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(DmMessageEditableMeta.builder()
                        .senderInternalId(WALLET_INTERNAL)
                        .senderId(null)
                        .serverTimestamp(Instant.now())
                        .build()));

        messageHandler.editMessage(req, wallet);

        ArgumentCaptor<MessageEditedEvent> captor = ArgumentCaptor.forClass(MessageEditedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(WALLET_INTERNAL), eq("/queue/message-edited"), captor.capture());
        assertThat(captor.getValue().isSuccess()).isTrue();
        assertThat(captor.getValue().getMessageId()).isEqualTo(MESSAGE_ID);
    }

    @Test
    void editMessage_walletUser_offlineQueue_succeedsByInternalId() {
        EditMessageRequest req = editRequest();
        WalletPrincipal wallet = walletPrincipal(WALLET_INTERNAL);
        Session session = activeSession(WALLET_INTERNAL, PEER_INTERNAL, null, 99L);

        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(onlineStatusRepository.isOnline(PEER_INTERNAL)).thenReturn(Mono.just(false));
        when(messageRepository.updateMessageInQueue(
                eq(PEER_INTERNAL), eq(SESSION), eq(MESSAGE_ID),
                eq(WALLET_INTERNAL), eq(null),
                eq("cipher"), eq("0123456789abcdef"), any(Instant.class)))
                .thenReturn(Mono.just(true));

        messageHandler.editMessage(req, wallet);

        ArgumentCaptor<MessageEditedEvent> captor = ArgumentCaptor.forClass(MessageEditedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(WALLET_INTERNAL), eq("/queue/message-edited"), captor.capture());
        assertThat(captor.getValue().isSuccess()).isTrue();
        verify(messageRepository, never()).getDmMessageEditableMeta(any(), any());
    }

    @Test
    void editMessage_telegramUser_deliveredMessage_succeedsByTelegramIdFallback() {
        EditMessageRequest req = editRequest();
        var telegram = org.mockito.Mockito.mock(
                dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal.class);
        when(telegram.getInternalId()).thenReturn(TG_EDITOR_INTERNAL);
        when(telegram.getUserId()).thenReturn(TG_ID);

        Session session = activeSession(TG_EDITOR_INTERNAL, PEER_INTERNAL, TG_ID, 99L);

        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(onlineStatusRepository.isOnline(PEER_INTERNAL)).thenReturn(Mono.just(true));
        when(messageRepository.updateMessageInQueue(
                eq(PEER_INTERNAL), eq(SESSION), eq(MESSAGE_ID),
                eq(TG_EDITOR_INTERNAL), eq(TG_ID),
                eq("cipher"), eq("0123456789abcdef"), any(Instant.class)))
                .thenReturn(Mono.just(false));
        when(messageRepository.getDmMessageEditableMeta(SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(DmMessageEditableMeta.builder()
                        .senderId(TG_ID)
                        .serverTimestamp(Instant.now())
                        .build()));

        messageHandler.editMessage(req, telegram);

        ArgumentCaptor<MessageEditedEvent> captor = ArgumentCaptor.forClass(MessageEditedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(TG_EDITOR_INTERNAL), eq("/queue/message-edited"), captor.capture());
        assertThat(captor.getValue().isSuccess()).isTrue();
    }

    @Test
    void editMessage_walletUser_wrongOwner_sendsNotOwner() {
        EditMessageRequest req = editRequest();
        WalletPrincipal wallet = walletPrincipal(WALLET_INTERNAL);
        Session session = activeSession(WALLET_INTERNAL, PEER_INTERNAL, null, 99L);

        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(onlineStatusRepository.isOnline(PEER_INTERNAL)).thenReturn(Mono.just(true));
        when(messageRepository.updateMessageInQueue(
                eq(PEER_INTERNAL), eq(SESSION), eq(MESSAGE_ID),
                eq(WALLET_INTERNAL), eq(null),
                eq("cipher"), eq("0123456789abcdef"), any(Instant.class)))
                .thenReturn(Mono.just(false));
        when(messageRepository.getDmMessageEditableMeta(SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(DmMessageEditableMeta.builder()
                        .senderInternalId("other-wallet")
                        .serverTimestamp(Instant.now())
                        .build()));

        messageHandler.editMessage(req, wallet);

        ArgumentCaptor<MessageEditedEvent> captor = ArgumentCaptor.forClass(MessageEditedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(WALLET_INTERNAL), eq("/queue/message-edited"), captor.capture());
        assertThat(captor.getValue().isSuccess()).isFalse();
        assertThat(captor.getValue().getErrorCode()).isEqualTo("NOT_OWNER");
    }

    private static EditMessageRequest editRequest() {
        long now = System.currentTimeMillis();
        return EditMessageRequest.builder()
                .sessionId(SESSION)
                .messageId(MESSAGE_ID)
                .encryptedContent("cipher")
                .iv("0123456789abcdef")
                .editedAt(now)
                .originalClientTimestamp(now - 60_000)
                .build();
    }

    private static WalletPrincipal walletPrincipal(String internalId) {
        return new WalletPrincipal(new UnifiedUser(
                internalId, AuthType.WALLET, "Wallet User", null, "0xabc", null));
    }

    private static Session activeSession(
            String initiatorInternal, String responderInternal,
            Long initiatorTg, Long responderTg) {
        return Session.builder()
                .id(SESSION)
                .initiatorInternalId(initiatorInternal)
                .initiatorTelegramId(initiatorTg)
                .responderInternalId(responderInternal)
                .responderTelegramId(responderTg)
                .status(SessionStatus.ACTIVE)
                .build();
    }
}
