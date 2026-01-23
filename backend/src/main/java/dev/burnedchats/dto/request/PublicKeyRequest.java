package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for sending a public key during handshake.
 *
 * <p>Sent by client via STOMP to {@code /app/handshake.key} after a session
 * is accepted (status = HANDSHAKE). Both participants must send their public
 * keys to establish end-to-end encryption.
 *
 * <p>The public key is an ECDH P-256 key exported in SPKI format,
 * then Base64-encoded.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "publicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE..."
 * }
 * }</pre>
 *
 * <p>After both participants send their public keys:
 * <ol>
 *   <li>Server relays each key to the peer via PEER_PUBLIC_KEY event</li>
 *   <li>Each client imports the peer's public key</li>
 *   <li>Each client computes the shared secret using ECDH</li>
 *   <li>Clients derive AES-GCM key using HKDF</li>
 * </ol>
 *
 * @see dev.burnedchats.handler.HandshakeHandler
 * @see dev.burnedchats.dto.event.PeerPublicKeyEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PublicKeyRequest {

    /**
     * The session ID for the handshake (UUID).
     *
     * <p>Must match an existing session in HANDSHAKE status
     * where the current user is a participant.
     */
    @NotBlank(message = "Session ID is required")
    private String sessionId;

    /**
     * The user's ECDH public key in Base64 format.
     *
     * <p>This should be an ECDH P-256 public key exported in SPKI format,
     * then encoded as Base64. The key is only relayed to the peer and
     * is never stored on the server.
     *
     * <p>Expected format: Base64-encoded SPKI public key.
     * Typical length: ~88-92 characters for P-256 keys.
     */
    @NotBlank(message = "Public key is required")
    @Size(min = 44, max = 256, message = "Public key must be between 44 and 256 characters")
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$", message = "Public key must be valid Base64")
    private String publicKey;
}
