package dev.burnedchats.handler;

import dev.burnedchats.dto.event.RoomMemberKickedEvent;
import dev.burnedchats.dto.event.RoomMemberRemovedEvent;
import dev.burnedchats.dto.request.KickMemberRequest;
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
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

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

    @InjectMocks
    private RoomHandler roomHandler;

    @Test
    void kickMember_whenNotOwner_doesNotPerformCleanup() {
        KickMemberRequest request = kickRequest(TARGET_INTERNAL);
        TelegramPrincipal caller = principalFor(InternalIds.forTelegramId(99L));
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));

        roomHandler.kickMember(request, caller);

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verify(stompUserMessenger, never()).convertAndSendToInternalId(any(), any(), any());
    }

    @Test
    void kickMember_whenKickSelf_doesNotPerformCleanup() {
        KickMemberRequest request = kickRequest(OWNER_INTERNAL);
        TelegramPrincipal owner = ownerPrincipal();
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));

        roomHandler.kickMember(request, owner);

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
        verify(stompUserMessenger, never()).convertAndSendToInternalId(any(), any(), any());
    }

    @Test
    void kickMember_whenMemberTriesToKickOwner_doesNotPerformCleanup() {
        KickMemberRequest request = kickRequest(OWNER_INTERNAL);
        TelegramPrincipal member = principalFor(TARGET_INTERNAL);
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));

        roomHandler.kickMember(request, member);

        verify(roomMembersRepository, never()).remove(anyString(), anyString());
    }

    @Test
    void kickMember_whenTargetNotMember_doesNotPerformCleanup() {
        KickMemberRequest request = kickRequest(TARGET_INTERNAL);
        TelegramPrincipal owner = ownerPrincipal();
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));
        when(roomMembersRepository.isMember(ROOM, TARGET_INTERNAL)).thenReturn(Mono.just(false));

        roomHandler.kickMember(request, owner);

        verify(roomMembersRepository, never()).remove(eq(ROOM), eq(TARGET_INTERNAL));
        verify(stompUserMessenger, never()).convertAndSendToInternalId(any(), any(), any());
    }

    @Test
    void kickMember_whenSuccess_performsCleanupAndSendsEvents() {
        KickMemberRequest request = kickRequest(TARGET_INTERNAL);
        TelegramPrincipal owner = ownerPrincipal();
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));
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
        return principalFor(OWNER_INTERNAL);
    }

    private static TelegramPrincipal principalFor(String internalId) {
        TelegramPrincipal principal = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(principal.getInternalId()).thenReturn(internalId);
        return principal;
    }
}
