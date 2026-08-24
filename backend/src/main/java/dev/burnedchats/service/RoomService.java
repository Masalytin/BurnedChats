package dev.burnedchats.service;

import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.dto.event.RoomBurnedEvent;
import dev.burnedchats.dto.event.RoomOwnershipTransferredEvent;
import dev.burnedchats.dto.event.RoomRoleUpdatedEvent;
import dev.burnedchats.dto.event.RoomTtlUpdatedEvent;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Room;
import dev.burnedchats.model.RoomRole;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomBansRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomMutedRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.RoomBurnInboxRepository;
import dev.burnedchats.repository.RoomRolesRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Business logic for room lifecycle: creation, membership, roles, and deletion.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@SuppressWarnings("checkstyle:JavadocMethod")
public class RoomService {

    private static final String ROOM_BURNED_DESTINATION = "/queue/room-burned";

    private final RoomRepository roomRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final RoomRolesRepository roomRolesRepository;
    private final PasswordProofService passwordProofService;
    private final FileBurnService fileBurnService;
    private final InviteTokenRepository inviteTokenRepository;
    private final RoomKeysRepository roomKeysRepository;
    private final RoomMemberPublicKeyRepository memberPublicKeyRepository;
    private final RoomMessageRepository roomMessageRepository;
    private final RoomBansRepository roomBansRepository;
    private final RoomMutedRepository roomMutedRepository;
    private final StompUserMessenger stompUserMessenger;
    private final RoomBurnInboxRepository roomBurnInboxRepository;

