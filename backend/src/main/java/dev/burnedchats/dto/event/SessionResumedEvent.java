package dev.burnedchats.dto.event;

import dev.burnedchats.dto.response.SessionResponse;
import dev.burnedchats.model.Session.SessionStatus;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;

/**
 * Event sent after successfully resuming a session (4.6.3).
 *
 * <p>Contains full session details including peer information,
 * status, and expiration time to allow the client to restore
 * the chat state.
 *
 * @see dev.burnedchats.handler.SessionHandler#resumeSession
 */
@Getter
@Builder
public class SessionResumedEvent {

    /**
     * Whether the resume was successful.
     */
    private final boolean success;

    /**
     * Session ID.
     */
    private final String sessionId;

    /**
     * Full session details.
     */
    private final SessionResponse session;

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
     * Whether peer is currently online.
     */
    private final boolean peerOnline;

    /**
     * Server timestamp.
     */
    @Builder.Default
    private final Instant serverTimestamp = Instant.now();

    /**
     * Error code if the resume failed.
     */
    private final String error;

    /**
     * Create successful resume event.
     *
     * @param sessionId        session ID
     * @param session          session details
     * @param status           current status
     * @param expiresAt        expiration timestamp
     * @param remainingSeconds remaining time
     * @param peerOnline       whether peer is online
     * @return success event
     */
    public static SessionResumedEvent success(String sessionId, SessionResponse session,
                                               SessionStatus status, Instant expiresAt,
                                               long remainingSeconds, boolean peerOnline) {
        return SessionResumedEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .session(session)
                .status(status)
                .expiresAt(expiresAt)
                .remainingSeconds(remainingSeconds)
                .peerOnline(peerOnline)
                .build();
    }

    /**
     * Create error event for expired session.
     *
     * @param sessionId session ID
     * @return error event
     */
    public static SessionResumedEvent expired(String sessionId) {
        return SessionResumedEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .status(SessionStatus.EXPIRED)
                .remainingSeconds(0)
                .error("SESSION_EXPIRED")
                .build();
    }

    /**
     * Create error event.
     *
     * @param sessionId session ID
     * @param errorCode error code
     * @return error event
     */
    public static SessionResumedEvent error(String sessionId, String errorCode) {
        return SessionResumedEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .error(errorCode)
                .build();
    }
}
