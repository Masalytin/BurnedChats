package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * Payload for {@code /app/room.sendKeyBundle} — the room owner sends an encrypted
 * group-key bundle to a newly accepted member.
 *
 * <p>Flow (P2-3.2.1):
 * <ol>
 *   <li>Owner accepts a join request (ACCEPT_ROOM_JOIN).</li>
 *   <li>Owner wraps the current group key for the new member using ECIES-like scheme.</li>
 *   <li>Owner sends this request; the server stores the bundle and relays it to the recipient.</li>
 * </ol>
 *
 * <p>All bundle fields are opaque Base64 blobs — the server never decrypts them.
 */
@Data
public class SendKeyBundleRequest {

    /** UUID of the room. */
    @NotBlank
    private String roomId;

    /** Internal ID of the recipient (the newly accepted member). */
    @NotBlank
    private String recipientInternalId;

    /** Current key epoch (typically 0 for a fresh room; incremented after rekey). */
    @NotNull
    private Integer epoch;

    /** Base64-encoded ephemeral ECDH P-256 public key (65 bytes raw, ~88 chars Base64). */
    @NotBlank
    @Size(max = 256)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "ephemeralPublicKey must be Base64")
    private String ephemeralPublicKey;

    /** Base64-encoded AES-256-GCM ciphertext of the wrapped group key (48 bytes, ~64 chars Base64). */
    @NotBlank
    @Size(max = 256)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "encryptedKey must be Base64")
    private String encryptedKey;

    /** Base64-encoded 12-byte AES-GCM IV (~16 chars Base64). */
    @NotBlank
    @Size(max = 32)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "iv must be Base64")
    private String iv;
}
