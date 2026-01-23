package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event DTO sent to a participant with their peer's public key.
 *
 * <p>Sent via STOMP to {@code /user/queue/peer-key} when the peer
 * submits their public key during the handshake phase. This event
 * allows the recipient to complete the ECDH key exchange.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "success": true,
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "peerId": 987654321,
 *   "publicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...",
 *   "timestamp": "2024-01-15T10:33:00Z",
 *   "error": null
 * }
 * }</pre>
 *
 * <p>Upon receiving this event, the client should:
 * <ol>
 *   <li>Import the peer's public key using Web Crypto API</li>
 *   <li>Compute the shared secret using ECDH deriveBits</li>
 *   <li>Derive the AES-GCM key using HKDF</li>
 *   <li>Store the derived key for message encryption/decryption</li>
 *   <li>Display the visual fingerprint for verification</li>
 * </ol>
 *
 * <p>Security note: The server only relays public keys and never
 * has access to private keys or derived secrets. All cryptographic
 * operations happen client-side.
 *
 * @see dev.burnedchats.handler.HandshakeHandler
 * @see dev.burnedchats.dto.request.PublicKeyRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PeerPublicKeyEvent {

    /**
     * Whether the key relay was successful.
     */
    private boolean success;

    /**
     * The session ID (UUID).
     */
    private String sessionId;

    /**
     * The Telegram user ID of the peer who sent the key.
     */
    private Long peerId;

    /**
     * The peer's ECDH public key in Base64 format.
     *
     * <p>This is an ECDH P-256 public key in SPKI format,
     * encoded as Base64. Use Web Crypto API to import it:
     * <pre>{@code
     * const keyData = Uint8Array.from(atob(publicKey), c => c.charCodeAt(0));
     * const peerKey = await crypto.subtle.importKey(
     *   'spki', keyData, { name: 'ECDH', namedCurve: 'P-256' }, false, []
     * );
     * }</pre>
     */
    private String publicKey;

    /**
     * Timestamp when the key was received by the server.
     */
    private Instant timestamp;

    /**
     * Error code if the operation failed.
     *
     * <p>Possible values:
     * <ul>
     *   <li>{@code SESSION_NOT_FOUND} - session doesn't exist</li>
     *   <li>{@code NOT_PARTICIPANT} - user is not a session participant</li>
     *   <li>{@code INVALID_STATUS} - session is not in HANDSHAKE status</li>
     *   <li>{@code INVALID_KEY} - public key format is invalid</li>
     *   <li>{@code INTERNAL_ERROR} - unexpected server error</li>
     * </ul>
     */
    private String error;

    /**
     * Create a successful peer public key event.
     *
     * @param sessionId  the session ID
     * @param peerId     the peer's Telegram user ID
     * @param publicKey  the peer's public key in Base64
     * @param timestamp  when the key was received
     * @return successful event
     */
    public static PeerPublicKeyEvent success(String sessionId, Long peerId,
                                              String publicKey, Instant timestamp) {
        return PeerPublicKeyEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .peerId(peerId)
                .publicKey(publicKey)
                .timestamp(timestamp)
                .build();
    }

    /**
     * Create an error event.
     *
     * @param sessionId the session ID (may be null)
     * @param errorCode the error code
     * @return error event
     */
    public static PeerPublicKeyEvent error(String sessionId, String errorCode) {
        return PeerPublicKeyEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .error(errorCode)
                .build();
    }

    /**
     * Create an error event without session ID.
     *
     * @param errorCode the error code
     * @return error event
     */
    public static PeerPublicKeyEvent error(String errorCode) {
        return PeerPublicKeyEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}
