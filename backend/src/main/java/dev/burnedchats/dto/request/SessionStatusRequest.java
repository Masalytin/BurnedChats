package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;

/**
 * Request to check session status (5.1.4).
 *
 * <p>Used by clients to verify if a session is still active
 * and to get the remaining time until expiration.
 *
 * @see dev.burnedchats.handler.SessionHandler#checkSessionStatus
 */
public record SessionStatusRequest(
        /**
         * Session ID to check.
         */
        @NotBlank(message = "Session ID is required")
        String sessionId
) {
}
