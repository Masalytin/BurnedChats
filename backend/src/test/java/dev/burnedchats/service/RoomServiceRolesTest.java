package dev.burnedchats.service;

import dev.burnedchats.dto.event.RoomOwnershipTransferredEvent;
import dev.burnedchats.model.Room;
import dev.burnedchats.model.RoomRole;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.RoomRolesRepository;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomServiceRolesTest {

    private static final String ROOM_ID = "room-roles-1";
    private static final String OWNER = InternalIds.forTelegramId(1L);
    private static final String ADMIN = InternalIds.forTelegramId(2L);
    private static final String MEMBER = InternalIds.forTelegramId(3L);

    @Mock private RoomRepository roomRepository;
    @Mock private RoomMembersRepository roomMembersRepository;
    @Mock private RoomRolesRepository roomRolesRepository;
    @Mock private PasswordProofService passwordProofService;

    @InjectMocks
    private RoomService roomService;

    @Test
    void roleOf_resolvesOwnerFromRoomHash() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));

        StepVerifier.create(roomService.roleOf(ROOM_ID, OWNER))
                .expectNext(RoomRole.OWNER)
                .verifyComplete();
    }

    @Test
    void roleOf_resolvesAdminFromRolesOverlay() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));
        when(roomRolesRepository.getStoredRole(ROOM_ID, ADMIN)).thenReturn(Mono.just("admin"));

        StepVerifier.create(roomService.roleOf(ROOM_ID, ADMIN))
                .expectNext(RoomRole.ADMIN)
                .verifyComplete();
    }

    @Test
    void roleOf_defaultsToMemberWhenNoOverlay() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));
        when(roomRolesRepository.getStoredRole(ROOM_ID, MEMBER)).thenReturn(Mono.empty());

        StepVerifier.create(roomService.roleOf(ROOM_ID, MEMBER))
                .expectNext(RoomRole.MEMBER)
                .verifyComplete();
    }

    @Test
    void transferOwnership_whenNotOwner_fails() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));

        StepVerifier.create(roomService.transferOwnership(ROOM_ID, MEMBER, ADMIN))
                .expectError(SecurityException.class)
                .verify();

        verify(roomRepository, never()).updateOwnerInternalId(eq(ROOM_ID), eq(ADMIN));
    }

    @Test
    void transferOwnership_whenTargetNotMember_fails() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));
        when(roomMembersRepository.isMember(ROOM_ID, MEMBER)).thenReturn(Mono.just(false));

        StepVerifier.create(roomService.transferOwnership(ROOM_ID, OWNER, MEMBER))
                .expectErrorMatches(error -> error instanceof IllegalArgumentException
                        && "NOT_MEMBER".equals(error.getMessage()))
                .verify();

        verify(roomRepository, never()).updateOwnerInternalId(eq(ROOM_ID), eq(MEMBER));
    }

    @Test
    void transferOwnership_whenSuccess_updatesOwnerAndRoles() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));
        when(roomMembersRepository.isMember(ROOM_ID, MEMBER)).thenReturn(Mono.just(true));
        when(roomRepository.updateOwnerInternalId(ROOM_ID, MEMBER)).thenReturn(Mono.just(true));
        when(roomRolesRepository.setRole(ROOM_ID, OWNER, RoomRole.ADMIN.apiValue())).thenReturn(Mono.just(true));
        when(roomRolesRepository.remove(ROOM_ID, MEMBER)).thenReturn(Mono.just(1L));

        StepVerifier.create(roomService.transferOwnership(ROOM_ID, OWNER, MEMBER))
                .assertNext(event -> {
                    assertThat(event.getRoomId()).isEqualTo(ROOM_ID);
                    assertThat(event.getNewOwnerInternalId()).isEqualTo(MEMBER);
                    assertThat(event.getPreviousOwnerInternalId()).isEqualTo(OWNER);
                    assertThat(event.getEventType()).isEqualTo("ROOM_OWNERSHIP_TRANSFERRED");
                })
                .verifyComplete();

        verify(roomRepository).updateOwnerInternalId(ROOM_ID, MEMBER);
        verify(roomRolesRepository).setRole(ROOM_ID, OWNER, RoomRole.ADMIN.apiValue());
        verify(roomRolesRepository).remove(ROOM_ID, MEMBER);
    }

    @Test
    void requireAdminOrOwner_allowsAdminOverlay() {
        Room room = roomOwnedBy(OWNER);
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(room));
        when(roomRolesRepository.getStoredRole(ROOM_ID, ADMIN)).thenReturn(Mono.just("admin"));

        StepVerifier.create(roomService.requireAdminOrOwner(ROOM_ID, ADMIN))
                .expectNext(room)
                .verifyComplete();
    }

    @Test
    void requireAdminOrOwner_rejectsMember() {
        Room room = roomOwnedBy(OWNER);
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(room));
        when(roomRolesRepository.getStoredRole(ROOM_ID, MEMBER)).thenReturn(Mono.empty());

        StepVerifier.create(roomService.requireAdminOrOwner(ROOM_ID, MEMBER))
                .expectError(SecurityException.class)
                .verify();
    }

    @Test
    void setRole_whenNotOwner_fails() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));

        StepVerifier.create(roomService.setRole(ROOM_ID, MEMBER, ADMIN, RoomRole.ADMIN.apiValue()))
                .expectError(SecurityException.class)
                .verify();

        verify(roomRolesRepository, never()).setRole(eq(ROOM_ID), eq(ADMIN), anyString());
    }

    @Test
    void setRole_whenTargetNotMember_fails() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));
        when(roomMembersRepository.isMember(ROOM_ID, MEMBER)).thenReturn(Mono.just(false));

        StepVerifier.create(roomService.setRole(ROOM_ID, OWNER, MEMBER, RoomRole.ADMIN.apiValue()))
                .expectErrorMatches(error -> error instanceof IllegalArgumentException
                        && "NOT_MEMBER".equals(error.getMessage()))
                .verify();
    }

    @Test
    void setRole_whenPromoteToAdmin_persistsAndReturnsEvent() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));
        when(roomMembersRepository.isMember(ROOM_ID, MEMBER)).thenReturn(Mono.just(true));
        when(roomRolesRepository.setRole(ROOM_ID, MEMBER, RoomRole.ADMIN.apiValue())).thenReturn(Mono.just(true));

        StepVerifier.create(roomService.setRole(ROOM_ID, OWNER, MEMBER, RoomRole.ADMIN.apiValue()))
                .assertNext(event -> {
                    assertThat(event.getRoomId()).isEqualTo(ROOM_ID);
                    assertThat(event.getTargetInternalId()).isEqualTo(MEMBER);
                    assertThat(event.getRole()).isEqualTo("admin");
                    assertThat(event.getEventType()).isEqualTo("ROOM_ROLE_UPDATED");
                })
                .verifyComplete();

        verify(roomRolesRepository).setRole(ROOM_ID, MEMBER, RoomRole.ADMIN.apiValue());
    }

    @Test
    void setRole_whenDemoteToMember_removesOverlay() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));
        when(roomMembersRepository.isMember(ROOM_ID, ADMIN)).thenReturn(Mono.just(true));
        when(roomRolesRepository.remove(ROOM_ID, ADMIN)).thenReturn(Mono.just(1L));

        StepVerifier.create(roomService.setRole(ROOM_ID, OWNER, ADMIN, RoomRole.MEMBER.apiValue()))
                .assertNext(event -> assertThat(event.getRole()).isEqualTo("member"))
                .verifyComplete();

        verify(roomRolesRepository).remove(ROOM_ID, ADMIN);
    }

    @Test
    void kickChain_whenSelfKick_errorsBeforeCleanup() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));
        AtomicBoolean cleaned = new AtomicBoolean();

        StepVerifier.create(
                        roomService.requireAdminOrOwner(ROOM_ID, OWNER)
                                .flatMap(room -> roomService.validateModerationTarget(room, OWNER, OWNER)
                                        .then(Mono.defer(() -> Mono.fromRunnable(() -> cleaned.set(true))))))
                .expectErrorMatches(error -> error instanceof IllegalStateException
                        && "CANNOT_KICK_SELF".equals(error.getMessage()))
                .verify();

        assertThat(cleaned.get()).isFalse();
    }

    @Test
    void kickChain_whenSelfKick_doesNotRunPostValidationStep() {
        when(roomRepository.findById(ROOM_ID)).thenReturn(Mono.just(roomOwnedBy(OWNER)));
        AtomicBoolean cleaned = new AtomicBoolean();

        roomService.requireAdminOrOwner(ROOM_ID, OWNER)
                .flatMap(room -> roomService.validateModerationTarget(room, OWNER, OWNER)
                        .then(Mono.fromRunnable(() -> cleaned.set(true))))
                .subscribe(v -> { }, e -> { });

        assertThat(cleaned).isFalse();
    }

    @Test
    void validateModerationTarget_whenSelfKick_fails() {
        StepVerifier.create(roomService.validateModerationTarget(roomOwnedBy(OWNER), OWNER, OWNER))
                .expectErrorMatches(error -> error instanceof IllegalStateException
                        && "CANNOT_KICK_SELF".equals(error.getMessage()))
                .verify();
    }

    private static final String OTHER_ADMIN = InternalIds.forTelegramId(4L);

    @Test
    void validateModerationTarget_whenAdminTargetsMember_succeeds() {
        Room room = roomOwnedBy(OWNER);
        when(roomRolesRepository.getStoredRole(ROOM_ID, ADMIN)).thenReturn(Mono.just("admin"));
        when(roomRolesRepository.getStoredRole(ROOM_ID, MEMBER)).thenReturn(Mono.empty());
        when(roomMembersRepository.isMember(ROOM_ID, MEMBER)).thenReturn(Mono.just(true));

        StepVerifier.create(roomService.validateModerationTarget(room, ADMIN, MEMBER))
                .verifyComplete();
    }

    @Test
    void validateModerationTarget_whenAdminTargetsAdmin_fails() {
        Room room = roomOwnedBy(OWNER);
        when(roomRolesRepository.getStoredRole(ROOM_ID, ADMIN)).thenReturn(Mono.just("admin"));
        when(roomRolesRepository.getStoredRole(ROOM_ID, OTHER_ADMIN)).thenReturn(Mono.just("admin"));

        StepVerifier.create(roomService.validateModerationTarget(room, ADMIN, OTHER_ADMIN))
                .expectErrorMatches(error -> error instanceof IllegalStateException
                        && "CANNOT_KICK_ADMIN".equals(error.getMessage()))
                .verify();
    }

    private static Room roomOwnedBy(String ownerInternalId) {
        return Room.builder()
                .id(ROOM_ID)
                .ownerInternalId(ownerInternalId)
                .joinMode(Room.JoinMode.BY_REQUEST)
                .build();
    }
}
