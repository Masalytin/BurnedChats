package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for burning (destroying) a room and all its data.
 *
 * <p>Sent by the room owner via STOMP to {@code /app/room.burn} to permanently
 * destroy the room and all associated data.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000"
 * }
 * }</pre>
 *
 * <p>When burned:
 * <ul>
 *   <li>The room data is deleted from Redis</li>
 *   <li>All room members are removed from membership sets</li>
 *   <li>All invite tokens for the room are deleted</li>
 *   <li>All encrypted group key bundles are deleted</li>
 *   <li>All room messages are deleted</li>
 *   <li>All room member public keys are deleted</li>
 *   <li>All members receive a ROOM_BURNED event</li>
 * </ul>
 *
 * <p>This operation is irreversible and can only be initiated by the room owner.
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.event.RoomBurnedEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BurnRoomRequest {

    /**
     * The room UUID to burn.
     *
     * <p>The current user must be the owner of this room.
     */
    @NotBlank(message = "Room ID is required")
    private String roomId;
}
