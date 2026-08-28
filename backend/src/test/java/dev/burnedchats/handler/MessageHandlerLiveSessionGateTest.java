package dev.burnedchats.handler;

import dev.burnedchats.dto.event.MessageSentEvent;
import dev.burnedchats.dto.event.NewMessageEvent;
import dev.burnedchats.dto.request.SendMessageRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.model.Message;
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
import dev.burnedchats.telegram.BotMessageService;
import dev.burnedchats.telegram.BurnedChatsBot;
import org.junit.jupiter.api.DisplayName;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * IMP-DMRD-01: DM immediate delivery is gated on a live STOMP session
 * ({@link SimpUserRegistry}), not Redis {@code online:*} TTL.
 */
@ExtendWith(MockitoExtension.class)
class MessageHandlerLiveSessionGateTest {

    private static final String SESSION = "session-ghost-1";
    private static final String MESSAGE_ID = "msg-ghost-1";
    private static final String SENDER_INTERNAL = "sender-uuid-aaa";
    private static final String PEER_INTERNAL = "peer-uuid-bbb";
    private static final long PEER_TG = 99L;

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
    @Mock
    private SimpUserRegistry userRegistry;

    @InjectMocks
    private MessageHandler messageHandler;

    @Test
    @DisplayName("Redis online + no SimpUser → queue, not immediate; sender gets queued ack")
    void relayMessage_redisOnlineButNoSimpUser_queuesAndAcksQueued() {
        stubActiveSession();
        lenient().when(onlineStatusRepository.isOnline(PEER_INTERNAL)).thenReturn(Mono.just(true));
        lenient().when(userRegistry.getUser(PEER_INTERNAL)).thenReturn(null);
        stubSuccessfulQueue();
        when(botMessages.getForUser(eq("bot.notify.newMessage"), eq(PEER_TG)))
                .thenReturn(Mono.just("You have a new encrypted message"));
        when(telegramBot.sendNotificationWithButton(eq(PEER_TG), any(), any()))
                .thenReturn(true);

        messageHandler.relayMessage(sendRequest(), walletPrincipal());

        verify(messageRepository).queueMessage(any(Message.class));
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(PEER_INTERNAL), eq("/queue/new-message"), any(NewMessageEvent.class));

        ArgumentCaptor<MessageSentEvent> sent = ArgumentCaptor.forClass(MessageSentEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(SENDER_INTERNAL), eq("/queue/message-sent"), sent.capture());
        assertThat(sent.getValue().isSuccess()).isTrue();
        assertThat(sent.getValue().isQueued()).isTrue();
        assertThat(sent.getValue().isDelivered()).isFalse();

        verify(telegramBot).sendNotificationWithButton(
                eq(PEER_TG), eq("You have a new encrypted message"), eq("dm_" + SESSION));
    }

    @Test
    @DisplayName("live SimpUser → immediate new-message even if Redis online is false")
    void relayMessage_liveStompRecipient_deliversImmediately() {
        stubActiveSession();
        lenient().when(onlineStatusRepository.isOnline(PEER_INTERNAL)).thenReturn(Mono.just(false));
        lenient().when(userRegistry.getUser(PEER_INTERNAL)).thenReturn(mock(SimpUser.class));
        when(messageRepository.putDmMessageEditableMeta(
                eq(SESSION), eq(MESSAGE_ID), eq(SENDER_INTERNAL), eq(null),
                any(Instant.class), eq(null), eq(null)))
                .thenReturn(Mono.just(true));
        when(messageRepository.putMessageSenderIndex(
                eq(SESSION), eq(MESSAGE_ID), eq(SENDER_INTERNAL), eq(null)))
                .thenReturn(Mono.just(true));

        messageHandler.relayMessage(sendRequest(), walletPrincipal());

        verify(messageRepository, never()).queueMessage(any());
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(PEER_INTERNAL), eq("/queue/new-message"), any(NewMessageEvent.class));

        ArgumentCaptor<MessageSentEvent> sent = ArgumentCaptor.forClass(MessageSentEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(SENDER_INTERNAL), eq("/queue/message-sent"), sent.capture());
        assertThat(sent.getValue().isSuccess()).isTrue();
        assertThat(sent.getValue().isDelivered()).isTrue();
        assertThat(sent.getValue().isQueued()).isFalse();
    }

    private void stubActiveSession() {
        Session session = Session.builder()
                .id(SESSION)
                .initiatorInternalId(SENDER_INTERNAL)
                .initiatorTelegramId(null)
                .responderInternalId(PEER_INTERNAL)
                .responderTelegramId(PEER_TG)
                .status(SessionStatus.ACTIVE)
                .build();
        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(sessionRepository.save(session)).thenReturn(Mono.just(true));
    }

    private void stubSuccessfulQueue() {
        when(messageRepository.queueMessage(any(Message.class))).thenReturn(Mono.just(true));
        when(messageRepository.putDmMessageEditableMeta(
                any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(Mono.just(true));
        when(messageRepository.putMessageSenderIndex(any(), any(), any(), any()))
                .thenReturn(Mono.just(true));
    }

    private static SendMessageRequest sendRequest() {
        return SendMessageRequest.builder()
                .sessionId(SESSION)
                .messageId(MESSAGE_ID)
                .encryptedContent("cipher")
                .iv("0123456789abcdef")
                .timestamp(System.currentTimeMillis())
                .type("text")
                .build();
    }

    private static WalletPrincipal walletPrincipal() {
        return new WalletPrincipal(new UnifiedUser(
                SENDER_INTERNAL, AuthType.WALLET, "Wallet User", null, "0xabc", null));
    }
}
