package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Broadcast event sent to all remaining room members when the group key is rotated.
 *
 * <p>Destination: {@code /user/queue/room-rekey} (sent individually to each member).
 *
 * <p>Triggered by {@code /app/room.rekey} — the owner initiates a rekey after a member leaves.
 * Each member should also receive a {@link KeyBundleEvent} with their new encrypted group key.
 * This event serves as an explicit signal to stop using the old key epoch.
 *
 * <p>On receipt, clients must:
 * <ol>
 *   <li>Mark the old epoch as invalid (stop decrypting with the old key).</li>
 *   <li>Wait for the corresponding {@link KeyBundleEvent} for the new epoch.</li>
 *   <li>After receiving the bundle — store the new key and resume encryption/decryption.</li>
 * </ol>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomRekeyEvent {

    /** UUID of the room. */
    private String roomId;

    /** The new key epoch that all subsequent messages must use. */
    private int newEpoch;

    public static RoomRekeyEvent of(String roomId, int newEpoch) {
        return RoomRekeyEvent.builder()
                .roomId(roomId)
                .newEpoch(newEpoch)
                .build();
    }
}
