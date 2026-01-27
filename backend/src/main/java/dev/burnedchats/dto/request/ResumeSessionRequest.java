package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;

/**
 * Request to resume an existing session (4.6.3).
 *
 * <p>Used by clients to resume a session after reconnecting
 * or reopening the Mini App.
 *
 * @see dev.burnedchats.handler.SessionHandler#resumeSession
 */
public record ResumeSessionRequest(
        /**
         * Session ID to resume.
         */
        @NotBlank(message = "Session ID is required")
        String sessionId
) {
}
