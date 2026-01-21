package dev.burnedchats.dto.event;

import dev.burnedchats.dto.response.UserResponse;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event DTO sent to both participants when a session is accepted.
 *
 * <p>Sent via STOMP to {@code /user/queue/session-accepted} when
 * the responder accepts a chat request. Both the initiator and
 * responder receive this event to proceed with the handshake.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "success": true,
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "peer": {
 *     "id": 987654321,
 *     "username": "alice",
 *     "displayName": "Alice Smith",
 *     "photoUrl": "https://...",
 *     "online": true,
 *     "premium": false
 *   },
 *   "acceptedAt": "2024-01-15T10:32:00Z",
 *   "error": null
 * }
 * }</pre>
 *
 * <p>After receiving this event, both clients should:
 * <ol>
 *   <li>Generate ECDH key pair</li>
 *   <li>Send public key via /app/handshake.key</li>
 *   <li>Wait for peer's public key</li>
 *   <li>Compute shared secret</li>
 * </ol>
 *
 * @see dev.burnedchats.handler.SessionHandler
 * @see dev.burnedchats.dto.request.AcceptSessionRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SessionAcceptedEvent {

    /**
     * Whether the acceptance was successful.
     */
    private boolean success;

    /**
     * The session ID (UUID).
     * Null if acceptance failed.
     */
    private String sessionId;

    /**
     * Information about the peer user.
     *
     * <p>For the initiator, this is the responder's info.
     * For the responder, this is the initiator's info.
     */
    private UserResponse peer;

    /**
     * Timestamp when the session was accepted.
     */
    private Instant acceptedAt;

    /**
     * Error code if acceptance failed.
     *
     * <p>Possible values:
     * <ul>
     *   <li>{@code SESSION_NOT_FOUND} - session doesn't exist or expired</li>
     *   <li>{@code NOT_RESPONDER} - user is not the responder for this session</li>
     *   <li>{@code ALREADY_ACCEPTED} - session was already accepted</li>
     *   <li>{@code REQUEST_EXPIRED} - the chat request has expired</li>
     *   <li>{@code WRONG_ANSWER} - secret answer doesn't match</li>
     *   <li>{@code INTERNAL_ERROR} - unexpected server error</li>
     * </ul>
     */
    private String error;

    /**
     * Create a successful session accepted event.
     *
     * @param sessionId  the session ID
     * @param peer       peer user info
     * @param acceptedAt acceptance timestamp
     * @return successful event
     */
    public static SessionAcceptedEvent success(String sessionId, UserResponse peer, Instant acceptedAt) {
        return SessionAcceptedEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .peer(peer)
                .acceptedAt(acceptedAt)
                .build();
    }

    /**
     * Create an error event.
     *
     * @param errorCode the error code
     * @return error event
     */
    public static SessionAcceptedEvent error(String errorCode) {
        return SessionAcceptedEvent.builder()
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
    public static SessionAcceptedEvent error(String sessionId, String errorCode) {
        return SessionAcceptedEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .error(errorCode)
                .build();
    }
}
