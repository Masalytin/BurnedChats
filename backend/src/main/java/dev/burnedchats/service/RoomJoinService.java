package dev.burnedchats.service;

import dev.burnedchats.model.InviteToken;
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
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

import java.time.Instant;

/**
 * Business logic for room join flow: request, accept, and reject.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@SuppressWarnings("checkstyle:LineLength")
public class RoomJoinService {

    private final RoomRepository roomRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final RoomJoinRequestRepository joinRequestRepository;
    private final InviteTokenRepository inviteTokenRepository;
    private final InviteTokenService inviteTokenService;
    private final PasswordProofService passwordProofService;
    private final RoomMemberPublicKeyRepository memberPublicKeyRepository;

    public sealed interface JoinResult permits JoinResult.Approved, JoinResult.Pending {

        record Approved(String roomId, String ownerInternalId) implements JoinResult {}

        record Pending(RoomJoinRequest request, String ownerInternalId) implements JoinResult {}
    }

    public Mono<JoinResult> requestJoin(String senderInternalId,
                                        Long senderTgId,
                                        String senderUsername,
                                        String senderFirstName,
                                        String inviteToken,
                                        String passwordProof,
                                        String senderPublicKey) {
        return inviteTokenRepository.findByToken(inviteToken)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("INVALID_TOKEN")))
                .flatMap(token -> validateInviteToken(token).thenReturn(token))
                .flatMap(token -> roomRepository.findById(token.getRoomId())
                        .switchIfEmpty(Mono.error(new IllegalArgumentException("INVALID_TOKEN"))))
                .flatMap(room -> validatePasswordAndJoin(new JoinAttempt(
                        room, senderInternalId, senderTgId, senderUsername,
                        senderFirstName, inviteToken, passwordProof, senderPublicKey)));
    }

    private record JoinAttempt(
            Room room,
            String senderInternalId,
            Long senderTgId,
            String senderUsername,
            String senderFirstName,
            String inviteToken,
            String passwordProof,
            String senderPublicKey
    ) {
    }

    public Mono<Void> acceptJoin(String ownerInternalId, String roomId, String senderInternalId) {
        return loadRoomAsOwner(ownerInternalId, roomId)
                .then(joinRequestRepository.findByRoomAndSender(roomId, senderInternalId))
                .switchIfEmpty(Mono.error(new IllegalArgumentException("REQUEST_NOT_FOUND")))
                .flatMap(joinRequest -> roomMembersRepository.add(roomId, senderInternalId)
                        .then(memberPublicKeyRepository.put(roomId, senderInternalId, joinRequest.getPublicKey()))
                        .then(joinRequestRepository.remove(roomId, senderInternalId))
                        .then(roomRepository.extendTtl(roomId, RoomRepository.DEFAULT_TTL))
                        .then())
                .doOnSuccess(v -> LOG.info("Join accepted: roomId={}, senderInternalId={}, ownerInternalId={}",
                        roomId, senderInternalId, ownerInternalId));
    }

    public Mono<Void> rejectJoin(String ownerInternalId, String roomId, String senderInternalId) {
        return loadRoomAsOwner(ownerInternalId, roomId)
                .then(joinRequestRepository.exists(roomId, senderInternalId))
                .flatMap(exists -> {
                    if (!exists) {
                        return Mono.error(new IllegalArgumentException("REQUEST_NOT_FOUND"));
                    }
                    return joinRequestRepository.remove(roomId, senderInternalId);
                })
                .doOnSuccess(v -> LOG.info("Join rejected: roomId={}, senderInternalId={}, ownerInternalId={}",
                        roomId, senderInternalId, ownerInternalId));
    }

    private Mono<JoinResult> validatePasswordAndJoin(JoinAttempt attempt) {
        boolean roomHasPassword = attempt.room().getPasswordProofHash() != null
                && !attempt.room().getPasswordProofHash().isBlank();
        if (roomHasPassword) {
            if (attempt.passwordProof() == null || attempt.passwordProof().isBlank()) {
                return Mono.error(new SecurityException("WRONG_PASSWORD"));
            }
            if (!passwordProofService.verifyProof(attempt.passwordProof(),
                    attempt.room().getPasswordProofHash())) {
                return Mono.error(new SecurityException("WRONG_PASSWORD"));
            }
        }
        return roomMembersRepository.isMember(attempt.room().getId(), attempt.senderInternalId())
                .flatMap(alreadyMember -> {
                    if (alreadyMember) {
                        return Mono.error(new IllegalStateException("ALREADY_MEMBER"));
                    }
                    Mono<JoinResult> joinResult = attempt.room().getJoinMode() == Room.JoinMode.BY_PASSWORD
                            ? joinByPassword(attempt.room(), attempt.senderInternalId(),
                                    attempt.senderTgId(), attempt.senderPublicKey())
                            : joinByRequest(attempt.room(), attempt.senderInternalId(), attempt.senderTgId(),
                                    attempt.senderUsername(), attempt.senderFirstName(), attempt.senderPublicKey());
                    return joinResult.flatMap(result ->
                            consumeInviteUse(attempt.inviteToken()).thenReturn(result));
                });
    }

    private Mono<Void> validateInviteToken(InviteToken token) {
        if (token.getExpiresAt() < Instant.now().toEpochMilli()) {
            return inviteTokenRepository.deleteTokenAndIndex(token.getToken(), token.getRoomId())
                    .then(Mono.error(new IllegalArgumentException("INVITE_EXPIRED")));
        }
        if (InviteTokenService.isExhausted(token)) {
            return inviteTokenRepository.deleteTokenAndIndex(token.getToken(), token.getRoomId())
                    .then(Mono.error(new IllegalArgumentException("INVITE_EXHAUSTED")));
        }
        return Mono.empty();
    }

    private Mono<Void> consumeInviteUse(String inviteToken) {
        return inviteTokenService.consumeInviteUse(inviteToken);
    }

    private Mono<JoinResult> joinByPassword(Room room, String senderInternalId, Long senderTgId,
                                            String senderPublicKey) {
        return roomMembersRepository.add(room.getId(), senderInternalId)
                .then(memberPublicKeyRepository.put(room.getId(), senderInternalId, senderPublicKey))
                .then(roomRepository.extendTtl(room.getId(), RoomRepository.DEFAULT_TTL))
                .thenReturn((JoinResult) new JoinResult.Approved(
                        room.getId(), ownerInternalIdOrEmpty(room)))
                .doOnSuccess(r -> LOG.info("User {} joined room {} directly (BY_PASSWORD)",
                        senderInternalId, room.getId()));
    }

    private Mono<JoinResult> joinByRequest(Room room, String senderInternalId, Long senderTgId,
                                           String senderUsername, String senderFirstName,
                                           String senderPublicKey) {
        return joinRequestRepository.exists(room.getId(), senderInternalId)
                .flatMap(alreadyRequested -> {
                    if (alreadyRequested) {
                        return Mono.error(new IllegalStateException("REQUEST_PENDING"));
                    }
                    RoomJoinRequest request = RoomJoinRequest.builder()
                            .roomId(room.getId())
                            .senderInternalId(senderInternalId)
                            .senderTgId(senderTgId)
                            .username(senderUsername)
                            .firstName(senderFirstName)
                            .createdAt(Instant.now().toEpochMilli())
                            .publicKey(senderPublicKey)
                            .build();
                    return joinRequestRepository.save(request)
                            .thenReturn((JoinResult) new JoinResult.Pending(
                                    request, ownerInternalIdOrEmpty(room)))
                            .doOnSuccess(r -> LOG.info(
                                    "Join request created: roomId={}, senderInternalId={}, ownerInternalId={}",
                                    room.getId(), senderInternalId, ownerInternalIdOrEmpty(room)));
                });
    }

    private static String ownerInternalIdOrEmpty(Room room) {
        return room.getOwnerInternalId() != null ? room.getOwnerInternalId() : "";
    }

    private Mono<Room> loadRoomAsOwner(String ownerInternalId, String roomId) {
        return roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!StringUtils.hasText(room.getOwnerInternalId())
                            || !room.getOwnerInternalId().equals(ownerInternalId)) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return Mono.just(room);
                });
    }
}
