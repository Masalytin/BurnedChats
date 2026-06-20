package dev.burnedchats.handler;

import dev.burnedchats.dto.event.RoomMessageSentEvent;
import dev.burnedchats.dto.request.SendRoomMessageRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.model.Room;
import dev.burnedchats.model.RoomRole;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomMutedRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.FileMessageRelayValidator;
import dev.burnedchats.service.RoomService;
import dev.burnedchats.util.InternalIds;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomMessageHandlerMuteTest {

    private static final String ROOM = "room-1";
    private static final String MEMBER_INTERNAL = InternalIds.forTelegramId(2L);
    private static final String OWNER_INTERNAL = InternalIds.forTelegramId(100L);

    @Mock
    private RoomMembersRepository roomMembersRepository;
    @Mock
    private RoomMessageRepository roomMessageRepository;
    @Mock
    private RoomRepository roomRepository;
    @Mock
    private RoomMutedRepository roomMutedRepository;
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
    private RoomService roomService;

    @InjectMocks
    private RoomMessageHandler roomMessageHandler;

    @Test
    void sendRoomMessage_whenMuted_rejectsWithMutedError() {
        SendRoomMessageRequest req = sendRequest();
        TelegramPrincipal p = memberPrincipal();

        when(roomMembersRepository.isMember(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(true));
        when(roomMutedRepository.isMuted(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(true));

        roomMessageHandler.sendRoomMessage(req, p);

        ArgumentCaptor<RoomMessageSentEvent> cap = ArgumentCaptor.forClass(RoomMessageSentEvent.class);
        verify(stompUserMessenger).convertAndSendToUserPrincipal(
                eq(p), eq("/queue/room-message-sent"), cap.capture());
        assertThat(cap.getValue().isSuccess()).isFalse();
        assertThat(cap.getValue().getError()).isEqualTo("MUTED");
        verify(roomMessageRepository, never()).saveMessage(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void sendRoomMessage_whenReadOnlyAndNotOwner_rejectsWithRoomReadOnlyError() {
        SendRoomMessageRequest req = sendRequest();
        TelegramPrincipal p = memberPrincipal();

        Room readOnlyRoom = Room.builder()
                .id(ROOM)
                .ownerInternalId(OWNER_INTERNAL)
                .ownerTgId(100L)
                .readOnly(true)
                .build();
        when(roomMembersRepository.isMember(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(true));
        when(roomMutedRepository.isMuted(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(false));
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(readOnlyRoom));
        when(roomService.roleOf(readOnlyRoom, MEMBER_INTERNAL)).thenReturn(Mono.just(RoomRole.MEMBER));

        roomMessageHandler.sendRoomMessage(req, p);

        ArgumentCaptor<RoomMessageSentEvent> cap = ArgumentCaptor.forClass(RoomMessageSentEvent.class);
        verify(stompUserMessenger).convertAndSendToUserPrincipal(
                eq(p), eq("/queue/room-message-sent"), cap.capture());
        assertThat(cap.getValue().isSuccess()).isFalse();
        assertThat(cap.getValue().getError()).isEqualTo("ROOM_READ_ONLY");
        verify(roomMessageRepository, never()).saveMessage(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void sendRoomMessage_whenReadOnlyAndAdmin_allowsSend() {
        SendRoomMessageRequest req = sendRequest();
        TelegramPrincipal admin = adminPrincipal();
        String adminInternal = InternalIds.forTelegramId(10L);
        Room readOnlyRoom = Room.builder()
                .id(ROOM)
                .ownerInternalId(OWNER_INTERNAL)
                .ownerTgId(100L)
                .readOnly(true)
                .build();

        when(roomMembersRepository.isMember(ROOM, adminInternal)).thenReturn(Mono.just(true));
        when(roomMutedRepository.isMuted(ROOM, adminInternal)).thenReturn(Mono.just(false));
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(readOnlyRoom));
        when(roomService.roleOf(readOnlyRoom, adminInternal)).thenReturn(Mono.just(RoomRole.ADMIN));

        roomMessageHandler.sendRoomMessage(req, admin);

        verify(roomService).roleOf(readOnlyRoom, adminInternal);
        verify(stompUserMessenger, never()).convertAndSendToUserPrincipal(
                eq(admin), eq("/queue/room-message-sent"),
                org.mockito.ArgumentMatchers.argThat(event ->
                        event instanceof RoomMessageSentEvent sent
                                && "ROOM_READ_ONLY".equals(sent.getError())));
    }

    private static TelegramPrincipal adminPrincipal() {
        String adminInternal = InternalIds.forTelegramId(10L);
        TelegramPrincipal p = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(p.getUserId()).thenReturn(10L);
        when(p.getInternalId()).thenReturn(adminInternal);
        return p;
    }

    private static SendRoomMessageRequest sendRequest() {
        SendRoomMessageRequest req = new SendRoomMessageRequest();
        req.setRoomId(ROOM);
        req.setMessageId("mid-1");
        req.setEncryptedContent("cipher");
        req.setIv("iv");
        req.setTimestamp(System.currentTimeMillis());
        req.setType("text");
        return req;
    }

    private static TelegramPrincipal memberPrincipal() {
        TelegramPrincipal p = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(p.getUserId()).thenReturn(2L);
        when(p.getInternalId()).thenReturn(MEMBER_INTERNAL);
        return p;
    }
}
