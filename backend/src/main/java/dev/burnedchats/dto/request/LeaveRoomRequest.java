package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for a room member (non-owner) to leave a room.
 *
 * <p>Sent via STOMP to {@code /app/room.leave} by any room member who is NOT the owner.
 * The room owner must use {@link BurnRoomRequest} ({@code /app/room.burn}) to destroy the room.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000"
 * }
 * }</pre>
 *
 * <p>When a member leaves:
 * <ul>
 *   <li>The member is removed from {@code room_members:{roomId}}</li>
 *   <li>The member's public key is deleted from {@code room_member_pubkey:{roomId}}</li>
 *   <li>A {@code LEFT_ROOM} event is sent to the leaving member</li>
 *   <li>A {@code ROOM_MEMBER_LEFT} event is sent to all remaining members so the owner can initiate rekey</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.event.RoomLeftEvent
 * @see dev.burnedchats.dto.event.RoomMemberLeftEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LeaveRoomRequest {

    /**
     * The room UUID to leave.
     *
     * <p>The caller must be a member of this room and must NOT be the owner.
     */
    @NotBlank(message = "Room ID is required")
    private String roomId;
}
