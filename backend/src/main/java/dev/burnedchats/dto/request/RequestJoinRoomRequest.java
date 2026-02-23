package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * Payload for the STOMP {@code /app/room.requestJoin} destination.
 *
 * <p>The client provides the invite token (from the deep link) and a PBKDF2 proof
 * derived client-side using the room's stored salt. The plaintext password never leaves the device.
 *
 * <p>Server behaviour:
 * <ul>
 *   <li>Resolves the room from the invite token.</li>
 *   <li>Verifies the password proof against the room's stored hash.</li>
 *   <li>If {@code joinMode == BY_PASSWORD} — adds the user to {@code room_members} immediately.</li>
 *   <li>If {@code joinMode == BY_REQUEST} — creates a {@link dev.burnedchats.model.RoomJoinRequest}
 *       and notifies the owner.</li>
 * </ul>
 */
@Data
public class RequestJoinRoomRequest {

    /**
     * Invite token from the Telegram deep link ({@code startapp=invite_{token}}).
     */
    @NotBlank
    @Size(min = 32, max = 128)
    private String inviteToken;

    /**
     * PBKDF2 proof derived by the client: PBKDF2WithHmacSHA256(password, roomSalt, 200_000, 256 bits).
     * Base64-encoded, 32 bytes.
     */
    @NotBlank
    @Size(min = 43, max = 44)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "passwordProof must be Base64")
    private String passwordProof;
}
