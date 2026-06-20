package dev.burnedchats.service;

import dev.burnedchats.dto.event.RoomOwnershipTransferredEvent;
import dev.burnedchats.dto.event.RoomRoleUpdatedEvent;
import dev.burnedchats.model.Room;
import dev.burnedchats.model.RoomRole;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.RoomRolesRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.UUID;

/**
 * Business logic for room lifecycle: creation, membership, roles, and deletion.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@SuppressWarnings("checkstyle:JavadocMethod")
public class RoomService {

    private final RoomRepository roomRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final RoomRolesRepository roomRolesRepository;
    private final PasswordProofService passwordProofService;

    /**
     * Create a new room owned by {@code ownerInternalId}.
     *
     * @param ownerInternalId stable internal user id (from {@link dev.burnedchats.security.AppPrincipal})
     * @param ownerTgId       Telegram id when linked; null for wallet-only owners
     * @param salt            KDF salt (Base64), or empty when room has no password
     * @param passwordProof   PBKDF2 proof (Base64), or null when room has no password
     * @param joinMode        how participants enter the room
     * @param nameEncrypted   optional encrypted room name (may be null)
     * @return Mono with the newly created {@link Room}
     */
    public Mono<Room> createRoom(String ownerInternalId,
                                 Long ownerTgId,
                                 String salt,
                                 String passwordProof,
                                 Room.JoinMode joinMode,
                                 String nameEncrypted) {
        String roomId = UUID.randomUUID().toString();
        boolean hasPassword = passwordProof != null && !passwordProof.isBlank();
        String proofHash = hasPassword ? passwordProofService.hashProof(passwordProof) : "";
        String saltStored = (salt != null && !salt.isBlank()) ? salt : "";

        Room room = Room.builder()
                .id(roomId)
                .ownerInternalId(ownerInternalId)
                .ownerTgId(ownerTgId)
                .salt(saltStored)
                .passwordProofHash(proofHash)
                .joinMode(joinMode)
                .createdAt(Instant.now().toEpochMilli())
                .nameEncrypted(nameEncrypted)
                .build();

        return roomRepository.save(room)
                .then(roomMembersRepository.add(roomId, ownerInternalId))
                .thenReturn(room)
                .doOnSuccess(r -> LOG.info("Room created: id={}, ownerInternalId={}, joinMode={}",
                        r.getId(), ownerInternalId, joinMode))
                .onErrorResume(e -> {
                    LOG.error("Failed to create room for owner {}: {}", ownerInternalId, e.getMessage());
                    return Mono.error(e);
                });
    }

    public Mono<Void> deleteRoom(String roomId) {
        return Mono.when(
                roomRepository.delete(roomId),
                roomMembersRepository.deleteAll(roomId)
        ).doOnSuccess(v -> LOG.info("Room deleted: {}", roomId));
    }

    public Mono<Void> extendTtl(String roomId) {
        return roomRepository.extendTtl(roomId, RoomRepository.DEFAULT_TTL)
                .then();
    }

    /**
     * Resolve the effective role of a member in a room.
     *
     * @param roomId     room UUID
     * @param internalId member internal ID
     * @return Mono with {@link RoomRole}
     */
    public Mono<RoomRole> roleOf(String roomId, String internalId) {
        return roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> roleOf(room, internalId));
    }

    /**
     * Resolve the effective role of a member when the room is already loaded.
     */
    public Mono<RoomRole> roleOf(Room room, String internalId) {
        if (isOwner(room, internalId)) {
            return Mono.just(RoomRole.OWNER);
        }
        return roomRolesRepository.getStoredRole(room.getId(), internalId)
                .map(RoomRole::fromStoredValue)
                .defaultIfEmpty(RoomRole.MEMBER);
    }

    /**
     * Load a room and verify the caller is the owner.
     */
    public Mono<Room> requireOwner(String roomId, String internalId) {
        return roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> requireOwner(room, internalId));
    }

    /**
     * Verify the caller is the owner when the room is already loaded.
     */
    public Mono<Room> requireOwner(Room room, String internalId) {
        if (!isOwner(room, internalId)) {
            return Mono.error(new SecurityException("NOT_OWNER"));
        }
        return Mono.just(room);
    }

    /**
     * Load a room and verify the caller is the owner or an admin overlay.
     */
    public Mono<Room> requireAdminOrOwner(String roomId, String internalId) {
        return roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> requireAdminOrOwner(room, internalId));
    }

    /**
     * Verify the caller is the owner or an admin when the room is already loaded.
     */
    public Mono<Room> requireAdminOrOwner(Room room, String internalId) {
        return roleOf(room, internalId)
                .flatMap(role -> {
                    if (role == RoomRole.OWNER || role == RoomRole.ADMIN) {
                        return Mono.just(room);
                    }
                    return Mono.error(new SecurityException("NOT_OWNER"));
                });
    }

    /**
     * Validate that {@code actorInternalId} may kick or mute {@code targetInternalId}.
     *
     * <p>Owner may act on any member except themselves and the owner record. Admin may act
     * only on plain members — not on the owner or another admin.
     */
    public Mono<Void> validateModerationTarget(Room room, String actorInternalId, String targetInternalId) {
        if (actorInternalId.equals(targetInternalId)) {
            return Mono.error(new IllegalStateException("CANNOT_KICK_SELF"));
        }
        if (isOwner(room, targetInternalId)) {
            return Mono.error(new IllegalStateException("CANNOT_KICK_OWNER"));
        }
        return roleOf(room, actorInternalId)
                .zipWith(roleOf(room, targetInternalId))
                .flatMap(tuple -> {
                    RoomRole actorRole = tuple.getT1();
                    RoomRole targetRole = tuple.getT2();
                    if (actorRole == RoomRole.ADMIN && targetRole == RoomRole.ADMIN) {
                        return Mono.error(new IllegalStateException("CANNOT_KICK_ADMIN"));
                    }
                    return roomMembersRepository.isMember(room.getId(), targetInternalId)
                            .flatMap(isMember -> {
                                if (!isMember) {
                                    return Mono.error(new SecurityException("NOT_MEMBER"));
                                }
                                return Mono.empty();
                            });
                });
    }

    /**
     * Assign or revoke co-admin overlay for a member. Owner-only.
     *
     * @param roomId             room UUID
     * @param ownerInternalId    acting owner internal ID
     * @param targetInternalId   member whose overlay changes
     * @param roleValue          {@code admin} or {@code member}
     * @return Mono with broadcast payload on success
     */
    public Mono<RoomRoleUpdatedEvent> setRole(String roomId,
                                              String ownerInternalId,
                                              String targetInternalId,
                                              String roleValue) {
        RoomRole requestedRole = parseAssignableRole(roleValue);
        if (requestedRole == null) {
            return Mono.error(new IllegalArgumentException("INVALID_ROLE"));
        }
        return requireOwner(roomId, ownerInternalId)
                .flatMap(room -> {
                    if (isOwner(room, targetInternalId)) {
                        return Mono.error(new IllegalStateException("CANNOT_SET_ROLE_ON_OWNER"));
                    }
                    return roomMembersRepository.isMember(roomId, targetInternalId)
                            .flatMap(isMember -> {
                                if (!isMember) {
                                    return Mono.error(new IllegalArgumentException("NOT_MEMBER"));
                                }
                                Mono<Void> persist = requestedRole == RoomRole.ADMIN
                                        ? roomRolesRepository.setRole(
                                                roomId, targetInternalId, RoomRole.ADMIN.apiValue()).then()
                                        : roomRolesRepository.remove(roomId, targetInternalId).then();
                                return persist.thenReturn(RoomRoleUpdatedEvent.builder()
                                        .roomId(roomId)
                                        .targetInternalId(targetInternalId)
                                        .role(requestedRole.apiValue())
                                        .build());
                            });
                });
    }

    private static RoomRole parseAssignableRole(String roleValue) {
        if (RoomRole.ADMIN.apiValue().equals(roleValue)) {
            return RoomRole.ADMIN;
        }
        if (RoomRole.MEMBER.apiValue().equals(roleValue)) {
            return RoomRole.MEMBER;
        }
        return null;
    }

    /**
     * Transfer room ownership to an existing member. Does not trigger rekey.
     *
     * @param roomId                 room UUID
     * @param currentOwnerInternalId internal ID of the acting owner
     * @param newOwnerInternalId     internal ID of the member who becomes owner
     * @return Mono with the broadcast event payload on success
     */
    public Mono<RoomOwnershipTransferredEvent> transferOwnership(String roomId,
                                                                 String currentOwnerInternalId,
                                                                 String newOwnerInternalId) {
        if (currentOwnerInternalId.equals(newOwnerInternalId)) {
            return Mono.error(new IllegalStateException("CANNOT_TRANSFER_TO_SELF"));
        }
        return requireOwner(roomId, currentOwnerInternalId)
                .flatMap(room -> roomMembersRepository.isMember(roomId, newOwnerInternalId)
                        .flatMap(isMember -> {
                            if (!isMember) {
                                return Mono.error(new IllegalArgumentException("NOT_MEMBER"));
                            }
                            String previousOwnerInternalId = room.getOwnerInternalId();
                            return roomRepository.updateOwnerInternalId(roomId, newOwnerInternalId)
                                    .then(roomRolesRepository.setRole(
                                            roomId, previousOwnerInternalId, RoomRole.ADMIN.apiValue()))
                                    .then(roomRolesRepository.remove(roomId, newOwnerInternalId))
                                    .thenReturn(RoomOwnershipTransferredEvent.builder()
                                            .roomId(roomId)
                                            .newOwnerInternalId(newOwnerInternalId)
                                            .previousOwnerInternalId(previousOwnerInternalId)
                                            .build());
                        }));
    }

    /**
     * Whether {@code internalId} is the canonical owner of {@code room}.
     */
    public boolean isOwner(Room room, String internalId) {
        return StringUtils.hasText(room.getOwnerInternalId())
                && room.getOwnerInternalId().equals(internalId);
    }
}
