package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for accepting a chat session request.
 *
 * <p>Sent by client via STOMP to {@code /app/session.accept} to accept
 * an incoming chat request.
 *
 * <p>Example payload (without secret question):
 * <pre>{@code
 * {
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000"
 * }
 * }</pre>
 *
 * <p>Example payload (with secret answer):
 * <pre>{@code
 * {
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "secretAnswer": "Barsik"
 * }
 * }</pre>
 *
 * @see dev.burnedchats.handler.SessionHandler
 * @see dev.burnedchats.dto.event.SessionAcceptedEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AcceptSessionRequest {

    /**
     * The session ID to accept (UUID).
     *
     * <p>Must match a pending session where the current user is the responder.
     */
    @NotBlank(message = "Session ID is required")
    private String sessionId;

    /**
     * Optional answer to the secret question.
     *
     * <p>Required if the session request included a secret question.
     * The server compares a hash of this answer with the expected hash
     * stored at session creation (never stores plaintext).
     *
     * <p>Maximum length: 256 characters.
     */
    @Size(max = 256, message = "Secret answer must not exceed 256 characters")
    private String secretAnswer;
}
