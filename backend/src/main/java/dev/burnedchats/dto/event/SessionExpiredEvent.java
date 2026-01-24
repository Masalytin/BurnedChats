package dev.burnedchats.dto.event;

import lombok.Builder;
import lombok.Getter;

import java.time.Instant;

/**
 * Event sent when a session expires due to TTL.
 *
 * <p>Sessions automatically expire after 1 hour of creation.
 * This event is sent to both participants when a session expires.
 *
 * @see dev.burnedchats.repository.SessionRepository
 */
@Getter
@Builder
public class SessionExpiredEvent {

    /**
     * Session ID that expired.
     */
    private final String sessionId;

    /**
     * Server timestamp when event was generated.
     */
    @Builder.Default
    private final Instant timestamp = Instant.now();

    /**
     * Reason for expiration.
     */
    private final String reason;

    /**
     * Create event for TTL expiration.
     */
    public static SessionExpiredEvent timeout(String sessionId) {
        return SessionExpiredEvent.builder()
                .sessionId(sessionId)
                .reason("SESSION_TIMEOUT")
                .build();
    }

    /**
     * Create event for inactivity expiration.
     */
    public static SessionExpiredEvent inactive(String sessionId) {
        return SessionExpiredEvent.builder()
                .sessionId(sessionId)
                .reason("SESSION_INACTIVE")
                .build();
    }
}
