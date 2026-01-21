package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for rejecting a chat session request.
 *
 * <p>Sent by client via STOMP to {@code /app/session.reject} to reject
 * an incoming chat request.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000"
 * }
 * }</pre>
 *
 * <p>When rejected:
 * <ul>
 *   <li>The session status is changed to EXPIRED</li>
 *   <li>The chat request is removed from the queue</li>
 *   <li>The initiator receives a rejection notification</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.SessionHandler
 * @see dev.burnedchats.dto.event.SessionRejectedEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RejectSessionRequest {

    /**
     * The session ID to reject (UUID).
     *
     * <p>Must match a pending session where the current user is the responder.
     */
    @NotBlank(message = "Session ID is required")
    private String sessionId;
}
