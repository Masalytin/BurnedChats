package dev.burnedchats.dto.event;

import dev.burnedchats.model.Session.SessionStatus;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;

/**
 * Event containing session status information (5.1.4).
 *
 * <p>Sent in response to a session status check request.
 * Includes whether the session is active, its status, and remaining time.
 *
 * @see dev.burnedchats.handler.SessionHandler#checkSessionStatus
 */
@Getter
@Builder
public class SessionStatusEvent {

    /**
     * Whether the status check was successful.
     */
    private final boolean success;

    /**
     * Session ID.
     */
    private final String sessionId;

    /**
     * Whether the session is active (exists and not expired/burned).
     */
    private final boolean active;

    /**
     * Current session status.
     */
    private final SessionStatus status;

    /**
     * Session expiration timestamp.
     */
    private final Instant expiresAt;

    /**
     * Remaining time in seconds until expiration.
     */
    private final long remainingSeconds;

    /**
     * Server timestamp.
     */
    @Builder.Default
    private final Instant serverTimestamp = Instant.now();

    /**
     * Error code if check failed.
     */
    private final String error;

    /**
     * Create successful status event.
     */
    public static SessionStatusEvent active(String sessionId, SessionStatus status,
                                             Instant expiresAt, long remainingSeconds) {
        return SessionStatusEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .active(true)
                .status(status)
                .expiresAt(expiresAt)
                .remainingSeconds(remainingSeconds)
                .build();
    }

    /**
     * Create event for expired/not found session.
     */
    public static SessionStatusEvent expired(String sessionId) {
        return SessionStatusEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .active(false)
                .status(SessionStatus.EXPIRED)
                .remainingSeconds(0)
                .build();
    }

    /**
     * Create error event.
     */
    public static SessionStatusEvent error(String sessionId, String errorCode) {
        return SessionStatusEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .active(false)
                .error(errorCode)
                .build();
    }
}
