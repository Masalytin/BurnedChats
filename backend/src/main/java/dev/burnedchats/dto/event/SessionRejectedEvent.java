package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event DTO sent to the initiator when their request is rejected.
 *
 * <p>Sent via STOMP to {@code /user/queue/session-rejected} when
 * the responder rejects a chat request. Only the initiator receives
 * this event.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "rejectedAt": "2024-01-15T10:32:00Z"
 * }
 * }</pre>
 *
 * <p>After receiving this event, the initiator's client should:
 * <ul>
 *   <li>Display appropriate UI feedback</li>
 *   <li>Clear any local session state</li>
 *   <li>Allow the user to search for another contact</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.SessionHandler
 * @see dev.burnedchats.dto.request.RejectSessionRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SessionRejectedEvent {

    /**
     * The session ID that was rejected (UUID).
     */
    private String sessionId;

    /**
     * Timestamp when the session was rejected.
     */
    private Instant rejectedAt;

    /**
     * Create a session rejected event.
     *
     * @param sessionId  the session ID
     * @param rejectedAt rejection timestamp
     * @return rejected event
     */
    public static SessionRejectedEvent create(String sessionId, Instant rejectedAt) {
        return SessionRejectedEvent.builder()
                .sessionId(sessionId)
                .rejectedAt(rejectedAt)
                .build();
    }
}
