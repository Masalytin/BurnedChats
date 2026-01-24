package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event DTO sent to both participants when a session is burned.
 *
 * <p>Sent via STOMP to {@code /user/queue/burn-signal} when either
 * participant burns the chat session. Both participants receive this
 * event simultaneously.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "burnedBy": 123456789,
 *   "burnedAt": "2024-01-15T10:32:00Z",
 *   "success": true
 * }
 * }</pre>
 *
 * <p>After receiving this event, clients MUST:
 * <ul>
 *   <li>Immediately destroy all cryptographic keys (shared secret, AES key)</li>
 *   <li>Clear all message history from memory</li>
 *   <li>Display burn confirmation animation</li>
 *   <li>Navigate away from chat view</li>
 *   <li>Prevent any further messages in this session</li>
 * </ul>
 *
 * <p>Security notes:
 * <ul>
 *   <li>Keys should be overwritten before deallocation (crypto secure erase)</li>
 *   <li>Message buffers should be zeroed out</li>
 *   <li>LocalStorage/IndexedDB entries should be deleted</li>
 *   <li>The session ID should no longer be accepted by the server</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.BurnHandler
 * @see dev.burnedchats.dto.request.BurnSessionRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BurnSignalEvent {

    /**
     * The session ID that was burned (UUID).
     */
    private String sessionId;

    /**
     * Telegram user ID of the participant who initiated the burn.
     * Can be used to display "X burned the chat" message.
     */
    private Long burnedBy;

    /**
     * Timestamp when the session was burned (server time).
     */
    private Instant burnedAt;

    /**
     * Whether the burn operation was successful.
     */
    private boolean success;

    /**
     * Error code if the burn operation failed.
     * Null if successful.
     *
     * <p>Possible error codes:
     * <ul>
     *   <li>SESSION_NOT_FOUND - session doesn't exist</li>
     *   <li>NOT_PARTICIPANT - user is not a session participant</li>
     *   <li>ALREADY_BURNED - session was already burned</li>
     *   <li>INTERNAL_ERROR - server error</li>
     * </ul>
     */
    private String error;

    /**
     * Create a successful burn signal event.
     *
     * @param sessionId the session ID that was burned
     * @param burnedBy  the user ID who initiated the burn
     * @param burnedAt  timestamp when the burn occurred
     * @return successful burn signal event
     */
    public static BurnSignalEvent success(String sessionId, Long burnedBy, Instant burnedAt) {
        return BurnSignalEvent.builder()
                .sessionId(sessionId)
                .burnedBy(burnedBy)
                .burnedAt(burnedAt)
                .success(true)
                .build();
    }

    /**
     * Create a failed burn signal event.
     *
     * @param sessionId the session ID that failed to burn
     * @param errorCode the error code describing the failure
     * @return failed burn signal event
     */
    public static BurnSignalEvent error(String sessionId, String errorCode) {
        return BurnSignalEvent.builder()
                .sessionId(sessionId)
                .success(false)
                .error(errorCode)
                .build();
    }
}
