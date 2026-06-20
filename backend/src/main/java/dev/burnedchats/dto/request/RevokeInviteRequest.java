package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request payload for {@code /app/room.revokeInvite}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class RevokeInviteRequest {

    /** UUID of the room that owns the invite token. */
    @NotBlank
    private String roomId;

    /** Invite token string to revoke. */
    @NotBlank
    private String token;
}
