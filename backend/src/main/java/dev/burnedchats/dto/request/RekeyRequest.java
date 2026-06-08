package dev.burnedchats.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

/**
 * Payload for {@code /app/room.rekey} — the room owner sends a new set of encrypted
 * group-key bundles for all remaining members after a member has left.
 *
 * <p>Flow (P2-3.2.2):
 * <ol>
 *   <li>A member leaves (or is removed by the owner).</li>
 *   <li>Owner generates a new group key (epoch = current + 1).</li>
 *   <li>Owner wraps the new key for each remaining member (ECIES-like, one bundle per member).</li>
 *   <li>Owner sends this request with all bundles in one batch.</li>
 *   <li>Server stores each bundle, updates the epoch, and delivers to each member.</li>
 * </ol>
 */
@Data
public class RekeyRequest {

    /** UUID of the room. */
    @NotBlank
    private String roomId;

    /** New epoch number (must equal current epoch + 1). */
    @NotNull
    private Integer newEpoch;

    /** Encrypted key bundles — one per remaining member. Must not be empty. */
    @NotEmpty
    @Valid
    private List<BundleItem> bundles;

    /**
     * Encrypted group-key bundle for one room member.
     */
    @Data
    public static class BundleItem {

        /** Internal ID of the recipient. */
        @NotBlank
        private String recipientInternalId;

        /** Base64-encoded ephemeral ECDH P-256 public key (65 bytes raw). */
        @NotBlank
        @Size(max = 256)
        @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "ephemeralPublicKey must be Base64")
        private String ephemeralPublicKey;

        /** Base64-encoded AES-256-GCM ciphertext of the wrapped group key. */
        @NotBlank
        @Size(max = 256)
        @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "encryptedKey must be Base64")
        private String encryptedKey;

        /** Base64-encoded 12-byte AES-GCM IV. */
        @NotBlank
        @Size(max = 32)
        @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "iv must be Base64")
        private String iv;
    }
}
