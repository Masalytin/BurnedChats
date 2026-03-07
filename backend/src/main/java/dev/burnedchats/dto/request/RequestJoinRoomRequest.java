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
     * Base64-encoded, 32 bytes. Required when the room has a password; optional (may be null) when
     * the room has no password (BY_REQUEST without password).
     */
    @Size(min = 43, max = 44)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "passwordProof must be Base64")
    private String passwordProof;

    /**
     * ECDH P-256 public key of the requesting user — Base64 SPKI-encoded (~124 bytes ≈ 165 chars).
     * Provided so that the room owner can wrap the group key for this member after accepting.
     * Optional: if absent the owner cannot perform key exchange client-side until the member
     * re-requests their key bundle via GET_KEY_BUNDLE (P2-3.2.3).
     */
    @Size(max = 256)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "publicKey must be Base64")
    private String publicKey;
}
