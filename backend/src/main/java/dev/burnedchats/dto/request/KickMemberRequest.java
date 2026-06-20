package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for the room owner to kick a member from the room.
 *
 * <p>Sent via STOMP to {@code /app/room.kick}. Only the room owner may invoke this endpoint.
 * The owner cannot kick themselves or another owner.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "roomId": "550e8400-e29b-41d4-a716-446655440000",
 *   "targetInternalId": "tg:987654321"
 * }
 * }</pre>
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.event.RoomMemberKickedEvent
 * @see dev.burnedchats.dto.event.RoomMemberRemovedEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class KickMemberRequest {

    /** The room UUID from which to remove the member. */
    @NotBlank(message = "Room ID is required")
    private String roomId;

    /** Internal ID of the member to kick. Must not be the owner or the caller. */
    @NotBlank(message = "Target internal ID is required")
    private String targetInternalId;
}