    /**
     * Create a new room owned by {@code ownerInternalId}.
     *
     * @param ownerInternalId stable internal user id (from {@link dev.burnedchats.security.AppPrincipal})
     * @param ownerTgId       Telegram id when linked; null for wallet-only owners
     * @param request         validated create-room payload
     * @return Mono with the newly created {@link Room}
     */
    public Mono<Room> createRoom(String ownerInternalId, Long ownerTgId, CreateRoomRequest request) {
        String proposedRoomId = request.getRoomId();
        String roomId = StringUtils.hasText(proposedRoomId)
                ? proposedRoomId
                : UUID.randomUUID().toString();
        boolean hasPassword = request.getPasswordProof() != null && !request.getPasswordProof().isBlank();
        String proofHash = hasPassword ? passwordProofService.hashProof(request.getPasswordProof()) : "";
        String salt = request.getSalt() != null ? request.getSalt() : "";
        String saltStored = !salt.isBlank() ? salt : "";

        Room room = Room.builder()
                .id(roomId)
                .ownerInternalId(ownerInternalId)
                .ownerTgId(ownerTgId)
                .salt(saltStored)
                .passwordProofHash(proofHash)
                .joinMode(request.getJoinMode())
                .createdAt(Instant.now().toEpochMilli())
                .nameEncrypted(request.getNameEncrypted())
                .nameIv(request.getNameIv())
                .build();

        Mono<Void> ensureRoomIdAvailable = StringUtils.hasText(proposedRoomId)
                ? roomRepository.findById(roomId)
                .flatMap(existing -> Mono.error(new IllegalStateException("ROOM_ID_COLLISION")))
                .then()
                : Mono.empty();

        return ensureRoomIdAvailable
                .then(roomRepository.save(room))
                .then(roomMembersRepository.add(roomId, ownerInternalId))
                .thenReturn(room)
                .doOnSuccess(r -> LOG.info("Room created: id={}, ownerInternalId={}, joinMode={}",
                        r.getId(), ownerInternalId, r.getJoinMode()))
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
     * Owner-only: set managed room lifetime via relative seconds or absolute auto-burn instant.
     */
    public Mono<RoomTtlUpdatedEvent> setRoomTtl(String roomId,
                                                String ownerInternalId,
                                                Long ttlSeconds,
                                                Long autoBurnAtEpoch) {
        return requireOwner(roomId, ownerInternalId)
                .flatMap(room -> {
                    long resolvedAutoBurnAt = resolveAutoBurnAt(ttlSeconds, autoBurnAtEpoch);
                    return roomRepository.updateAutoBurnAt(roomId, resolvedAutoBurnAt)
                            .flatMap(ok -> {
                                if (!Boolean.TRUE.equals(ok)) {
                                    return Mono.error(new IllegalStateException("INTERNAL_ERROR"));
                                }
                                return Mono.just(RoomTtlUpdatedEvent.of(roomId, resolvedAutoBurnAt));
                            });
                });
    }

    /**
     * Burn a room as the owner (manual {@code BURN_ROOM}).
     */
    public Mono<List<String>> burnRoomAsOwner(String roomId, String ownerInternalId) {
        return requireOwner(roomId, ownerInternalId)
                .flatMap(room -> burnRoomCascade(roomId));
    }

    /**
     * Deterministic auto-burn when the dedicated trigger key expires. Idempotent if already burned.
     */
    public Mono<Void> executeAutoBurnAndNotify(String roomId) {
        return roomRepository.findById(roomId)
                .flatMap(room -> {
                    Long autoBurnAt = room.getAutoBurnAt();
                    if (autoBurnAt == null || autoBurnAt > System.currentTimeMillis()) {
                        return Mono.empty();
                    }
                    Long burnedBy = room.getOwnerTgId();
                    return burnRoomCascade(roomId)
                            .flatMap(members -> notifyRoomBurned(roomId, burnedBy, members));
                })
                .then();
    }

    private Mono<List<String>> burnRoomCascade(String roomId) {
        return roomMembersRepository.getMembers(roomId)
                .collectList()
                .flatMap(members ->
                        fileBurnService.deleteFilesForContext(roomId)
                                .then(Mono.when(
                                        roomRepository.cancelAutoBurnTrigger(roomId),
                                        roomRepository.delete(roomId),
                                        roomMembersRepository.deleteAll(roomId),
                                        inviteTokenRepository.deleteAllForRoom(roomId),
                                        roomKeysRepository.deleteRoom(roomId),
                                        memberPublicKeyRepository.deleteRoom(roomId),
                                        roomMessageRepository.deleteRoomMessages(roomId),
                                        roomBansRepository.deleteAll(roomId),
                                        roomMutedRepository.deleteAll(roomId),
                                        roomRolesRepository.deleteAll(roomId)
                                ))
                                .thenReturn(members))
                .doOnSuccess(members -> LOG.info("Room burned (cascade): roomId={}, memberCount={}",
                        roomId, members != null ? members.size() : 0));
    }

    public Mono<Void> notifyRoomBurned(String roomId, Long burnedBy, List<String> members) {
        RoomBurnedEvent event = RoomBurnedEvent.success(roomId, burnedBy);
        if (members == null || members.isEmpty()) {
            return Mono.empty();
        }
        long burnedAt = System.currentTimeMillis();
        return Flux.fromIterable(members)
                .filter(StringUtils::hasText)
                .flatMap(memberInternalId -> roomBurnInboxRepository
                        .recordBurn(memberInternalId, roomId, burnedAt)
                        .doOnSuccess(v -> stompUserMessenger.convertAndSendToInternalId(
                                memberInternalId,
                                ROOM_BURNED_DESTINATION,
                                event)))
                .then();
    }

    public Mono<List<dev.burnedchats.dto.event.RoomListEvent.BurnedNotice>> drainBurnInbox(String internalId) {
        return roomBurnInboxRepository.drain(internalId)
                .map(raw -> {
                    int sep = raw.indexOf('|');
                    if (sep <= 0) {
                        return dev.burnedchats.dto.event.RoomListEvent.BurnedNotice.builder()
                                .roomId(raw)
                                .burnedAt(null)
                                .build();
                    }
                    long at;
                    try {
                        at = Long.parseLong(raw.substring(sep + 1));
                    } catch (NumberFormatException e) {
                        at = 0L;
                    }
                    return dev.burnedchats.dto.event.RoomListEvent.BurnedNotice.builder()
                            .roomId(raw.substring(0, sep))
                            .burnedAt(at)
                            .build();
                })
                .collectList();
    }

    /**
     * Cascade after {@code room:{id}} hash TTL expiry (no dedicated auto-burn trigger).
     */
    public Mono<Void> executeHashExpiryCascade(String roomId) {
        return roomMembersRepository.getMembers(roomId)
                .collectList()
                .flatMap(members -> {
                    if (members == null || members.isEmpty()) {
                        return inviteTokenRepository.deleteAllForRoom(roomId).then();
                    }
                    return burnRoomCascade(roomId)
                            .flatMap(ids -> notifyRoomBurned(roomId, null, ids));
                });
    }

    private static long resolveAutoBurnAt(Long ttlSeconds, Long autoBurnAtEpoch) {
        if (autoBurnAtEpoch != null) {
            return autoBurnAtEpoch;
        }
        if (ttlSeconds != null) {
            if (ttlSeconds <= 0) {
                throw new IllegalArgumentException("INVALID_TTL");
            }
            return System.currentTimeMillis() + ttlSeconds * 1000L;
        }
        throw new IllegalArgumentException("TTL_OR_AUTOBURN_REQUIRED");
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
