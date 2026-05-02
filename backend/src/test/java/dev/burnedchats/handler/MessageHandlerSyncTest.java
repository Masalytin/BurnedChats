package dev.burnedchats.handler;

import dev.burnedchats.dto.event.SyncMessagesEvent;
import dev.burnedchats.dto.request.SyncMessagesRequest;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.model.Message;
import dev.burnedchats.model.MessageDeletion;
import dev.burnedchats.model.MessageEdit;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
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
import org.springframework.messaging.simp.SimpMessagingTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MessageHandlerSyncTest {

    private static final String SESSION_ID = "s-sync-1";
    private static final long USER_A = 1001L;
    private static final long USER_B = 1002L;

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
    void syncMessages_offlineTombstoneEditAndDelete_sendsOneEventAndClearsQueues() throws Exception {
        SyncMessagesRequest request = new SyncMessagesRequest(SESSION_ID);
        Session session = offlineSyncSession();
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(session));
        stubOfflineQueues();
        TelegramPrincipal principal = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(principal.getUserId()).thenReturn(USER_A);

        messageHandler.syncMessages(request, principal);

        Thread.sleep(300);

        ArgumentCaptor<SyncMessagesEvent> eventCap = ArgumentCaptor.forClass(SyncMessagesEvent.class);
        verify(messagingTemplate).convertAndSendToUser(eq("1001"), eq("/queue/sync-messages"), eventCap.capture());
        SyncMessagesEvent ev = eventCap.getValue();
        assertThat(ev.isSuccess()).isTrue();
        assertThat(ev.getSessionId()).isEqualTo(SESSION_ID);
        assertThat(ev.getMessages()).hasSize(1);
        assertThat(ev.getEdits()).hasSize(1);
        assertThat(ev.getEdits().get(0).getMessageId()).isEqualTo("m-tomb");
        assertThat(ev.getDeletedIds()).containsExactly("m-gone");

        verify(messageRepository).deleteMessages(USER_A, SESSION_ID);
        verify(messageRepository).deleteEdits(USER_A, SESSION_ID);
        verify(messageRepository).deleteDeletions(USER_A, SESSION_ID);
    }

    private Session offlineSyncSession() {
        return Session.builder()
                .id(SESSION_ID)
                .initiatorInternalId(InternalIds.forTelegramId(USER_A))
                .initiatorTelegramId(USER_A)
                .responderInternalId(InternalIds.forTelegramId(USER_B))
                .responderTelegramId(USER_B)
                .status(SessionStatus.ACTIVE)
                .build();
    }

    private void stubOfflineQueues() {
        Message offlineDm = Message.builder()
                .messageId("m-offline")
                .sessionId(SESSION_ID)
                .senderId(USER_B)
                .recipientId(USER_A)
                .encryptedContent("c1")
                .iv("i1")
                .clientTimestamp(1L)
                .serverTimestamp(Instant.parse("2025-01-01T12:00:00Z"))
                .type("text")
                .build();

        MessageEdit tombstoneEdit = MessageEdit.builder()
                .messageId("m-tomb")
                .sessionId(SESSION_ID)
                .senderId(USER_B)
                .encryptedContent("c2")
                .iv("i2")
                .editedAt(Instant.parse("2025-01-01T12:10:00Z"))
                .build();

        MessageDeletion tombstoneDelete = MessageDeletion.builder()
                .messageId("m-gone")
                .deletedByTgId(USER_B)
                .build();

        when(messageRepository.getPendingMessages(USER_A, SESSION_ID)).thenReturn(Flux.just(offlineDm));
        when(messageRepository.getPendingEdits(USER_A, SESSION_ID)).thenReturn(Flux.just(tombstoneEdit));
        when(messageRepository.getPendingDeletions(USER_A, SESSION_ID))
                .thenReturn(Flux.just(tombstoneDelete));

        when(messageRepository.deleteMessages(USER_A, SESSION_ID)).thenReturn(Mono.just(1L));
        when(messageRepository.deleteEdits(USER_A, SESSION_ID)).thenReturn(Mono.just(1L));
        when(messageRepository.deleteDeletions(USER_A, SESSION_ID)).thenReturn(Mono.just(1L));
    }

    @Test
    void syncMessages_whenMessageBothEditedAndDeleted_omitsEditFromEvent() throws Exception {
        SyncMessagesRequest request = new SyncMessagesRequest(SESSION_ID);

        Session session = Session.builder()
                .id(SESSION_ID)
                .initiatorInternalId(InternalIds.forTelegramId(USER_A))
                .initiatorTelegramId(USER_A)
                .responderInternalId(InternalIds.forTelegramId(USER_B))
                .responderTelegramId(USER_B)
                .status(SessionStatus.ACTIVE)
                .build();
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Mono.just(session));

        MessageEdit sameIdEdit = MessageEdit.builder()
                .messageId("m-both")
                .sessionId(SESSION_ID)
                .senderId(USER_B)
                .encryptedContent("cx")
                .iv("ix")
                .editedAt(Instant.now())
                .build();

        MessageDeletion deletion = MessageDeletion.builder()
                .messageId("m-both")
                .deletedByTgId(USER_B)
                .build();

        when(messageRepository.getPendingMessages(USER_A, SESSION_ID)).thenReturn(Flux.empty());
        when(messageRepository.getPendingEdits(USER_A, SESSION_ID)).thenReturn(Flux.just(sameIdEdit));
        when(messageRepository.getPendingDeletions(USER_A, SESSION_ID)).thenReturn(Flux.just(deletion));

        when(messageRepository.deleteEdits(USER_A, SESSION_ID)).thenReturn(Mono.just(1L));
        when(messageRepository.deleteDeletions(USER_A, SESSION_ID)).thenReturn(Mono.just(1L));

        TelegramPrincipal principal = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(principal.getUserId()).thenReturn(USER_A);

        messageHandler.syncMessages(request, principal);

        Thread.sleep(300);

        ArgumentCaptor<SyncMessagesEvent> eventCap = ArgumentCaptor.forClass(SyncMessagesEvent.class);
        verify(messagingTemplate).convertAndSendToUser(eq("1001"), eq("/queue/sync-messages"), eventCap.capture());
        assertThat(eventCap.getValue().getEdits()).isEmpty();
        assertThat(eventCap.getValue().getDeletedIds()).containsExactly("m-both");
    }
}
