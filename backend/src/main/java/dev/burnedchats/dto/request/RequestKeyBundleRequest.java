package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * Payload for {@code /app/room.requestKeyBundle} — an existing room member requests
 * re-delivery of the group key after losing in-memory crypto state (e.g. app restart).
 *
 * <p>The member provides a fresh ECDH public key so the room owner can wrap the current
 * group key for this member. The server validates membership, updates the stored public
 * key, and notifies the owner to deliver a new KEY_BUNDLE.
 */
@Data
public class RequestKeyBundleRequest {

    @NotBlank
    private String roomId;

    /**
     * Fresh ECDH P-256 public key — Base64 SPKI-encoded.
     * Replaces the member's previously stored public key so the owner can
     * wrap the group key with the new key.
     */
    @NotBlank
    @Size(max = 256)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "publicKey must be Base64")
    private String publicKey;
}
