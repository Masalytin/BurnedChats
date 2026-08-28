package dev.burnedchats.handler;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.user.SimpUser;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import reactor.core.publisher.Mono;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * IMP-OQR-04: metadata write failures must not abort DM delivery.
 */
@ExtendWith(MockitoExtension.class)
class MessageHandlerDeliveryMetaTest {

    private static final String SESSION = "session-1";
    private static final String MESSAGE_ID = "msg-1";
    private static final String WALLET_INTERNAL = "wallet-uuid-aaa";
    private static final String PEER_INTERNAL = "peer-uuid-bbb";

    @Mock
    private SessionRepository sessionRepository;
    @Mock
    private MessageRepository messageRepository;
    @Mock
    private OnlineStatusRepository onlineStatusRepository;
    @Mock
    private SimpUserRegistry userRegistry;
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

    private ListAppender<ILoggingEvent> logAppender;
    private Logger messageHandlerLogger;

    @BeforeEach
    void attachLogAppender() {
        messageHandlerLogger = (Logger) LoggerFactory.getLogger(MessageHandler.class);
        logAppender = new ListAppender<>();
        logAppender.start();
        messageHandlerLogger.addAppender(logAppender);
    }

    @AfterEach
    void detachLogAppender() {
        messageHandlerLogger.detachAppender(logAppender);
    }

    @Nested
    @DisplayName("online delivery")
    class OnlineDelivery {

        @Test
        void editableMetaFailure_stillDeliversAndAcksDelivered() {
            stubOnlineRelay();
            when(messageRepository.putDmMessageEditableMeta(
                    eq(SESSION), eq(MESSAGE_ID), eq(WALLET_INTERNAL), eq(null),
                    any(Instant.class), eq(null), eq(null)))
                    .thenReturn(Mono.just(false));
            when(messageRepository.putMessageSenderIndex(
                    eq(SESSION), eq(MESSAGE_ID), eq(WALLET_INTERNAL), eq(null)))
                    .thenReturn(Mono.just(true));

            messageHandler.relayMessage(sendRequest(), walletPrincipal());

            assertDeliveredOnline();
            assertNoErrorAck();
            assertWarnLogged("Failed to store editable meta for immediate delivery");
        }

        @Test
        void senderIndexFailure_stillDeliversAndAcksDelivered() {
            stubOnlineRelay();
            when(messageRepository.putDmMessageEditableMeta(
                    eq(SESSION), eq(MESSAGE_ID), eq(WALLET_INTERNAL), eq(null),
                    any(Instant.class), eq(null), eq(null)))
                    .thenReturn(Mono.just(true));
            when(messageRepository.putMessageSenderIndex(
                    eq(SESSION), eq(MESSAGE_ID), eq(WALLET_INTERNAL), eq(null)))
                    .thenReturn(Mono.just(false));

            messageHandler.relayMessage(sendRequest(), walletPrincipal());

            assertDeliveredOnline();
            assertNoErrorAck();
            assertWarnLogged("Failed to store sender index for immediate delivery");
        }
    }

    @Nested
    @DisplayName("offline queue")
    class OfflineQueue {

        @Test
        void editableMetaFailure_stillAcksQueued() {
            stubOfflineQueueSuccess();
            when(messageRepository.putDmMessageEditableMeta(
                    eq(SESSION), eq(MESSAGE_ID), eq(WALLET_INTERNAL), eq(null),
                    any(Instant.class), eq(null), eq(null)))
                    .thenReturn(Mono.just(false));
            when(messageRepository.putMessageSenderIndex(
                    eq(SESSION), eq(MESSAGE_ID), eq(WALLET_INTERNAL), eq(null)))
                    .thenReturn(Mono.just(true));

            messageHandler.relayMessage(sendRequest(), walletPrincipal());

            assertQueuedAck();
            assertNoErrorAck();
            assertWarnLogged("Failed to store editable meta for queued message");
        }

