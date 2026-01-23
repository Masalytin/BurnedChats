package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event DTO sent to participants regarding fingerprint verification status.
 *
 * <p>Sent via STOMP to {@code /user/queue/verification} when:
 * <ul>
 *   <li>A participant confirms or denies fingerprint verification</li>
 *   <li>Both participants have completed verification</li>
 *   <li>An error occurs during verification</li>
 * </ul>
 *
 * <p>Example payload (peer verified):
 * <pre>{@code
 * {
 *   "success": true,
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "verified": true,
 *   "peerVerified": true,
 *   "bothVerified": true,
 *   "verifiedAt": "2024-01-15T10:32:00Z",
 *   "error": null
 * }
 * }</pre>
 *
 * <p>Example payload (verification mismatch):
 * <pre>{@code
 * {
 *   "success": false,
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "verified": false,
 *   "peerVerified": false,
 *   "bothVerified": false,
 *   "verifiedAt": null,
 *   "error": "FINGERPRINT_MISMATCH"
 * }
 * }</pre>
 *
 * @see dev.burnedchats.handler.VerificationHandler
 * @see dev.burnedchats.dto.request.VerificationRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VerificationEvent {

    /**
     * Whether the operation was successful.
     */
    private boolean success;

    /**
     * The session ID (UUID).
     */
    private String sessionId;

    /**
     * Whether the current user has verified the fingerprint.
     */
    private Boolean verified;

    /**
     * Whether the peer has verified the fingerprint.
     */
    private Boolean peerVerified;

    /**
     * Whether both participants have verified the fingerprint.
     * When true, the connection is fully trusted.
     */
    private Boolean bothVerified;

    /**
     * Timestamp when verification was confirmed.
     */
    private Instant verifiedAt;

    /**
     * Error code if the operation failed.
     *
     * <p>Possible values:
     * <ul>
     *   <li>{@code SESSION_NOT_FOUND} - session doesn't exist</li>
     *   <li>{@code NOT_PARTICIPANT} - user is not in this session</li>
     *   <li>{@code SESSION_NOT_ACTIVE} - session is not in active state</li>
     *   <li>{@code FINGERPRINT_MISMATCH} - user reported fingerprint doesn't match</li>
     *   <li>{@code INTERNAL_ERROR} - unexpected server error</li>
     * </ul>
     */
    private String error;

    /**
     * Create a successful verification event.
     *
     * @param sessionId    the session ID
     * @param verified     whether the user verified
     * @param peerVerified whether the peer verified
     * @param verifiedAt   verification timestamp
     * @return successful event
     */
    public static VerificationEvent success(String sessionId, boolean verified, 
                                            boolean peerVerified, Instant verifiedAt) {
        return VerificationEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .verified(verified)
                .peerVerified(peerVerified)
                .bothVerified(verified && peerVerified)
                .verifiedAt(verifiedAt)
                .build();
    }

    /**
     * Create a peer verification status event.
     *
     * @param sessionId    the session ID
     * @param peerVerified whether the peer has verified
     * @return peer status event
     */
    public static VerificationEvent peerStatus(String sessionId, boolean peerVerified) {
        return VerificationEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .peerVerified(peerVerified)
                .build();
    }

    /**
     * Create an error event.
     *
     * @param errorCode the error code
     * @return error event
     */
    public static VerificationEvent error(String errorCode) {
        return VerificationEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }

    /**
     * Create an error event with session ID.
     *
     * @param sessionId the session ID
     * @param errorCode the error code
     * @return error event
     */
    public static VerificationEvent error(String sessionId, String errorCode) {
        return VerificationEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .error(errorCode)
                .build();
    }

    /**
     * Create a fingerprint mismatch event.
     * This indicates a potential MITM attack.
     *
     * @param sessionId the session ID
     * @return mismatch event
     */
    public static VerificationEvent mismatch(String sessionId) {
        return VerificationEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .verified(false)
                .peerVerified(false)
                .bothVerified(false)
                .error("FINGERPRINT_MISMATCH")
                .build();
    }
}
