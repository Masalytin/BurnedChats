package dev.burnedchats.handler;

import dev.burnedchats.dto.event.RoomMembershipEvent;
import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.dto.request.RequestJoinRoomRequest;
import dev.burnedchats.dto.request.RoomJoinDecisionRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Room;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.RoomBansRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomMutedRepository;
import dev.burnedchats.repository.RoomPresenceRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.RoomRolesRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.security.TelegramInitData;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.InviteTokenService;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.RoomJoinService;
import dev.burnedchats.service.RoomService;
import dev.burnedchats.service.RoomTopicSubscriptionService;
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
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomHandlerMembershipBroadcastTest {

    private static final String ROOM = "room-membership-1";
    private static final String OWNER_INTERNAL = InternalIds.forTelegramId(1L);
    private static final String JOINER_INTERNAL = InternalIds.forTelegramId(2L);
    private static final String TOPIC = "/topic/room/" + ROOM;
    private static final String INVITE_TOKEN = "a".repeat(32);

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
    @Mock private RoomBansRepository roomBansRepository;
    @Mock private RoomMutedRepository roomMutedRepository;
    @Mock private RoomRolesRepository roomRolesRepository;
    @Mock private RateLimitService rateLimitService;
    @Mock private OnlineStatusRepository onlineStatusRepository;
    @Mock private SimpMessagingTemplate messagingTemplate;

    @InjectMocks
    private RoomHandler roomHandler;

    @Test
    void acceptJoin_success_broadcastsJoinedOnRoomTopic_andDoesNotWriteMessages() {
        RoomJoinDecisionRequest request = new RoomJoinDecisionRequest();
        request.setRoomId(ROOM);
        request.setSenderInternalId(JOINER_INTERNAL);
        when(roomJoinService.acceptJoin(OWNER_INTERNAL, ROOM, JOINER_INTERNAL)).thenReturn(Mono.empty());
        when(userIdentityRepository.findById(JOINER_INTERNAL)).thenReturn(Mono.just(catalogUser("Alice")));

        roomHandler.acceptRoomJoin(request, telegramPrincipal(1L, "Owner"));

        RoomMembershipEvent event = captureTopicMembership();
        assertThat(event.getEventType()).isEqualTo(RoomMembershipEvent.JOINED);
        assertThat(event.getRoomId()).isEqualTo(ROOM);
        assertThat(event.getMemberInternalId()).isEqualTo(JOINER_INTERNAL);
        assertThat(event.getDisplayName()).isEqualTo("Alice");
        assertThat(event.getOccurredAt()).isPositive();
        verify(roomMessageRepository, never()).saveMessage(any());
        verifyNoInteractions(roomMessageRepository);
    }

    @Test
    void requestJoin_byPasswordApproved_broadcastsJoinedOnRoomTopic() {
        RequestJoinRoomRequest request = new RequestJoinRoomRequest();
        request.setInviteToken(INVITE_TOKEN);
        when(roomJoinService.requestJoin(
                eq(JOINER_INTERNAL), any(), any(), any(), eq(INVITE_TOKEN), any(), any()))
                .thenReturn(Mono.just(new RoomJoinService.JoinResult.Approved(ROOM, OWNER_INTERNAL)));

        roomHandler.requestJoinRoom(request, telegramPrincipal(2L, "Bob"));

        RoomMembershipEvent event = captureTopicMembership();
        assertThat(event.getEventType()).isEqualTo(RoomMembershipEvent.JOINED);
        assertThat(event.getRoomId()).isEqualTo(ROOM);
        assertThat(event.getMemberInternalId()).isEqualTo(JOINER_INTERNAL);
        assertThat(event.getDisplayName()).isEqualTo("Bob");
        verify(roomMessageRepository, never()).saveMessage(any());
    }

    @Test
    void createRoom_doesNotBroadcastMembershipOnTopic() {
        CreateRoomRequest request = new CreateRoomRequest();
        request.setJoinMode(Room.JoinMode.BY_REQUEST);
        request.setOwnerPublicKey("YQ==");
        Room created = Room.builder()
                .id(ROOM)
                .ownerInternalId(OWNER_INTERNAL)
                .joinMode(Room.JoinMode.BY_REQUEST)
                .build();
        when(roomService.createRoom(eq(OWNER_INTERNAL), any(), eq(request))).thenReturn(Mono.just(created));
        when(inviteTokenService.generateInviteLink(ROOM, OWNER_INTERNAL)).thenReturn(Mono.just("https://t.me/x"));
        when(memberPublicKeyRepository.put(eq(ROOM), eq(OWNER_INTERNAL), anyString())).thenReturn(Mono.empty());

        roomHandler.createRoom(request, telegramPrincipal(1L, "Owner"));

        verify(messagingTemplate, after(200).never())
                .convertAndSend(anyString(), any(RoomMembershipEvent.class));
        verify(stompUserMessenger, timeout(1000)).convertAndSendToUser(any(), eq("/queue/room-created"), any());
    }

    @Test
    void acceptJoin_catalogMiss_stillEmitsJoinedWithNullDisplayName() {
        RoomJoinDecisionRequest request = new RoomJoinDecisionRequest();
        request.setRoomId(ROOM);
        request.setSenderInternalId(JOINER_INTERNAL);
        when(roomJoinService.acceptJoin(OWNER_INTERNAL, ROOM, JOINER_INTERNAL)).thenReturn(Mono.empty());
        when(userIdentityRepository.findById(JOINER_INTERNAL)).thenReturn(Mono.empty());

        roomHandler.acceptRoomJoin(request, telegramPrincipal(1L, "Owner"));

        RoomMembershipEvent event = captureTopicMembership();
        assertThat(event.getEventType()).isEqualTo(RoomMembershipEvent.JOINED);
        assertThat(event.getMemberInternalId()).isEqualTo(JOINER_INTERNAL);
        assertThat(event.getDisplayName()).isNull();
        verifyNoInteractions(roomMessageRepository);
    }

    @Test
    void acceptJoin_lookupFail_stillEmitsJoinedWithNullDisplayName() {
        RoomJoinDecisionRequest request = new RoomJoinDecisionRequest();
        request.setRoomId(ROOM);
        request.setSenderInternalId(JOINER_INTERNAL);
        when(roomJoinService.acceptJoin(OWNER_INTERNAL, ROOM, JOINER_INTERNAL)).thenReturn(Mono.empty());
        when(userIdentityRepository.findById(JOINER_INTERNAL))
                .thenReturn(Mono.error(new IllegalStateException("catalog unavailable")));

        roomHandler.acceptRoomJoin(request, telegramPrincipal(1L, "Owner"));

        RoomMembershipEvent event = captureTopicMembership();
        assertThat(event.getEventType()).isEqualTo(RoomMembershipEvent.JOINED);
        assertThat(event.getDisplayName()).isNull();
        verify(roomJoinService).acceptJoin(OWNER_INTERNAL, ROOM, JOINER_INTERNAL);
    }

    private RoomMembershipEvent captureTopicMembership() {
        ArgumentCaptor<RoomMembershipEvent> captor = ArgumentCaptor.forClass(RoomMembershipEvent.class);
        verify(messagingTemplate, timeout(1000)).convertAndSend(eq(TOPIC), captor.capture());
        return captor.getValue();
    }

    private static UnifiedUser catalogUser(String displayName) {
        return new UnifiedUser(JOINER_INTERNAL, AuthType.TELEGRAM, displayName, 2L, null, null);
    }

    private static TelegramPrincipal telegramPrincipal(long telegramId, String firstName) {
        String internalId = InternalIds.forTelegramId(telegramId);
        TelegramInitData init = TelegramInitData.builder()
                .authDate(Instant.now())
                .hash("test-hash")
                .user(TelegramUser.builder().id(telegramId).firstName(firstName).username("u" + telegramId).build())
                .build();
        UnifiedUser user = new UnifiedUser(
                internalId, AuthType.TELEGRAM, firstName, telegramId, null, null);
        return new TelegramPrincipal(user, init);
    }
}
