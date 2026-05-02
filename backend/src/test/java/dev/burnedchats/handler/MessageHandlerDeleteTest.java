package dev.burnedchats.handler;

import dev.burnedchats.dto.event.MessageDeletedEvent;
import dev.burnedchats.dto.request.DeleteMessageRequest;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
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
import org.springframework.messaging.simp.SimpMessagingTemplate;
import reactor.core.publisher.Mono;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MessageHandlerDeleteTest {

    @Mock
    private SessionRepository sessionRepository;
    @Mock
    private MessageRepository messageRepository;
    @Mock
    private OnlineStatusRepository onlineStatusRepository;
    @Mock
    private SimpMessagingTemplate messagingTemplate;
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
        DeleteMessageRequest req = new DeleteMessageRequest();
        req.setSessionId("s1");
        req.setMessageId("m1");

        TelegramPrincipal principal = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(principal.getUserId()).thenReturn(99L);

        Session session = Session.builder()
                .id("s1")
                .initiatorInternalId(InternalIds.forTelegramId(1L))
                .initiatorTelegramId(1L)
                .responderInternalId(InternalIds.forTelegramId(2L))
                .responderTelegramId(2L)
                .status(SessionStatus.ACTIVE)
                .build();
        when(sessionRepository.findById("s1")).thenReturn(Mono.just(session));

        messageHandler.deleteMessage(req, principal);

        ArgumentCaptor<MessageDeletedEvent> cap = ArgumentCaptor.forClass(MessageDeletedEvent.class);
        verify(messagingTemplate).convertAndSendToUser(eq("99"), eq("/queue/message-deleted"), cap.capture());
        assertThat(cap.getValue().isSuccess()).isFalse();
        assertThat(cap.getValue().getErrorCode()).isEqualTo("NOT_PARTICIPANT");
    }
}
