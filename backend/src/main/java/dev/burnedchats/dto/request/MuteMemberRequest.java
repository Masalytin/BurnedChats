package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for the room owner to mute or unmute a member.
 *
 * <p>Sent via STOMP to {@code /app/room.mute} and {@code /app/room.unmute}.
 * Only the room owner may invoke these endpoints.
 *
 * @see dev.burnedchats.handler.RoomHandler
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MuteMemberRequest {

    /** The room UUID. */
    @NotBlank(message = "Room ID is required")
    private String roomId;

    /** Internal ID of the member to mute or unmute. Must not be the owner. */
    @NotBlank(message = "Target internal ID is required")
    private String targetInternalId;
}
