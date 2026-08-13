package dev.burnedchats.handler;

import dev.burnedchats.dto.event.RoomLeftEvent;
import dev.burnedchats.dto.event.RoomMemberLeftEvent;
import dev.burnedchats.dto.event.RoomMembershipEvent;
import dev.burnedchats.dto.request.LeaveRoomRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Room;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomPresenceRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.InviteTokenService;
import dev.burnedchats.service.RoomJoinService;
import dev.burnedchats.service.RoomService;
import dev.burnedchats.service.RoomTopicSubscriptionService;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomHandlerLeaveTest {

    private static final String ROOM = "room-leave-1";
    private static final String OWNER_INTERNAL = InternalIds.forTelegramId(1L);
    private static final String MEMBER_INTERNAL = InternalIds.forTelegramId(2L);

    @Mock private RoomService roomService;
    @Mock private InviteTokenService inviteTokenService;
    @Mock private RoomJoinService roomJoinService;
    @Mock private FileBurnService fileBurnService;
    @Mock private StompUserMessenger stompUserMessenger;
    @Mock private UserIdentityRepository userIdentityRepository;
    @Mock private RoomKeysRepository roomKeysRepository;
    @Mock private RoomMemberPublicKeyRepository memberPublicKeyRepository;
    @Mock private RoomRepository roomRepository;
    @Mock private RoomMembersRepository roomMembersRepository;
    @Mock private RoomPresenceRepository roomPresenceRepository;
    @Mock private RoomJoinRequestRepository roomJoinRequestRepository;
    @Mock private InviteTokenRepository inviteTokenRepository;
    @Mock private RoomMessageRepository roomMessageRepository;
    @Mock private RoomTopicSubscriptionService roomTopicSubscriptionService;
    @Mock private OnlineStatusRepository onlineStatusRepository;
    @Mock private SimpMessagingTemplate messagingTemplate;

    @InjectMocks
    private RoomHandler roomHandler;

    @Test
    void leaveRoom_whenOwner_doesNotUnsubscribe() {
        LeaveRoomRequest request = leaveRequest();
        TelegramPrincipal owner = ownerPrincipal();
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));

        roomHandler.leaveRoom(request, owner);

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verify(roomTopicSubscriptionService, never()).unsubscribeUserFromRoomTopic(anyString(), anyString());
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(OWNER_INTERNAL), eq("/queue/room-left"), any(RoomLeftEvent.class));
    }

    @Test
    void leaveRoom_whenNotMember_doesNotUnsubscribe() {
        LeaveRoomRequest request = leaveRequest();
        TelegramPrincipal member = memberPrincipal();
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));
        when(roomMembersRepository.isMember(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(false));

        roomHandler.leaveRoom(request, member);

        verify(roomMembersRepository, never()).remove(eq(ROOM), eq(MEMBER_INTERNAL));
        verify(roomTopicSubscriptionService, never()).unsubscribeUserFromRoomTopic(anyString(), anyString());
    }

    @Test
    void leaveRoom_whenSuccess_unsubscribesFromRoomTopic() {
        LeaveRoomRequest request = leaveRequest();
        TelegramPrincipal member = memberPrincipal();
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));
        when(roomMembersRepository.isMember(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(true));
        when(roomMembersRepository.remove(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(1L));
        when(memberPublicKeyRepository.remove(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.empty());
        when(roomMembersRepository.getMembers(ROOM))
                .thenReturn(Flux.fromIterable(List.of(OWNER_INTERNAL)));
        when(userIdentityRepository.findById(MEMBER_INTERNAL)).thenReturn(Mono.empty());

        roomHandler.leaveRoom(request, member);

        verify(roomMembersRepository).remove(ROOM, MEMBER_INTERNAL);
        verify(roomTopicSubscriptionService).unsubscribeUserFromRoomTopic(ROOM, MEMBER_INTERNAL);
    }

    @Test
    void leaveRoom_whenSuccess_sendsQueueLeftAndTopicLeft_afterUnsubscribe() {
        LeaveRoomRequest request = leaveRequest();
        TelegramPrincipal member = memberPrincipal();
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));
        when(roomMembersRepository.isMember(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(true));
        when(roomMembersRepository.remove(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(1L));
        when(memberPublicKeyRepository.remove(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.empty());
        when(roomMembersRepository.getMembers(ROOM))
                .thenReturn(Flux.fromIterable(List.of(OWNER_INTERNAL)));
        when(userIdentityRepository.findById(MEMBER_INTERNAL)).thenReturn(Mono.empty());

        roomHandler.leaveRoom(request, member);

        verify(stompUserMessenger, timeout(1000)).convertAndSendToInternalId(
                eq(OWNER_INTERNAL), eq("/queue/room-member-left"), any(RoomMemberLeftEvent.class));

        ArgumentCaptor<RoomMembershipEvent> topicCaptor = ArgumentCaptor.forClass(RoomMembershipEvent.class);
        verify(messagingTemplate, timeout(1000)).convertAndSend(eq("/topic/room/" + ROOM), topicCaptor.capture());
        RoomMembershipEvent topicEvent = topicCaptor.getValue();
        assertThat(topicEvent.getEventType()).isEqualTo(RoomMembershipEvent.LEFT);
        assertThat(topicEvent.getRoomId()).isEqualTo(ROOM);
        assertThat(topicEvent.getMemberInternalId()).isEqualTo(MEMBER_INTERNAL);
        assertThat(topicEvent.getDisplayName()).isNull();

        InOrder order = inOrder(roomTopicSubscriptionService, messagingTemplate);
        order.verify(roomTopicSubscriptionService).unsubscribeUserFromRoomTopic(ROOM, MEMBER_INTERNAL);
        order.verify(messagingTemplate).convertAndSend(eq("/topic/room/" + ROOM), any(RoomMembershipEvent.class));
    }

    private static LeaveRoomRequest leaveRequest() {
        return LeaveRoomRequest.builder().roomId(ROOM).build();
    }

    private static Room ownerRoom() {
        return Room.builder()
                .id(ROOM)
                .ownerInternalId(OWNER_INTERNAL)
                .joinMode(Room.JoinMode.BY_REQUEST)
                .build();
    }

    private static TelegramPrincipal ownerPrincipal() {
        return principalFor(OWNER_INTERNAL);
    }

    private static TelegramPrincipal memberPrincipal() {
        return principalFor(MEMBER_INTERNAL);
    }

    private static TelegramPrincipal principalFor(String internalId) {
        TelegramPrincipal principal = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(principal.getInternalId()).thenReturn(internalId);
        return principal;
    }
}
