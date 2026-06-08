package dev.burnedchats.service;

import dev.burnedchats.model.Room;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.UUID;

/**
 * Business logic for room lifecycle: creation, membership, and deletion.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@SuppressWarnings("checkstyle:JavadocMethod")
public class RoomService {

    private final RoomRepository roomRepository;
    private final RoomMembersRepository roomMembersRepository;
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
}
