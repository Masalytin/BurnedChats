package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event DTO broadcast to all remaining room members when a member leaves.
 *
 * <p>Sent via STOMP to {@code /user/queue/room-member-left} for every remaining member
 * (including the owner) after a non-owner member successfully leaves the room.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000",
 *   "leftTgId": 987654321
 * }
 * }</pre>
 *
 * <p>On receipt, the room owner MUST initiate a group key rotation (rekey) to ensure
 * the departed member can no longer decrypt future messages:
 * <ol>
 *   <li>Send {@code GET_MEMBER_PUBKEYS} to retrieve remaining members' public keys.</li>
 *   <li>Generate a new AES-256-GCM group key.</li>
 *   <li>Wrap the key for each remaining member and send {@code REKEY}.</li>
 * </ol>
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.request.LeaveRoomRequest
 * @see RoomRekeyEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMemberLeftEvent {

    /** The room UUID from which the member left. */
    private String roomId;

    /** Internal ID of the member who left. */
    private String leftInternalId;

    /**
     * Telegram ID when linked; null for wallet-only members.
     *
     * @deprecated Prefer {@link #leftInternalId}.
     */
    @Deprecated
    private Long leftTgId;

    public static RoomMemberLeftEvent of(String roomId, String leftInternalId, Long leftTgId) {
        return RoomMemberLeftEvent.builder()
                .roomId(roomId)
                .leftInternalId(leftInternalId)
                .leftTgId(leftTgId)
                .build();
    }
}
