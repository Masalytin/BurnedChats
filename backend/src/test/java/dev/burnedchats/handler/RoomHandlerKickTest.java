package dev.burnedchats.handler;

import dev.burnedchats.dto.event.RoomKickResultEvent;
import dev.burnedchats.dto.event.RoomMemberKickedEvent;
import dev.burnedchats.dto.event.RoomMemberRemovedEvent;
import dev.burnedchats.dto.request.KickMemberRequest;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Room;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomBansRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomMutedRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.RoomRolesRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.security.TelegramInitData;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.InviteTokenService;
import dev.burnedchats.service.PasswordProofService;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import dev.burnedchats.service.RoomJoinService;
import dev.burnedchats.service.RoomService;
import dev.burnedchats.service.RoomTopicSubscriptionService;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomHandlerKickTest {

    private static final String ROOM = "room-kick-1";
    private static final String OWNER_INTERNAL = InternalIds.forTelegramId(1L);
    private static final String ADMIN_INTERNAL = InternalIds.forTelegramId(4L);
    private static final String TARGET_INTERNAL = InternalIds.forTelegramId(2L);
    private static final String OTHER_ADMIN = InternalIds.forTelegramId(5L);
    private static final String OTHER_MEMBER = InternalIds.forTelegramId(3L);
    private static final String KICK_RESULT_DESTINATION = "/queue/room-kick-result";

    @Mock private InviteTokenService inviteTokenService;
    @Mock private RoomJoinService roomJoinService;
    @Mock private FileBurnService fileBurnService;
    @Mock private StompUserMessenger stompUserMessenger;
    @Mock private UserIdentityRepository userIdentityRepository;
    @Mock private RoomKeysRepository roomKeysRepository;
    @Mock private RoomMemberPublicKeyRepository memberPublicKeyRepository;
    @Mock private RoomRepository roomRepository;
    @Mock private RoomMembersRepository roomMembersRepository;
    @Mock private RoomJoinRequestRepository roomJoinRequestRepository;
    @Mock private InviteTokenRepository inviteTokenRepository;
    @Mock private RoomMessageRepository roomMessageRepository;
    @Mock private RoomTopicSubscriptionService roomTopicSubscriptionService;
    @Mock private RoomBansRepository roomBansRepository;
    @Mock private RoomMutedRepository roomMutedRepository;
    @Mock private RoomRolesRepository roomRolesRepository;
    @Mock private RateLimitService rateLimitService;
    @Mock private SimpMessagingTemplate messagingTemplate;
    @Mock private PasswordProofService passwordProofService;

    private RoomService roomService;

    private RoomHandler roomHandler;

    @BeforeEach
    void setUp() {
        roomService = new RoomService(
                roomRepository,
                roomMembersRepository,
                roomRolesRepository,
                passwordProofService);
        roomHandler = new RoomHandler(
                roomService,
                inviteTokenService,
                roomJoinService,
                fileBurnService,
                stompUserMessenger,
                userIdentityRepository,
                roomKeysRepository,
                memberPublicKeyRepository,
                roomRepository,
                roomMembersRepository,
                roomJoinRequestRepository,
                inviteTokenRepository,
                roomMessageRepository,
                roomTopicSubscriptionService,
                roomBansRepository,
                roomMutedRepository,
                roomRolesRepository,
                rateLimitService,
                messagingTemplate);
        when(rateLimitService.enforceRateLimit(anyString(), eq(RateLimitType.SESSION_ACTION)))
                .thenReturn(Mono.empty());
        lenient().when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));
    }

    @Test
    void kickMember_whenNotAuthorized_sendsFailureAckWithoutCleanup() {
        KickMemberRequest request = kickRequest(TARGET_INTERNAL);
        String caller = InternalIds.forTelegramId(99L);
        when(roomRolesRepository.getStoredRole(ROOM, caller)).thenReturn(Mono.empty());

        roomHandler.kickMember(request, telegramPrincipal(99L));

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(caller, TARGET_INTERNAL, false, "NOT_OWNER");
    }

    @Test
    void kickMember_whenKickSelf_sendsFailureAckWithoutCleanup() {
        roomHandler.kickMember(kickRequest(OWNER_INTERNAL), ownerPrincipal());

        verifyKickResult(OWNER_INTERNAL, OWNER_INTERNAL, false, "CANNOT_KICK_SELF");
        verify(roomMembersRepository, never()).remove(anyString(), anyString());
    }

    @Test
    void kickMember_whenMemberTriesToKickOwner_sendsNotOwnerWithoutCleanup() {
        KickMemberRequest request = kickRequest(OWNER_INTERNAL);
        when(roomRolesRepository.getStoredRole(ROOM, TARGET_INTERNAL)).thenReturn(Mono.empty());

        roomHandler.kickMember(request, telegramPrincipal(2L));

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(TARGET_INTERNAL, OWNER_INTERNAL, false, "NOT_OWNER");
    }

    @Test
    void kickMember_whenRoomNotFound_sendsFailureAckWithoutCleanup() {
        when(roomRepository.findById(ROOM)).thenReturn(Mono.empty());

        roomHandler.kickMember(kickRequest(TARGET_INTERNAL), ownerPrincipal());

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(OWNER_INTERNAL, TARGET_INTERNAL, false, "ROOM_NOT_FOUND");
    }

    @Test
    void kickMember_whenTargetNotMember_sendsFailureAckWithoutCleanup() {
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));
        when(roomRolesRepository.getStoredRole(ROOM, TARGET_INTERNAL)).thenReturn(Mono.empty());
        when(roomMembersRepository.isMember(ROOM, TARGET_INTERNAL)).thenReturn(Mono.just(false));

        roomHandler.kickMember(kickRequest(TARGET_INTERNAL), ownerPrincipal());

        verify(roomMembersRepository, never()).remove(eq(ROOM), eq(TARGET_INTERNAL));
        verifyKickResult(OWNER_INTERNAL, TARGET_INTERNAL, false, "NOT_MEMBER");
    }

    @Test
    void kickMember_whenAdminKicksAdmin_sendsCannotKickAdmin() {
        when(roomRolesRepository.getStoredRole(ROOM, ADMIN_INTERNAL)).thenReturn(Mono.just("admin"));
        when(roomRolesRepository.getStoredRole(ROOM, OTHER_ADMIN)).thenReturn(Mono.just("admin"));

        roomHandler.kickMember(kickRequest(OTHER_ADMIN), telegramPrincipal(4L));

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(ADMIN_INTERNAL, OTHER_ADMIN, false, "CANNOT_KICK_ADMIN");
    }

    @Test
    void kickMember_whenAdminKicksOwner_sendsCannotKickOwner() {
        when(roomRolesRepository.getStoredRole(ROOM, ADMIN_INTERNAL)).thenReturn(Mono.just("admin"));

        roomHandler.kickMember(kickRequest(OWNER_INTERNAL), telegramPrincipal(4L));

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(ADMIN_INTERNAL, OWNER_INTERNAL, false, "CANNOT_KICK_OWNER");
    }

    @Test
    void kickMember_whenRateLimited_sendsFailureAckWithoutCleanup() {
        when(rateLimitService.enforceRateLimit(OWNER_INTERNAL, RateLimitType.SESSION_ACTION))
                .thenReturn(Mono.error(new RateLimitException(Duration.ofSeconds(30))));

        roomHandler.kickMember(kickRequest(TARGET_INTERNAL), ownerPrincipal());

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(OWNER_INTERNAL, TARGET_INTERNAL, false, "RATE_LIMITED");
    }

    @Test
    void kickMember_whenOwnerSuccess_performsCleanupSendsEventsAndSuccessAck() {
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));
        stubMemberTarget();

        roomHandler.kickMember(kickRequest(TARGET_INTERNAL), ownerPrincipal());

        verifyKickCleanupAndEvents(OWNER_INTERNAL);
        verifyKickResult(OWNER_INTERNAL, TARGET_INTERNAL, true, null);
    }

    @Test
    void kickMember_whenAdminKicksMember_success() {
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));
        when(roomRolesRepository.getStoredRole(ROOM, ADMIN_INTERNAL)).thenReturn(Mono.just("admin"));
        stubMemberTarget();

        roomHandler.kickMember(kickRequest(TARGET_INTERNAL), telegramPrincipal(4L));

        verifyKickCleanupAndEvents(ADMIN_INTERNAL);
        verifyKickResult(ADMIN_INTERNAL, TARGET_INTERNAL, true, null);
    }

    private void stubMemberTarget() {
        when(roomRolesRepository.getStoredRole(ROOM, TARGET_INTERNAL)).thenReturn(Mono.empty());
        when(roomMembersRepository.isMember(ROOM, TARGET_INTERNAL)).thenReturn(Mono.just(true));
        when(roomMembersRepository.remove(ROOM, TARGET_INTERNAL)).thenReturn(Mono.just(1L));
        when(memberPublicKeyRepository.remove(ROOM, TARGET_INTERNAL)).thenReturn(Mono.empty());
        when(roomJoinRequestRepository.remove(ROOM, TARGET_INTERNAL)).thenReturn(Mono.empty());
        when(roomKeysRepository.removeRecipientAllEpochs(ROOM, TARGET_INTERNAL)).thenReturn(Mono.just(2L));
        when(roomRolesRepository.remove(ROOM, TARGET_INTERNAL)).thenReturn(Mono.just(1L));
        when(roomMembersRepository.getMembers(ROOM))
                .thenReturn(Flux.fromIterable(List.of(OWNER_INTERNAL, OTHER_MEMBER)));
    }

    private void verifyKickCleanupAndEvents(String actorInternalId) {
        verify(roomMembersRepository, timeout(1000)).remove(ROOM, TARGET_INTERNAL);
        verify(memberPublicKeyRepository).remove(ROOM, TARGET_INTERNAL);
        verify(roomJoinRequestRepository).remove(ROOM, TARGET_INTERNAL);
        verify(roomKeysRepository).removeRecipientAllEpochs(ROOM, TARGET_INTERNAL);
        verify(roomRolesRepository).remove(ROOM, TARGET_INTERNAL);
        verify(roomTopicSubscriptionService).unsubscribeUserFromRoomTopic(ROOM, TARGET_INTERNAL);

        ArgumentCaptor<RoomMemberKickedEvent> kickedCaptor =
                ArgumentCaptor.forClass(RoomMemberKickedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(TARGET_INTERNAL), eq("/queue/room-kicked"), kickedCaptor.capture());
        assertThat(kickedCaptor.getValue().getRoomId()).isEqualTo(ROOM);
        assertThat(kickedCaptor.getValue().getByInternalId()).isEqualTo(actorInternalId);

        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(OWNER_INTERNAL), eq("/queue/room-member-removed"), org.mockito.ArgumentMatchers.any());
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(OTHER_MEMBER), eq("/queue/room-member-removed"), org.mockito.ArgumentMatchers.any());
    }

    private void verifyKickResult(
            String actorInternalId, String expectedTargetInternalId, boolean success, String errorCode) {
        ArgumentCaptor<RoomKickResultEvent> resultCaptor =
                ArgumentCaptor.forClass(RoomKickResultEvent.class);
        verify(stompUserMessenger, timeout(1000)).convertAndSendToInternalId(
                eq(actorInternalId), eq(KICK_RESULT_DESTINATION), resultCaptor.capture());
        RoomKickResultEvent result = resultCaptor.getValue();
        assertThat(result.isSuccess()).isEqualTo(success);
        assertThat(result.getRoomId()).isEqualTo(ROOM);
        assertThat(result.getTargetInternalId()).isEqualTo(expectedTargetInternalId);
        if (success) {
            assertThat(result.getError()).isNull();
        } else {
            assertThat(result.getError()).isEqualTo(errorCode);
        }
    }

    private static KickMemberRequest kickRequest(String targetInternalId) {
        return KickMemberRequest.builder()
                .roomId(ROOM)
                .targetInternalId(targetInternalId)
                .build();
    }

    private static Room ownerRoom() {
        return Room.builder()
                .id(ROOM)
                .ownerInternalId(OWNER_INTERNAL)
                .joinMode(Room.JoinMode.BY_REQUEST)
                .build();
    }

    private static TelegramPrincipal ownerPrincipal() {
        return telegramPrincipal(1L);
    }

    private static TelegramPrincipal telegramPrincipal(long telegramId) {
        String internalId = InternalIds.forTelegramId(telegramId);
        TelegramInitData init = TelegramInitData.builder()
                .authDate(Instant.now())
                .hash("test-hash")
                .user(TelegramUser.builder().id(telegramId).username("kick-test").build())
                .build();
        UnifiedUser user = new UnifiedUser(
                internalId,
                AuthType.TELEGRAM,
                "Kick Test",
                telegramId,
                null,
                null);
        return new TelegramPrincipal(user, init);
    }
}
