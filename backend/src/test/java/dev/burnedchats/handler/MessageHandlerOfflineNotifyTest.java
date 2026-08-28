package dev.burnedchats.handler;

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
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import reactor.core.publisher.Mono;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * IMP-TGUX-03: offline Telegram notifications must pass dm_{sessionId} as startapp param.
 */
@ExtendWith(MockitoExtension.class)
class MessageHandlerOfflineNotifyTest {

    private static final String SESSION = "session-deep-1";
    private static final String MESSAGE_ID = "msg-1";
    private static final String WALLET_INTERNAL = "wallet-uuid-aaa";
    private static final String PEER_INTERNAL = "peer-uuid-bbb";
    private static final long PEER_TG = 99L;

    @Mock private SessionRepository sessionRepository;
    @Mock private MessageRepository messageRepository;
    @Mock private OnlineStatusRepository onlineStatusRepository;
    @Mock private SimpUserRegistry userRegistry;
    @Mock private StompUserMessenger stompUserMessenger;
    @Mock private BurnedChatsBot telegramBot;
    @Mock private BotMessageService botMessages;
    @Mock private FileMessageRelayValidator fileMessageRelayValidator;
    @Mock private FileBurnService fileBurnService;
    @Mock private OfflineQueueMetrics offlineQueueMetrics;

    @InjectMocks
    private MessageHandler messageHandler;

    @Test
    @DisplayName("offline queue notify passes dm_ prefixed session id")
    void offlineNotify_passesDmPrefixedSessionId() {
        Session session = Session.builder()
                .id(SESSION)
                .initiatorInternalId(WALLET_INTERNAL)
                .initiatorTelegramId(null)
                .responderInternalId(PEER_INTERNAL)
                .responderTelegramId(PEER_TG)
                .status(SessionStatus.ACTIVE)
                .build();
        when(sessionRepository.findById(SESSION)).thenReturn(Mono.just(session));
        when(sessionRepository.save(session)).thenReturn(Mono.just(true));
        when(userRegistry.getUser(PEER_INTERNAL)).thenReturn(null);
        when(messageRepository.queueMessage(any(Message.class))).thenReturn(Mono.just(true));
        when(messageRepository.putDmMessageEditableMeta(
                any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(Mono.just(true));
        when(messageRepository.putMessageSenderIndex(any(), any(), any(), any()))
                .thenReturn(Mono.just(true));
        when(botMessages.getForUser(eq("bot.notify.newMessage"), eq(PEER_TG)))
                .thenReturn(Mono.just("You have a new encrypted message"));
        when(telegramBot.sendNotificationWithButton(eq(PEER_TG), any(), any()))
                .thenReturn(true);

        messageHandler.relayMessage(sendRequest(), walletPrincipal());

        verify(telegramBot).sendNotificationWithButton(
                eq(PEER_TG),
                eq("You have a new encrypted message"),
                eq("dm_" + SESSION));
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
}
