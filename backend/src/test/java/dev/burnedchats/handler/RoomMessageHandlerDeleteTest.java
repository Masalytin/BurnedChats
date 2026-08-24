package dev.burnedchats.handler;

import dev.burnedchats.dto.event.RoomMessageDeletedEvent;
import dev.burnedchats.dto.request.DeleteRoomMessageRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.model.RoomMessage;
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

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomMessageHandlerDeleteTest {

    private static final String ROOM = "room-1";
    private static final String ACTOR_INTERNAL = InternalIds.forTelegramId(9L);
    private static final String OWNER_INTERNAL = InternalIds.forTelegramId(100L);
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
    void deleteRoomMessage_whenNeitherOwnerNorSender_sendsNotAllowed() {
        DeleteRoomMessageRequest req = new DeleteRoomMessageRequest();
        req.setRoomId(ROOM);
        req.setMessageId("mid");

        TelegramPrincipal p = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(p.getUserId()).thenReturn(9L);
        when(p.getInternalId()).thenReturn(ACTOR_INTERNAL);

        when(roomMembersRepository.isMember(ROOM, ACTOR_INTERNAL)).thenReturn(Mono.just(true));
        when(roomRepository.findById(ROOM))
                .thenReturn(Mono.just(dev.burnedchats.model.Room.builder()
                        .id(ROOM)
                        .ownerInternalId(OWNER_INTERNAL)
                        .ownerTgId(100L)
                        .build()));
        when(roomMessageRepository.findRoomMessageById(ROOM, "mid"))
                .thenReturn(Mono.just(Optional.of(
                        RoomMessage.builder()
                                .messageId("mid")
                                .roomId(ROOM)
                                .senderInternalId(SENDER_INTERNAL)
                                .senderTgId(2L)
                                .type("text")
                                .build())));

        roomMessageHandler.deleteRoomMessage(req, p);

        ArgumentCaptor<RoomMessageDeletedEvent> cap = ArgumentCaptor.forClass(RoomMessageDeletedEvent.class);
        verify(stompUserMessenger).convertAndSendToUserPrincipal(
                eq(p), eq("/queue/room-message-deleted"), cap.capture());
        assertThat(cap.getValue().isSuccess()).isFalse();
        assertThat(cap.getValue().getErrorCode()).isEqualTo("NOT_ALLOWED");
    }
}