        @Test
        void senderIndexFailure_stillAcksQueued() {
            stubOfflineQueueSuccess();
            when(messageRepository.putDmMessageEditableMeta(
                    eq(SESSION), eq(MESSAGE_ID), eq(WALLET_INTERNAL), eq(null),
                    any(Instant.class), eq(null), eq(null)))
                    .thenReturn(Mono.just(true));
            when(messageRepository.putMessageSenderIndex(
                    eq(SESSION), eq(MESSAGE_ID), eq(WALLET_INTERNAL), eq(null)))
                    .thenReturn(Mono.just(false));

            messageHandler.relayMessage(sendRequest(), walletPrincipal());

            assertQueuedAck();
            assertNoErrorAck();
            assertWarnLogged("Failed to store sender index for queued message");
        }

        @Test
        void queueMessageFailure_stillReturnsQueueFailed() {
            Session session = activeSession();
            when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
            when(sessionRepository.save(session)).thenReturn(Mono.just(true));
            when(userRegistry.getUser(PEER_INTERNAL)).thenReturn(null);
            when(messageRepository.queueMessage(any(Message.class))).thenReturn(Mono.just(false));

            messageHandler.relayMessage(sendRequest(), walletPrincipal());

            ArgumentCaptor<MessageSentEvent> captor = ArgumentCaptor.forClass(MessageSentEvent.class);
            verify(stompUserMessenger).convertAndSendToInternalId(
                    eq(WALLET_INTERNAL), eq("/queue/message-sent"), captor.capture());
            assertThat(captor.getValue().isSuccess()).isFalse();
            assertThat(captor.getValue().getError()).isEqualTo("QUEUE_FAILED");
            verify(messageRepository, never()).putDmMessageEditableMeta(
                    any(), any(), any(), any(), any(), any(), any());
        }
    }

    private void stubOnlineRelay() {
        Session session = activeSession();
        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(sessionRepository.save(session)).thenReturn(Mono.just(true));
        when(userRegistry.getUser(PEER_INTERNAL)).thenReturn(org.mockito.Mockito.mock(SimpUser.class));
    }

    private void stubOfflineQueueSuccess() {
        Session session = activeSession();
        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(sessionRepository.save(session)).thenReturn(Mono.just(true));
        when(userRegistry.getUser(PEER_INTERNAL)).thenReturn(null);
        when(messageRepository.queueMessage(any(Message.class))).thenReturn(Mono.just(true));
        when(botMessages.getForUser(eq("bot.notify.newMessage"), eq(99L)))
                .thenReturn(Mono.empty());
    }

    private void assertDeliveredOnline() {
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(PEER_INTERNAL), eq("/queue/new-message"), any(NewMessageEvent.class));
        ArgumentCaptor<MessageSentEvent> captor = ArgumentCaptor.forClass(MessageSentEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(WALLET_INTERNAL), eq("/queue/message-sent"), captor.capture());
        MessageSentEvent sent = captor.getValue();
        assertThat(sent.isSuccess()).isTrue();
        assertThat(sent.isDelivered()).isTrue();
        assertThat(sent.isQueued()).isFalse();
        assertThat(sent.getError()).isNull();
    }

    private void assertQueuedAck() {
        ArgumentCaptor<MessageSentEvent> captor = ArgumentCaptor.forClass(MessageSentEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(WALLET_INTERNAL), eq("/queue/message-sent"), captor.capture());
        MessageSentEvent sent = captor.getValue();
        assertThat(sent.isSuccess()).isTrue();
        assertThat(sent.isQueued()).isTrue();
        assertThat(sent.isDelivered()).isFalse();
        assertThat(sent.getError()).isNull();
    }

    private void assertNoErrorAck() {
        ArgumentCaptor<MessageSentEvent> captor = ArgumentCaptor.forClass(MessageSentEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(WALLET_INTERNAL), eq("/queue/message-sent"), captor.capture());
        assertThat(captor.getValue().getError()).isNotEqualTo("INTERNAL_ERROR");
    }

    private void assertWarnLogged(String messageFragment) {
        assertThat(logAppender.list)
                .anyMatch(event -> event.getLevel() == Level.WARN
                        && event.getFormattedMessage().contains(messageFragment));
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
                WALLET_INTERNAL, AuthType.WALLET, "Wallet User", null, "0xabc", null));
    }

    private static Session activeSession() {
        return Session.builder()
                .id(SESSION)
                .initiatorInternalId(WALLET_INTERNAL)
                .initiatorTelegramId(null)
                .responderInternalId(PEER_INTERNAL)
                .responderTelegramId(99L)
                .status(SessionStatus.ACTIVE)
                .build();
    }
}
