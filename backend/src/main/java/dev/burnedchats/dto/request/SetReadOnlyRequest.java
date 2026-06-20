package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for the room owner to toggle read-only mode.
 *
 * <p>Sent via STOMP to {@code /app/room.setReadOnly}. Only the room owner may invoke this endpoint.
 *
 * @see dev.burnedchats.handler.RoomHandler
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SetReadOnlyRequest {

    /** The room UUID. */
    @NotBlank(message = "Room ID is required")
    private String roomId;

    /** When {@code true}, only the owner may send messages. */
    @NotNull(message = "readOnly flag is required")
    private Boolean readOnly;
}
