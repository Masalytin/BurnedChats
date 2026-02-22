package dev.burnedchats.dto.request;

import dev.burnedchats.model.Room;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * Payload for the STOMP {@code /app/room.create} destination.
 *
 * <p>The client derives the password proof client-side (PBKDF2/Web Crypto API)
 * and sends only {@code salt + proof}. The server never sees the plaintext password.
 */
@Data
public class CreateRoomRequest {

    /**
     * KDF salt — Base64, 16+ bytes, generated client-side with {@code crypto.getRandomValues}.
     */
    @NotBlank
    @Size(min = 24, max = 64)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "salt must be Base64")
    private String salt;

    /**
     * PBKDF2 proof — Base64, 32 bytes (256 bits).
     * Derived as: PBKDF2WithHmacSHA256(password, salt, 200_000, 256 bits).
     */
    @NotBlank
    @Size(min = 43, max = 44)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "passwordProof must be Base64")
    private String passwordProof;

    /**
     * Room join mode: {@code BY_PASSWORD} or {@code BY_REQUEST}.
     */
    @NotNull
    private Room.JoinMode joinMode;

    /**
     * Optional encrypted room name.
     * If provided, it must be an opaque Base64 ciphertext encrypted client-side.
     */
    @Size(max = 512)
    private String nameEncrypted;
}
