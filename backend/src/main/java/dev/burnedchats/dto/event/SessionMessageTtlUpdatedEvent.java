package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event sent to both DM participants on {@code /user/queue/session-message-ttl-updated}
 * when either side updates the session message auto-destruction TTL.
 *
 * <p>Last-write-wins: clients ignore an event whose {@code updatedAt} is older than
 * the value they already applied. ACL / validation failures go only to the caller
 * with {@code success=false}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SessionMessageTtlUpdatedEvent {

    /**
     * Distinguishes this payload from other user-queue events.
     */
    @Builder.Default
    private String eventType = "SESSION_MESSAGE_TTL_UPDATED";

    private boolean success;

    private String sessionId;

    /** Message lifetime in seconds; {@code 0} = disabled. */
    private int messageTtlSeconds;

    /** Server time of this write; used by clients for last-write-wins. */
    private Instant updatedAt;

    /**
     * Error code if the set failed.
     *
     * <p>Possible values: {@code SESSION_NOT_FOUND}, {@code NOT_PARTICIPANT},
     * {@code SESSION_NOT_ACTIVE}, {@code INVALID_MESSAGE_TTL}, {@code INTERNAL_ERROR}.
     */
    private String error;

    public static SessionMessageTtlUpdatedEvent of(
            String sessionId, int messageTtlSeconds, Instant updatedAt) {
        return SessionMessageTtlUpdatedEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messageTtlSeconds(messageTtlSeconds)
                .updatedAt(updatedAt)
                .build();
    }

    public static SessionMessageTtlUpdatedEvent error(String sessionId, String errorCode) {
        return SessionMessageTtlUpdatedEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .error(errorCode)
                .build();
    }
}
