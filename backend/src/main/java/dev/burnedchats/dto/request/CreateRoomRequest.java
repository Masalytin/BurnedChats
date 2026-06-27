package dev.burnedchats.dto.request;

import dev.burnedchats.model.Room;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;
import org.springframework.util.StringUtils;

/**
 * Payload for the STOMP {@code /app/room.create} destination.
 *
 * <p>The client derives the password proof client-side (PBKDF2/Web Crypto API)
 * and sends only {@code salt + proof}. The server never sees the plaintext password.
 *
 * <p>When {@code joinMode == BY_REQUEST}, password is optional: {@code salt} and
 * {@code passwordProof} may be null (room without password, join by request only).
 * When {@code joinMode == BY_PASSWORD}, both are required.
 */
@Data
public class CreateRoomRequest {

    /**
     * KDF salt — Base64, 16+ bytes, generated client-side. Required when {@code joinMode == BY_PASSWORD};
     * optional (may be null) when {@code joinMode == BY_REQUEST} for a room without password.
     */
    @Size(min = 24, max = 64)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "salt must be Base64")
    private String salt;

    /**
     * PBKDF2 proof — Base64, 32 bytes (256 bits). Required when {@code joinMode == BY_PASSWORD};
     * optional when {@code joinMode == BY_REQUEST} (room without password).
     */
    @Size(min = 43, max = 44)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "passwordProof must be Base64")
    private String passwordProof;

    /**
     * Room join mode: {@code BY_PASSWORD} or {@code BY_REQUEST}.
     */
    @NotNull
    private Room.JoinMode joinMode;

    /**
     * Validates that salt and passwordProof are present when joinMode is BY_PASSWORD.
     */
    @AssertTrue(message = "salt and passwordProof are required when joinMode is BY_PASSWORD")
    public boolean isPasswordFieldsValid() {
        if (joinMode == null || joinMode != Room.JoinMode.BY_PASSWORD) {
            return true;
        }
        return salt != null && !salt.isBlank() && passwordProof != null && !passwordProof.isBlank();
    }

    /**
     * Optional client-proposed room UUID (v4). Required when {@code nameEncrypted} is set so the
     * client can bind the name ciphertext with {@code roomId} as AES-GCM AAD before create.
     * When omitted, the server generates a new UUID.
     */
    @Size(max = 36)
    @Pattern(regexp = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
            message = "roomId must be a UUID")
    private String roomId;

    /**
     * Optional encrypted room name.
     * If provided, it must be an opaque Base64 ciphertext encrypted client-side.
     */
    @Size(max = 512)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "nameEncrypted must be Base64")
    private String nameEncrypted;

    /**
     * Base64-encoded 12-byte AES-GCM IV for {@link #nameEncrypted}.
     * Must be supplied together with {@code nameEncrypted}.
     */
    @Size(max = 32)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "nameIv must be Base64")
    private String nameIv;

    @AssertTrue(message = "nameEncrypted and nameIv must both be present or both omitted")
    public boolean isNameFieldsConsistent() {
        boolean hasEncrypted = StringUtils.hasText(nameEncrypted);
        boolean hasIv = StringUtils.hasText(nameIv);
        return hasEncrypted == hasIv;
    }

    @AssertTrue(message = "roomId is required when nameEncrypted is set (client-proposed UUID for AAD)")
    public boolean isRoomIdPresentWhenNameSet() {
        if (!StringUtils.hasText(nameEncrypted)) {
            return true;
        }
        return StringUtils.hasText(roomId);
    }

    /**
     * ECDH P-256 public key of the room owner — Base64 SPKI-encoded (~124 bytes ≈ 165 chars).
     * Stored so the owner's key is available when other members need to send them bundles,
     * and for rekey scenarios (P2-3.2.2).
     */
    @Size(max = 256)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "ownerPublicKey must be Base64")
    private String ownerPublicKey;
}
