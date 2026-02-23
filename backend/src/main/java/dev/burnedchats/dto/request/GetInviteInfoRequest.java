package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * Request payload for {@code /app/room.getInviteInfo}.
 *
 * <p>Allows the client to fetch the KDF salt and join mode for a room identified
 * by its invite token. The client uses the returned salt to derive the PBKDF2 proof
 * before calling {@code /app/room.requestJoin}.
 */
@Data
public class GetInviteInfoRequest {

    @NotBlank
    @Size(min = 32, max = 128)
    private String inviteToken;
}
