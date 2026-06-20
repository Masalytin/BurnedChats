package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for the room owner to set managed room lifetime / auto-burn time.
 *
 * <p>Sent via STOMP to {@code /app/room.setTtl}. Provide either {@code ttlSeconds} or
 * {@code autoBurnAt} (epoch ms). Owner-only.
 *
 * @see dev.burnedchats.handler.RoomHandler
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SetRoomTtlRequest {

    /** The room UUID. */
    @NotBlank(message = "Room ID is required")
    private String roomId;

    /** Relative lifetime in seconds from now (mutually exclusive preference with {@code autoBurnAt}). */
    private Long ttlSeconds;

    /** Absolute auto-burn instant as Unix epoch milliseconds. */
    private Long autoBurnAt;
}
