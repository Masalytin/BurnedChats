package dev.burnedchats.handler;

import dev.burnedchats.dto.event.RoomKickResultEvent;
import dev.burnedchats.dto.event.RoomMemberKickedEvent;
import dev.burnedchats.dto.event.RoomMemberRemovedEvent;
import dev.burnedchats.dto.request.KickMemberRequest;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Room;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.InviteTokenService;
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
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomHandlerKickTest {

    private static final String ROOM = "room-kick-1";
    private static final String OWNER_INTERNAL = InternalIds.forTelegramId(1L);
    private static final String TARGET_INTERNAL = InternalIds.forTelegramId(2L);
    private static final String OTHER_MEMBER = InternalIds.forTelegramId(3L);
    private static final String KICK_RESULT_DESTINATION = "/queue/room-kick-result";

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
    @Mock private RoomJoinRequestRepository roomJoinRequestRepository;
    @Mock private InviteTokenRepository inviteTokenRepository;
    @Mock private RoomMessageRepository roomMessageRepository;
    @Mock private RoomTopicSubscriptionService roomTopicSubscriptionService;
    @Mock private RateLimitService rateLimitService;

    @InjectMocks
    private RoomHandler roomHandler;

    @BeforeEach
    void allowRateLimit() {
        when(rateLimitService.enforceRateLimit(anyString(), eq(RateLimitType.SESSION_ACTION)))
                .thenReturn(Mono.empty());
    }

    @Test
    void kickMember_whenNotOwner_sendsFailureAckWithoutCleanup() {
        KickMemberRequest request = kickRequest(TARGET_INTERNAL);
        String caller = InternalIds.forTelegramId(99L);
        TelegramPrincipal callerPrincipal = principalFor(caller);
        stubNotOwner(caller);

        roomHandler.kickMember(request, callerPrincipal);

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(caller, TARGET_INTERNAL, false, "NOT_OWNER");
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(TARGET_INTERNAL), eq("/queue/room-kicked"), any());
    }

    @Test
    void kickMember_whenKickSelf_sendsFailureAckWithoutCleanup() {
        KickMemberRequest request = kickRequest(OWNER_INTERNAL);
        TelegramPrincipal owner = ownerPrincipal();
        stubOwnerAccess(OWNER_INTERNAL);

        roomHandler.kickMember(request, owner);

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(OWNER_INTERNAL, OWNER_INTERNAL, false, "CANNOT_KICK_SELF");
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(TARGET_INTERNAL), eq("/queue/room-kicked"), any());
    }

    @Test
    void kickMember_whenKickRoomOwnerId_sendsCannotKickSelfWithoutCleanup() {
        KickMemberRequest request = kickRequest(OWNER_INTERNAL);
        TelegramPrincipal owner = ownerPrincipal();
        stubOwnerAccess(OWNER_INTERNAL);

        roomHandler.kickMember(request, owner);

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(OWNER_INTERNAL, OWNER_INTERNAL, false, "CANNOT_KICK_SELF");
    }

    @Test
    void kickMember_whenMemberTriesToKickOwner_sendsNotOwnerWithoutCleanup() {
        KickMemberRequest request = kickRequest(OWNER_INTERNAL);
        TelegramPrincipal member = principalFor(TARGET_INTERNAL);
        stubNotOwner(TARGET_INTERNAL);

        roomHandler.kickMember(request, member);

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(TARGET_INTERNAL, OWNER_INTERNAL, false, "NOT_OWNER");
    }

    @Test
    void kickMember_whenRoomNotFound_sendsFailureAckWithoutCleanup() {
        KickMemberRequest request = kickRequest(TARGET_INTERNAL);
        TelegramPrincipal owner = ownerPrincipal();
        stubRoomNotFound(OWNER_INTERNAL);

        roomHandler.kickMember(request, owner);

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(OWNER_INTERNAL, TARGET_INTERNAL, false, "ROOM_NOT_FOUND");
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(TARGET_INTERNAL), eq("/queue/room-kicked"), any());
    }

    @Test
    void kickMember_whenTargetNotMember_sendsFailureAckWithoutCleanup() {
        KickMemberRequest request = kickRequest(TARGET_INTERNAL);
        TelegramPrincipal owner = ownerPrincipal();
        stubOwnerAccess(OWNER_INTERNAL);
        when(roomService.isOwner(ownerRoom(), TARGET_INTERNAL)).thenReturn(false);
        when(roomMembersRepository.isMember(ROOM, TARGET_INTERNAL)).thenReturn(Mono.just(false));

        roomHandler.kickMember(request, owner);

        verify(roomMembersRepository, never()).remove(eq(ROOM), eq(TARGET_INTERNAL));
        verifyKickResult(OWNER_INTERNAL, TARGET_INTERNAL, false, "NOT_MEMBER");
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(TARGET_INTERNAL), eq("/queue/room-kicked"), any());
    }

    @Test
    void kickMember_whenRateLimited_sendsFailureAckWithoutCleanup() {
        KickMemberRequest request = kickRequest(TARGET_INTERNAL);
        TelegramPrincipal owner = ownerPrincipal();
        when(rateLimitService.enforceRateLimit(OWNER_INTERNAL, RateLimitType.SESSION_ACTION))
                .thenReturn(Mono.error(new RateLimitException(Duration.ofSeconds(30))));

        roomHandler.kickMember(request, owner);

        verify(roomService, never()).requireOwner(anyString(), anyString());
        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verifyKickResult(OWNER_INTERNAL, TARGET_INTERNAL, false, "RATE_LIMITED");
    }

    @Test
    void kickMember_whenSuccess_performsCleanupSendsEventsAndSuccessAck() {
        KickMemberRequest request = kickRequest(TARGET_INTERNAL);
        TelegramPrincipal owner = ownerPrincipal();
        Room room = ownerRoom();
        stubOwnerAccess(OWNER_INTERNAL);
        when(roomService.isOwner(room, TARGET_INTERNAL)).thenReturn(false);
        when(roomMembersRepository.isMember(ROOM, TARGET_INTERNAL)).thenReturn(Mono.just(true));
        when(roomMembersRepository.remove(ROOM, TARGET_INTERNAL)).thenReturn(Mono.just(1L));
        when(memberPublicKeyRepository.remove(ROOM, TARGET_INTERNAL)).thenReturn(Mono.empty());
        when(roomJoinRequestRepository.remove(ROOM, TARGET_INTERNAL)).thenReturn(Mono.empty());
        when(roomKeysRepository.removeRecipientAllEpochs(ROOM, TARGET_INTERNAL)).thenReturn(Mono.just(2L));
        when(roomMembersRepository.getMembers(ROOM))
                .thenReturn(Flux.fromIterable(List.of(OWNER_INTERNAL, OTHER_MEMBER)));

        roomHandler.kickMember(request, owner);

        verify(roomMembersRepository).remove(ROOM, TARGET_INTERNAL);
        verify(memberPublicKeyRepository).remove(ROOM, TARGET_INTERNAL);
        verify(roomJoinRequestRepository).remove(ROOM, TARGET_INTERNAL);
        verify(roomKeysRepository).removeRecipientAllEpochs(ROOM, TARGET_INTERNAL);
        verify(roomTopicSubscriptionService).unsubscribeUserFromRoomTopic(ROOM, TARGET_INTERNAL);

        ArgumentCaptor<RoomMemberKickedEvent> kickedCaptor =
                ArgumentCaptor.forClass(RoomMemberKickedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(TARGET_INTERNAL), eq("/queue/room-kicked"), kickedCaptor.capture());
        assertThat(kickedCaptor.getValue().getRoomId()).isEqualTo(ROOM);
        assertThat(kickedCaptor.getValue().getByInternalId()).isEqualTo(OWNER_INTERNAL);

        ArgumentCaptor<RoomMemberRemovedEvent> removedCaptor =
                ArgumentCaptor.forClass(RoomMemberRemovedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(OWNER_INTERNAL), eq("/queue/room-member-removed"), removedCaptor.capture());
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(OTHER_MEMBER), eq("/queue/room-member-removed"), any(RoomMemberRemovedEvent.class));
        assertThat(removedCaptor.getValue().getRoomId()).isEqualTo(ROOM);
        assertThat(removedCaptor.getValue().getRemovedInternalId()).isEqualTo(TARGET_INTERNAL);

        verifyKickResult(OWNER_INTERNAL, TARGET_INTERNAL, true, null);
    }

    private void verifyKickResult(
            String ownerInternalId, String expectedTargetInternalId, boolean success, String errorCode) {
        ArgumentCaptor<RoomKickResultEvent> resultCaptor =
                ArgumentCaptor.forClass(RoomKickResultEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(ownerInternalId), eq(KICK_RESULT_DESTINATION), resultCaptor.capture());
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

    private void stubOwnerAccess(String callerInternalId) {
        when(roomService.requireOwner(ROOM, callerInternalId)).thenReturn(Mono.just(ownerRoom()));
    }

    private void stubNotOwner(String callerInternalId) {
        when(roomService.requireOwner(ROOM, callerInternalId))
                .thenReturn(Mono.error(new SecurityException("NOT_OWNER")));
    }

    private void stubRoomNotFound(String callerInternalId) {
        when(roomService.requireOwner(ROOM, callerInternalId))
                .thenReturn(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")));
    }

    private static TelegramPrincipal ownerPrincipal() {
        return principalFor(OWNER_INTERNAL);
    }

    private static TelegramPrincipal principalFor(String internalId) {
        TelegramPrincipal principal = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(principal.getInternalId()).thenReturn(internalId);
        return principal;
    }
}
