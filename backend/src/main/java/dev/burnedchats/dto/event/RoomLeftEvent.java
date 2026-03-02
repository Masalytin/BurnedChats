package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event DTO sent to a room member after they successfully leave a room.
 *
 * <p>Sent via STOMP to {@code /user/queue/room-left} for the leaving member only.
 *
 * <p>Example payload (success):
 * <pre>{@code
 * {
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000",
 *   "success": true
 * }
 * }</pre>
 *
 * <p>After receiving a successful event, the client MUST:
 * <ul>
 *   <li>Destroy the room group key from keyStore (burnGroupKey)</li>
 *   <li>Clear all room messages from memory</li>
 *   <li>Navigate away from the room chat view to the rooms list</li>
 *   <li>Remove the room from the local rooms list</li>
 * </ul>
 *
 * <p>Possible error codes:
 * <ul>
 *   <li>ROOM_NOT_FOUND — room does not exist</li>
 *   <li>OWNER_CANNOT_LEAVE — the owner must burn the room instead</li>
 *   <li>NOT_MEMBER — caller is not a member of this room</li>
 *   <li>INTERNAL_ERROR — server error</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.request.LeaveRoomRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomLeftEvent {

    /** The room UUID that was left. */
    private String roomId;

    /** Whether the leave operation was successful. */
    private boolean success;

    /** Error code if the leave operation failed (null on success). */
    private String error;

    public static RoomLeftEvent success(String roomId) {
        return RoomLeftEvent.builder()
                .roomId(roomId)
                .success(true)
                .build();
    }

    public static RoomLeftEvent error(String roomId, String errorCode) {
        return RoomLeftEvent.builder()
                .roomId(roomId)
                .success(false)
                .error(errorCode)
                .build();
    }
}
