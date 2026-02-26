package dev.burnedchats.dto.request;

import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for {@code /app/room.getMyRooms}.
 *
 * <p>No payload fields are needed — the user is identified from the authenticated principal.
 */
@Data
@NoArgsConstructor
public class GetMyRoomsRequest {
}
