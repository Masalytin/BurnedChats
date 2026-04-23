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
 *
 * <p>Security contract: this service never receives the plaintext password.
 * It accepts only the pre-derived {@code salt} and {@code passwordProof} from the client.
 * The proof is hashed via {@link PasswordProofService#hashProof} before storage.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RoomService {

    private final RoomRepository roomRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final PasswordProofService passwordProofService;

    /**
     * Create a new room.
     *
     * <ol>
     *   <li>Generate a UUID v4 for the room.</li>
     *   <li>If password proof is supplied: hash it and store with salt; otherwise store empty
     *   (BY_REQUEST without password).</li>
     *   <li>Persist the room in Redis with a 30-day TTL.</li>
     *   <li>Add the owner as the first member of {@code room_members:{roomId}}.</li>
     * </ol>
     *
     * @param ownerTgId      Telegram ID of the room owner
     * @param salt           KDF salt (Base64), or null when creating a room without password (BY_REQUEST)
     * @param passwordProof  PBKDF2 proof (Base64), or null when room has no password
     * @param joinMode       how participants enter the room
     * @param nameEncrypted  optional encrypted room name (may be null)
     * @return Mono with the newly created {@link Room}
     */
    public Mono<Room> createRoom(Long ownerTgId,
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
                .ownerTgId(ownerTgId)
                .salt(saltStored)
                .passwordProofHash(proofHash)
                .joinMode(joinMode)
                .createdAt(Instant.now().toEpochMilli())
                .nameEncrypted(nameEncrypted)
                .build();

        return roomRepository.save(room)
                .then(roomMembersRepository.add(roomId, ownerTgId))
                .thenReturn(room)
                .doOnSuccess(r -> LOG.info("Room created: id={}, owner={}, joinMode={}",
                        r.getId(), ownerTgId, joinMode))
                .onErrorResume(e -> {
                    LOG.error("Failed to create room for owner {}: {}", ownerTgId, e.getMessage());
                    return Mono.error(e);
                });
    }

    /**
     * Delete a room and its members set from Redis.
     *
     * @param roomId the room UUID
     * @return Mono completing when deletion is done
     */
    public Mono<Void> deleteRoom(String roomId) {
        return Mono.when(
                roomRepository.delete(roomId),
                roomMembersRepository.deleteAll(roomId)
        ).doOnSuccess(v -> LOG.info("Room deleted: {}", roomId));
    }

    /**
     * Extend the TTL of a room (called on message activity).
     *
     * @param roomId the room UUID
     * @return Mono completing when TTL is extended
     */
    public Mono<Void> extendTtl(String roomId) {
        return roomRepository.extendTtl(roomId, RoomRepository.DEFAULT_TTL)
                .then();
    }
}
