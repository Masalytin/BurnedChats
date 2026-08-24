package dev.burnedchats.handler;

import dev.burnedchats.dto.event.RoomMessageEditedEvent;
import dev.burnedchats.dto.request.EditRoomMessageRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.model.RoomMessage;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.RoomTelegramNotifyService;
import dev.burnedchats.service.FileMessageRelayValidator;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import reactor.core.publisher.Mono;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomMessageHandlerEditTest {

    private static final String ROOM = "room-1";
    private static final String MESSAGE_ID = "mid-1";
    private static final String EDITOR_INTERNAL = InternalIds.forTelegramId(9L);
    private static final String SENDER_INTERNAL = InternalIds.forTelegramId(2L);

    @Mock
    private RoomMembersRepository roomMembersRepository;
    @Mock
    private RoomMessageRepository roomMessageRepository;
    @Mock
    private RoomRepository roomRepository;
    @Mock
    private UserIdentityRepository userIdentityRepository;
    @Mock
    private SimpMessagingTemplate messagingTemplate;
    @Mock
    private FileMessageRelayValidator fileMessageRelayValidator;
    @Mock
    private FileBurnService fileBurnService;
    @Mock
    private OfflineQueueMetrics offlineQueueMetrics;
    @Mock
    private StompUserMessenger stompUserMessenger;
    @Mock
    private RoomTelegramNotifyService roomTelegramNotifyService;

    @InjectMocks
    private RoomMessageHandler roomMessageHandler;

    @Test
    void editRoomMessage_whenUpdateSucceedsAndTtlExtensionFails_doesNotSendEditError() {
        EditRoomMessageRequest req = editRequest();
        TelegramPrincipal principal = editorPrincipal();
        RoomMessage updated = updatedMessage();

        when(roomMembersRepository.isMember(ROOM, EDITOR_INTERNAL)).thenReturn(Mono.just(true));
        when(roomMessageRepository.updateMessage(
                eq(ROOM),
                eq(MESSAGE_ID),
                eq(EDITOR_INTERNAL),
                eq("cipher"),
                eq("0123456789abcdef"),
                any(Instant.class)))
                .thenReturn(Mono.just(updated));
        when(userIdentityRepository.findById(SENDER_INTERNAL))
                .thenReturn(Mono.just(new UnifiedUser(
                        SENDER_INTERNAL,
                        AuthType.TELEGRAM,
                        "Alice",
                        2L,
                        null,
                        null)));
        when(roomRepository.extendTtl(eq(ROOM), eq(RoomRepository.DEFAULT_TTL)))
                .thenReturn(Mono.error(new RuntimeException("ttl failed")));

        roomMessageHandler.editRoomMessage(req, principal);

        ArgumentCaptor<RoomMessageEditedEvent> broadcastCaptor =
                ArgumentCaptor.forClass(RoomMessageEditedEvent.class);
        verify(messagingTemplate).convertAndSend(eq("/topic/room/" + ROOM), broadcastCaptor.capture());
        assertThat(broadcastCaptor.getValue().isSuccess()).isTrue();
        assertThat(broadcastCaptor.getValue().getMessageId()).isEqualTo(MESSAGE_ID);

        verify(stompUserMessenger, never()).convertAndSendToUserPrincipal(
                eq(principal), eq("/queue/room-message-edited"), any());
    }

    @Test
    void editRoomMessage_whenDisplayNameMissing_broadcastsSuccessWithFallback() {
        EditRoomMessageRequest req = editRequest();
        TelegramPrincipal principal = editorPrincipal();
        RoomMessage updated = updatedMessage();

        when(roomMembersRepository.isMember(ROOM, EDITOR_INTERNAL)).thenReturn(Mono.just(true));
        when(roomMessageRepository.updateMessage(
                eq(ROOM),
                eq(MESSAGE_ID),
                eq(EDITOR_INTERNAL),
                eq("cipher"),
                eq("0123456789abcdef"),
                any(Instant.class)))
                .thenReturn(Mono.just(updated));
        when(userIdentityRepository.findById(SENDER_INTERNAL)).thenReturn(Mono.empty());
        when(roomRepository.extendTtl(eq(ROOM), eq(RoomRepository.DEFAULT_TTL)))
                .thenReturn(Mono.just(true));

        roomMessageHandler.editRoomMessage(req, principal);

        ArgumentCaptor<RoomMessageEditedEvent> broadcastCaptor =
                ArgumentCaptor.forClass(RoomMessageEditedEvent.class);
        verify(messagingTemplate).convertAndSend(eq("/topic/room/" + ROOM), broadcastCaptor.capture());
        assertThat(broadcastCaptor.getValue().isSuccess()).isTrue();
        assertThat(broadcastCaptor.getValue().getSenderName()).isEqualTo("User 2");

        verify(stompUserMessenger, never()).convertAndSendToUserPrincipal(
                eq(principal), eq("/queue/room-message-edited"), any());
    }

    @Test
    void editRoomMessage_whenUpdateReturnsEmpty_sendsNotEditable() {
        EditRoomMessageRequest req = editRequest();
        TelegramPrincipal principal = editorPrincipal();

        when(roomMembersRepository.isMember(ROOM, EDITOR_INTERNAL)).thenReturn(Mono.just(true));
        when(roomMessageRepository.updateMessage(
                eq(ROOM),
                eq(MESSAGE_ID),
                eq(EDITOR_INTERNAL),
                eq("cipher"),
                eq("0123456789abcdef"),
                any(Instant.class)))
                .thenReturn(Mono.empty());

        roomMessageHandler.editRoomMessage(req, principal);

        ArgumentCaptor<RoomMessageEditedEvent> errorCaptor = ArgumentCaptor.forClass(RoomMessageEditedEvent.class);
        verify(stompUserMessenger).convertAndSendToUserPrincipal(
                eq(principal), eq("/queue/room-message-edited"), errorCaptor.capture());
        assertThat(errorCaptor.getValue().isSuccess()).isFalse();
        assertThat(errorCaptor.getValue().getErrorCode()).isEqualTo("NOT_EDITABLE");

        verify(messagingTemplate, never()).convertAndSend(
                eq("/topic/room/" + ROOM), any(RoomMessageEditedEvent.class));
    }

    private static EditRoomMessageRequest editRequest() {
        long now = System.currentTimeMillis();
        EditRoomMessageRequest req = new EditRoomMessageRequest();
        req.setRoomId(ROOM);
        req.setMessageId(MESSAGE_ID);
        req.setEncryptedContent("cipher");
        req.setIv("0123456789abcdef");
        req.setEditedAt(now);
        req.setOriginalClientTimestamp(now - 1_000L);
        return req;
    }

    private static TelegramPrincipal editorPrincipal() {
        TelegramPrincipal principal = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(principal.getUserId()).thenReturn(9L);
        when(principal.getInternalId()).thenReturn(EDITOR_INTERNAL);
        return principal;
    }

    private static RoomMessage updatedMessage() {
        return RoomMessage.builder()
                .messageId(MESSAGE_ID)
                .roomId(ROOM)
                .senderInternalId(SENDER_INTERNAL)
                .senderTgId(2L)
                .encryptedContent("cipher")
                .iv("0123456789abcdef")
                .editedAt(Instant.now())
                .type("text")
                .build();
    }
}
