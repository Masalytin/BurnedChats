package dev.burnedchats.handler;

import dev.burnedchats.dto.event.MessageDeletedEvent;
import dev.burnedchats.dto.request.DeleteMessageRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.model.DmMessageEditableMeta;
import dev.burnedchats.model.Message;
import dev.burnedchats.model.MessageSenderIndexEntry;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.security.StompAuthInterceptor.WalletPrincipal;
import dev.burnedchats.util.InternalIds;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.FileMessageRelayValidator;
import dev.burnedchats.telegram.BurnedChatsBot;
import dev.burnedchats.telegram.BotMessageService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.user.SimpUser;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MessageHandlerDeleteTest {

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
    private SimpUserRegistry userRegistry;
    @Mock
    private UserIdentityRepository userIdentityRepository;
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
    void deleteMessage_whenUserNotParticipant_sendsNotParticipantError() {
        DeleteMessageRequest req = deleteRequest();
        TelegramPrincipal principal = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(principal.getUserId()).thenReturn(99L);
        when(principal.getInternalId()).thenReturn(InternalIds.forTelegramId(99L));

        Session session = activeSession(
                InternalIds.forTelegramId(1L), InternalIds.forTelegramId(2L), 1L, 2L);
        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));

        messageHandler.deleteMessage(req, principal);

        ArgumentCaptor<MessageDeletedEvent> cap = ArgumentCaptor.forClass(MessageDeletedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(InternalIds.forTelegramId(99L)), eq("/queue/message-deleted"), cap.capture());
        assertThat(cap.getValue().isSuccess()).isFalse();
        assertThat(cap.getValue().getErrorCode()).isEqualTo("NOT_PARTICIPANT");
    }

    @Test
    void deleteMessage_walletUser_deliveredMessage_succeedsBySenderIndexInternalId() {
        DeleteMessageRequest req = deleteRequest();
        WalletPrincipal wallet = walletPrincipal(WALLET_INTERNAL);
        Session session = activeSession(WALLET_INTERNAL, PEER_INTERNAL, null, 99L);

        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(messageRepository.removeMessageFromQueue(PEER_INTERNAL, SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(Optional.empty()));
        when(messageRepository.getMessageSenderIndex(SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(MessageSenderIndexEntry.builder()
                        .senderInternalId(WALLET_INTERNAL)
                        .build()));
        when(messageRepository.getDmMessageEditableMeta(SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(DmMessageEditableMeta.builder()
                        .senderInternalId(WALLET_INTERNAL)
                        .serverTimestamp(Instant.now())
                        .build()));
        when(messageRepository.removeMessageSenderIndex(SESSION, MESSAGE_ID)).thenReturn(Mono.just(1L));
        when(messageRepository.deleteDmMessageEditableMeta(SESSION, MESSAGE_ID)).thenReturn(Mono.just(true));
        when(userRegistry.getUser(PEER_INTERNAL)).thenReturn(org.mockito.Mockito.mock(SimpUser.class));

        messageHandler.deleteMessage(req, wallet);

        ArgumentCaptor<MessageDeletedEvent> captor = ArgumentCaptor.forClass(MessageDeletedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(WALLET_INTERNAL), eq("/queue/message-deleted"), captor.capture());
        assertThat(captor.getValue().isSuccess()).isTrue();
        verify(messageRepository).getDmMessageEditableMeta(SESSION, MESSAGE_ID);
    }

    @Test
    void deleteMessage_walletUser_deliveredMessage_succeedsByMetaWhenLegacyNullIndex() {
        DeleteMessageRequest req = deleteRequest();
        WalletPrincipal wallet = walletPrincipal(WALLET_INTERNAL);
        Session session = activeSession(WALLET_INTERNAL, PEER_INTERNAL, null, 99L);

        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(messageRepository.removeMessageFromQueue(PEER_INTERNAL, SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(Optional.empty()));
        when(messageRepository.getMessageSenderIndex(SESSION, MESSAGE_ID)).thenReturn(Mono.empty());
        when(messageRepository.getDmMessageEditableMeta(SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(DmMessageEditableMeta.builder()
                        .senderInternalId(WALLET_INTERNAL)
                        .serverTimestamp(Instant.now())
                        .build()));
        when(messageRepository.removeMessageSenderIndex(SESSION, MESSAGE_ID)).thenReturn(Mono.just(1L));
        when(messageRepository.deleteDmMessageEditableMeta(SESSION, MESSAGE_ID)).thenReturn(Mono.just(true));
        when(userRegistry.getUser(PEER_INTERNAL)).thenReturn(org.mockito.Mockito.mock(SimpUser.class));

        messageHandler.deleteMessage(req, wallet);

        ArgumentCaptor<MessageDeletedEvent> captor = ArgumentCaptor.forClass(MessageDeletedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(WALLET_INTERNAL), eq("/queue/message-deleted"), captor.capture());
        assertThat(captor.getValue().isSuccess()).isTrue();
    }

    @Test
    void deleteMessage_walletUser_offlineQueue_succeedsBySenderInternalId() {
        DeleteMessageRequest req = deleteRequest();
        WalletPrincipal wallet = walletPrincipal(WALLET_INTERNAL);
        Session session = activeSession(WALLET_INTERNAL, PEER_INTERNAL, null, 99L);
        Message queued = Message.builder()
                .messageId(MESSAGE_ID)
                .sessionId(SESSION)
                .senderInternalId(WALLET_INTERNAL)
                .build();

        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(messageRepository.removeMessageFromQueue(PEER_INTERNAL, SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(Optional.of(queued)));
        when(messageRepository.removeMessageSenderIndex(SESSION, MESSAGE_ID)).thenReturn(Mono.just(1L));
        when(messageRepository.deleteDmMessageEditableMeta(SESSION, MESSAGE_ID)).thenReturn(Mono.just(true));
        when(userRegistry.getUser(PEER_INTERNAL)).thenReturn(null);
        when(messageRepository.queueDeletion(eq(PEER_INTERNAL), eq(SESSION), any())).thenReturn(Mono.just(true));

        messageHandler.deleteMessage(req, wallet);

        ArgumentCaptor<MessageDeletedEvent> captor = ArgumentCaptor.forClass(MessageDeletedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(WALLET_INTERNAL), eq("/queue/message-deleted"), captor.capture());
        assertThat(captor.getValue().isSuccess()).isTrue();
        verify(messageRepository, never()).getMessageSenderIndex(any(), any());
    }

    @Test
    void deleteMessage_telegramUser_deliveredMessage_succeedsByLegacyNumericIndex() {
        DeleteMessageRequest req = deleteRequest();
        TelegramPrincipal telegram = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(telegram.getInternalId()).thenReturn(TG_EDITOR_INTERNAL);
        when(telegram.getUserId()).thenReturn(TG_ID);

        Session session = activeSession(TG_EDITOR_INTERNAL, PEER_INTERNAL, TG_ID, 99L);

        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(messageRepository.removeMessageFromQueue(PEER_INTERNAL, SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(Optional.empty()));
        when(messageRepository.getMessageSenderIndex(SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(MessageSenderIndexEntry.builder().senderId(TG_ID).build()));
        when(messageRepository.getDmMessageEditableMeta(SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(DmMessageEditableMeta.builder()
                        .senderId(TG_ID)
                        .serverTimestamp(Instant.now())
                        .build()));
        when(messageRepository.removeMessageSenderIndex(SESSION, MESSAGE_ID)).thenReturn(Mono.just(1L));
        when(messageRepository.deleteDmMessageEditableMeta(SESSION, MESSAGE_ID)).thenReturn(Mono.just(true));
        when(userRegistry.getUser(PEER_INTERNAL)).thenReturn(org.mockito.Mockito.mock(SimpUser.class));

        messageHandler.deleteMessage(req, telegram);

        ArgumentCaptor<MessageDeletedEvent> captor = ArgumentCaptor.forClass(MessageDeletedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(TG_EDITOR_INTERNAL), eq("/queue/message-deleted"), captor.capture());
        assertThat(captor.getValue().isSuccess()).isTrue();
    }

    @Test
    void deleteMessage_walletUser_wrongOwnerInIndex_sendsNotAllowed() {
        DeleteMessageRequest req = deleteRequest();
        WalletPrincipal wallet = walletPrincipal(WALLET_INTERNAL);
        Session session = activeSession(WALLET_INTERNAL, PEER_INTERNAL, null, 99L);

        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(messageRepository.removeMessageFromQueue(PEER_INTERNAL, SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(Optional.empty()));
        when(messageRepository.getMessageSenderIndex(SESSION, MESSAGE_ID))
                .thenReturn(Mono.just(MessageSenderIndexEntry.builder()
                        .senderInternalId("other-wallet")
                        .build()));

        messageHandler.deleteMessage(req, wallet);

        ArgumentCaptor<MessageDeletedEvent> captor = ArgumentCaptor.forClass(MessageDeletedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(WALLET_INTERNAL), eq("/queue/message-deleted"), captor.capture());
        assertThat(captor.getValue().isSuccess()).isFalse();
        assertThat(captor.getValue().getErrorCode()).isEqualTo("NOT_ALLOWED");
        verify(messageRepository, never()).getDmMessageEditableMeta(any(), any());
    }

    private static DeleteMessageRequest deleteRequest() {
        DeleteMessageRequest req = new DeleteMessageRequest();
        req.setSessionId(SESSION);
        req.setMessageId(MESSAGE_ID);
        return req;
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
