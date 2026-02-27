package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event DTO sent to all room members when a room is burned by the owner.
 *
 * <p>Broadcast via STOMP to {@code /user/queue/room-burned} for every member
 * (including the owner) when the room is destroyed.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000",
 *   "burnedBy": 123456789,
 *   "success": true
 * }
 * }</pre>
 *
 * <p>After receiving this event, clients MUST:
 * <ul>
 *   <li>Immediately destroy the room group key from keyStore</li>
 *   <li>Clear all room messages from memory</li>
 *   <li>Navigate away from the room chat view</li>
 *   <li>Remove the room from the local rooms list</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.request.BurnRoomRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomBurnedEvent {

    /**
     * The room UUID that was burned.
     */
    private String roomId;

    /**
     * Telegram user ID of the owner who initiated the burn.
     */
    private Long burnedBy;

    /**
     * Whether the burn operation was successful.
     */
    private boolean success;

    /**
     * Error code if the burn operation failed (null on success).
     *
     * <p>Possible error codes:
     * <ul>
     *   <li>ROOM_NOT_FOUND — room does not exist</li>
     *   <li>NOT_OWNER — caller is not the room owner</li>
     *   <li>INTERNAL_ERROR — server error</li>
     * </ul>
     */
    private String error;

    /**
     * Create a successful room burned event.
     *
     * @param roomId   the room UUID that was burned
     * @param burnedBy the owner's Telegram ID
     * @return successful room burned event
     */
    public static RoomBurnedEvent success(String roomId, Long burnedBy) {
        return RoomBurnedEvent.builder()
                .roomId(roomId)
                .burnedBy(burnedBy)
                .success(true)
                .build();
    }

    /**
     * Create a failed room burn event (sent only to the owner).
     *
     * @param roomId    the room UUID
     * @param errorCode the error code describing the failure
     * @return failed room burned event
     */
    public static RoomBurnedEvent error(String roomId, String errorCode) {
        return RoomBurnedEvent.builder()
                .roomId(roomId)
                .success(false)
                .error(errorCode)
                .build();
    }
}
