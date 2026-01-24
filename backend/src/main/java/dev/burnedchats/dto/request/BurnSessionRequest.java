package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for burning (destroying) a chat session.
 *
 * <p>Sent by client via STOMP to {@code /app/session.burn} to permanently
 * destroy an active chat session. Either participant can initiate the burn.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000"
 * }
 * }</pre>
 *
 * <p>When burned:
 * <ul>
 *   <li>The session status is changed to BURNED</li>
 *   <li>All session data is deleted from Redis</li>
 *   <li>All queued messages are deleted</li>
 *   <li>Both participants receive a BURN_SIGNAL event</li>
 *   <li>Clients should destroy all local keys and message history</li>
 * </ul>
 *
 * <p>This operation is irreversible - all cryptographic material and
 * message history will be permanently destroyed.
 *
 * @see dev.burnedchats.handler.BurnHandler
 * @see dev.burnedchats.dto.event.BurnSignalEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BurnSessionRequest {

    /**
     * The session ID to burn (UUID).
     *
     * <p>Must match an active or handshake session where the current
     * user is a participant (initiator or responder).
     */
    @NotBlank(message = "Session ID is required")
    private String sessionId;
}
