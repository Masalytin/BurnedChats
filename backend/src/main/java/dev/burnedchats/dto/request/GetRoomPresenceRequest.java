package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request payload for {@code /app/room.getPresence}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class GetRoomPresenceRequest {

    /** UUID of the room to fetch presence for. */
    @NotBlank
    private String roomId;
}
