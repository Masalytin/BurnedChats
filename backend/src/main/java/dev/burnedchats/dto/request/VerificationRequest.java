package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for confirming fingerprint verification.
 *
 * <p>Sent by client via STOMP to {@code /app/verification.confirm} when
 * a user has verified the visual fingerprint matches with their peer.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
 *   "confirmed": true
 * }
 * }</pre>
 *
 * @see dev.burnedchats.handler.VerificationHandler
 * @see dev.burnedchats.dto.event.VerificationEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VerificationRequest {

    /**
     * The session ID to confirm verification for (UUID).
     *
     * <p>Must be an active session where the current user is a participant.
     */
    @NotBlank(message = "Session ID is required")
    private String sessionId;

    /**
     * Whether the user confirms the fingerprint matches.
     *
     * <p>True if the visual fingerprint matches what the peer shows,
     * false if they don't match (possible MITM attack).
     */
    @NotNull(message = "Confirmation status is required")
    private Boolean confirmed;
}
