package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for the room owner to assign or revoke co-admin overlay role.
 *
 * <p>Sent via STOMP to {@code /app/room.setRole}. Only the current owner may invoke this
 * endpoint. The {@code owner} role cannot be assigned here — use
 * {@link TransferOwnershipRequest} instead.
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.event.RoomRoleUpdatedEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SetRoleRequest {

    /** The room UUID. */
    @NotBlank(message = "Room ID is required")
    private String roomId;

    /** Internal ID of the target member whose overlay role changes. */
    @NotBlank(message = "Target internal ID is required")
    private String targetInternalId;

    /** Overlay role to assign: {@code admin} or {@code member} (implicit member removes overlay). */
    @NotBlank(message = "Role is required")
    @Pattern(regexp = "admin|member", message = "Role must be admin or member")
    private String role;
}
