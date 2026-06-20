package dev.burnedchats.dto.request;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for the room owner to set per-room message auto-destruction timer.
 *
 * <p>Sent via STOMP to {@code /app/room.setMessageTtl}. {@code messageTtlSeconds} of {@code 0}
 * disables per-message pruning (global offline-queue TTL applies). Owner-only.
 *
 * @see dev.burnedchats.handler.RoomHandler
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SetMessageTtlRequest {

    /** The room UUID. */
    @NotBlank(message = "Room ID is required")
    private String roomId;

    /** Message lifetime in seconds; {@code 0} disables per-room pruning. */
    @NotNull(message = "Message TTL is required")
    @Min(value = 0, message = "Message TTL must be non-negative")
    private Integer messageTtlSeconds;
}
