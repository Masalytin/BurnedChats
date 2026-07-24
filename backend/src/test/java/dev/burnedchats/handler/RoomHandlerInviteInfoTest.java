package dev.burnedchats.handler;

import dev.burnedchats.dto.event.RoomInviteInfoEvent;
import dev.burnedchats.dto.request.GetInviteInfoRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Room;
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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomHandlerInviteInfoTest {

    private static final String ROOM = "room-invite-info-1";
    private static final String TOKEN = "invite-token-abc";
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
    @Mock private RoomBansRepository roomBansRepository;
    @Mock private RoomMutedRepository roomMutedRepository;
    @Mock private RoomRolesRepository roomRolesRepository;
    @Mock private RateLimitService rateLimitService;
    @Mock private OnlineStatusRepository onlineStatusRepository;
    @Mock private SimpMessagingTemplate messagingTemplate;

    @InjectMocks
    private RoomHandler roomHandler;

    @Test
    void getInviteInfo_whenAlreadyMember_sendsAlreadyMemberWithRoomId() {
        GetInviteInfoRequest request = inviteInfoRequest();
        TelegramPrincipal member = principalFor(MEMBER_INTERNAL);
        when(inviteTokenService.resolveRoomByToken(TOKEN)).thenReturn(Mono.just(byRequestRoom()));
        when(roomMembersRepository.isMember(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(true));

        roomHandler.getInviteInfo(request, member);

        ArgumentCaptor<RoomInviteInfoEvent> eventCaptor = ArgumentCaptor.forClass(RoomInviteInfoEvent.class);
        verify(stompUserMessenger).convertAndSendToUser(
                eq(member), eq("/queue/room-invite-info"), eventCaptor.capture());
        RoomInviteInfoEvent event = eventCaptor.getValue();
        assertFalse(event.isSuccess());
        assertEquals("ALREADY_MEMBER", event.getError());
        assertEquals(ROOM, event.getRoomId());
        assertNull(event.getSalt());
        assertNull(event.getJoinMode());
    }

    @Test
    void getInviteInfo_whenNotMember_sendsSuccessInviteInfo() {
        GetInviteInfoRequest request = inviteInfoRequest();
        TelegramPrincipal outsider = principalFor(MEMBER_INTERNAL);
        when(inviteTokenService.resolveRoomByToken(TOKEN)).thenReturn(Mono.just(byRequestRoom()));
        when(roomMembersRepository.isMember(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(false));

        roomHandler.getInviteInfo(request, outsider);

        ArgumentCaptor<RoomInviteInfoEvent> eventCaptor = ArgumentCaptor.forClass(RoomInviteInfoEvent.class);
        verify(stompUserMessenger).convertAndSendToUser(
                eq(outsider), eq("/queue/room-invite-info"), eventCaptor.capture());
        RoomInviteInfoEvent event = eventCaptor.getValue();
        assertTrue(event.isSuccess());
        assertEquals("BY_REQUEST", event.getJoinMode());
        assertFalse(event.getHasPassword());
        assertNull(event.getError());
        assertNull(event.getRoomId());
    }

    private static GetInviteInfoRequest inviteInfoRequest() {
        GetInviteInfoRequest request = new GetInviteInfoRequest();
        request.setInviteToken(TOKEN);
        return request;
    }

    private static Room byRequestRoom() {
        return Room.builder()
                .id(ROOM)
                .ownerInternalId(InternalIds.forTelegramId(1L))
                .joinMode(Room.JoinMode.BY_REQUEST)
                .passwordProofHash(null)
                .salt(null)
                .build();
    }

    private static TelegramPrincipal principalFor(String internalId) {
        TelegramPrincipal principal = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(principal.getInternalId()).thenReturn(internalId);
        return principal;
    }
}
