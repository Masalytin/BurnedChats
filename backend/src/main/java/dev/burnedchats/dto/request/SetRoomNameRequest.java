package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Payload for {@code /app/room.setName} — the room owner updates the encrypted room name.
 *
 * <p>The server stores opaque {@code nameEncrypted} + {@code nameIv} blobs without decryption
 * (zero-knowledge). Only the room owner may invoke this endpoint.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SetRoomNameRequest {

    /** UUID of the room. */
    @NotBlank(message = "Room ID is required")
    private String roomId;

    /** Base64-encoded AES-GCM ciphertext of the room name (encrypted with the group key). */
    @NotBlank
    @Size(max = 512)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "nameEncrypted must be Base64")
    private String nameEncrypted;

    /** Base64-encoded 12-byte AES-GCM IV. */
    @NotBlank
    @Size(max = 32)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "nameIv must be Base64")
    private String nameIv;
}
