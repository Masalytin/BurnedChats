package dev.burnedchats.service;

import dev.burnedchats.model.Room;
import dev.burnedchats.model.RoomJoinRequest;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Instant;

/**
 * Business logic for room join flow: request, accept, and reject.
 *
 * <h2>Flow overview</h2>
 * <ul>
 *   <li><b>BY_PASSWORD mode</b>: user submits proof → verified → added to {@code room_members} immediately.</li>
 *   <li><b>BY_REQUEST mode</b>: user submits proof → verified → join request stored in Redis →
 *       owner is notified via STOMP → owner calls accept or reject.</li>
 * </ul>
 *
 * <p>Security contract: plaintext password is never received. Only the PBKDF2 proof
 * (pre-derived on the client) is accepted and verified via {@link PasswordProofService}.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RoomJoinService {

    private final RoomRepository roomRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final RoomJoinRequestRepository joinRequestRepository;
    private final InviteTokenRepository inviteTokenRepository;
    private final PasswordProofService passwordProofService;
    private final RoomMemberPublicKeyRepository memberPublicKeyRepository;

    // -------------------------------------------------------------------------
    // Sealed result types for requestJoin
    // -------------------------------------------------------------------------

    /**
     * Result of {@link #requestJoin} — either the user joined immediately or a request is pending.
     */
    public sealed interface JoinResult permits JoinResult.Approved, JoinResult.Pending {

        /** User was added to the room immediately (BY_PASSWORD mode). */
        record Approved(String roomId, Long ownerTgId) implements JoinResult {}

        /**
         * A join request was created; the owner must accept it (BY_REQUEST mode).
         * Contains the request so the handler can notify the owner.
         */
        record Pending(RoomJoinRequest request, Long ownerTgId) implements JoinResult {}
    }

    /**
     * Process a join request from a user.
     *
     * <ol>
     *   <li>Resolve the invite token → roomId.</li>
     *   <li>Load the room and verify the password proof.</li>
     *   <li>Reject if already a member.</li>
     *   <li>{@code BY_PASSWORD}: add to {@code room_members}, return {@link JoinResult.Approved}.</li>
     *   <li>{@code BY_REQUEST}: create {@link RoomJoinRequest}, return {@link JoinResult.Pending}.</li>
     * </ol>
     *
     * @param senderTgId      Telegram ID of the requesting user
     * @param senderUsername  Telegram username (may be null)
     * @param senderFirstName first name from initData
     * @param inviteToken     token from the deep link
     * @param passwordProof   PBKDF2 proof derived client-side; may be null when the room has no password (BY_REQUEST)
     * @param senderPublicKey Base64 SPKI ECDH public key of the sender (may be null)
     * @return Mono with {@link JoinResult}; errors signal with descriptive messages used as error codes
     */
    public Mono<JoinResult> requestJoin(Long senderTgId,
                                        String senderUsername,
                                        String senderFirstName,
                                        String inviteToken,
                                        String passwordProof,
                                        String senderPublicKey) {
        return inviteTokenRepository.findByToken(inviteToken)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("INVALID_TOKEN")))
                .flatMap(token -> {
                    if (token.getExpiresAt() < Instant.now().toEpochMilli()) {
                        return Mono.error(new IllegalArgumentException("INVITE_EXPIRED"));
                    }
                    return roomRepository.findById(token.getRoomId())
                            .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")));
                })
                .flatMap(room -> {
                    boolean roomHasPassword = room.getPasswordProofHash() != null
                            && !room.getPasswordProofHash().isBlank();
                    if (roomHasPassword) {
                        if (passwordProof == null || passwordProof.isBlank()) {
                            return Mono.error(new SecurityException("WRONG_PASSWORD"));
                        }
                        if (!passwordProofService.verifyProof(passwordProof, room.getPasswordProofHash())) {
                            return Mono.error(new SecurityException("WRONG_PASSWORD"));
                        }
                    }
                    return roomMembersRepository.isMember(room.getId(), senderTgId)
                            .flatMap(alreadyMember -> {
                                if (alreadyMember) {
                                    return Mono.error(new IllegalStateException("ALREADY_MEMBER"));
                                }
                                if (room.getJoinMode() == Room.JoinMode.BY_PASSWORD) {
                                    return joinByPassword(room, senderTgId, senderPublicKey);
                                } else {
                                    return joinByRequest(room, senderTgId, senderUsername,
                                            senderFirstName, senderPublicKey);
                                }
                            });
                });
    }

    /**
     * Accept a pending join request (owner only).
     *
     * <p>Adds the requester to {@code room_members}, stores their public key,
     * and removes the join request.
     *
     * @param ownerTgId  Telegram ID of the room owner (must match room's ownerTgId)
     * @param roomId     UUID of the room
     * @param senderTgId Telegram ID of the user to accept
     * @return Mono completing on success; errors for NOT_OWNER / ROOM_NOT_FOUND / REQUEST_NOT_FOUND
     */
    public Mono<Void> acceptJoin(Long ownerTgId, String roomId, Long senderTgId) {
        return loadRoomAsOwner(ownerTgId, roomId)
                .then(joinRequestRepository.findByRoomAndSender(roomId, senderTgId))
                .switchIfEmpty(Mono.error(new IllegalArgumentException("REQUEST_NOT_FOUND")))
                .flatMap(joinRequest -> roomMembersRepository.add(roomId, senderTgId)
                        .then(memberPublicKeyRepository.put(roomId, senderTgId, joinRequest.getPublicKey()))
                        .then(joinRequestRepository.remove(roomId, senderTgId))
                        .then(roomRepository.extendTtl(roomId, RoomRepository.DEFAULT_TTL))
                        .then()
                )
                .doOnSuccess(v -> LOG.info("Join accepted: roomId={}, senderTgId={}, ownerTgId={}",
                        roomId, senderTgId, ownerTgId));
    }

    /**
     * Reject a pending join request (owner only).
     *
     * <p>Removes the request without adding the requester to the room.
     *
     * @param ownerTgId  Telegram ID of the room owner
     * @param roomId     UUID of the room
     * @param senderTgId Telegram ID of the user to reject
     * @return Mono completing on success; errors for NOT_OWNER / ROOM_NOT_FOUND / REQUEST_NOT_FOUND
     */
    public Mono<Void> rejectJoin(Long ownerTgId, String roomId, Long senderTgId) {
        return loadRoomAsOwner(ownerTgId, roomId)
                .then(joinRequestRepository.exists(roomId, senderTgId))
                .flatMap(exists -> {
                    if (!exists) {
                        return Mono.error(new IllegalArgumentException("REQUEST_NOT_FOUND"));
                    }
                    return joinRequestRepository.remove(roomId, senderTgId);
                })
                .doOnSuccess(v -> LOG.info("Join rejected: roomId={}, senderTgId={}, ownerTgId={}",
                        roomId, senderTgId, ownerTgId));
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private Mono<JoinResult> joinByPassword(Room room, Long senderTgId, String senderPublicKey) {
        return roomMembersRepository.add(room.getId(), senderTgId)
                .then(memberPublicKeyRepository.put(room.getId(), senderTgId, senderPublicKey))
                .then(roomRepository.extendTtl(room.getId(), RoomRepository.DEFAULT_TTL))
                .thenReturn((JoinResult) new JoinResult.Approved(room.getId(), room.getOwnerTgId()))
                .doOnSuccess(r -> LOG.info("User {} joined room {} directly (BY_PASSWORD)",
                        senderTgId, room.getId()));
    }

    private Mono<JoinResult> joinByRequest(Room room, Long senderTgId,
                                            String senderUsername, String senderFirstName,
                                            String senderPublicKey) {
        return joinRequestRepository.exists(room.getId(), senderTgId)
                .flatMap(alreadyRequested -> {
                    if (alreadyRequested) {
                        return Mono.error(new IllegalStateException("REQUEST_PENDING"));
                    }
                    RoomJoinRequest request = RoomJoinRequest.builder()
                            .roomId(room.getId())
                            .senderTgId(senderTgId)
                            .username(senderUsername)
                            .firstName(senderFirstName)
                            .createdAt(Instant.now().toEpochMilli())
                            .publicKey(senderPublicKey)
                            .build();
                    return joinRequestRepository.save(request)
                            .thenReturn((JoinResult) new JoinResult.Pending(request, room.getOwnerTgId()))
                            .doOnSuccess(r -> LOG.info("Join request created: roomId={}, senderTgId={}, ownerTgId={}",
                                    room.getId(), senderTgId, room.getOwnerTgId()));
                });
    }

    /**
     * Load a room and verify that {@code ownerTgId} is its owner.
     *
     * @return Mono with the {@link Room}, or error signals for ROOM_NOT_FOUND / NOT_OWNER
     */
    private Mono<Room> loadRoomAsOwner(Long ownerTgId, String roomId) {
        return roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!room.getOwnerTgId().equals(ownerTgId)) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return Mono.just(room);
                });
    }
}
