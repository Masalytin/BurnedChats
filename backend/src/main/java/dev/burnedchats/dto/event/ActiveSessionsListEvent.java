package dev.burnedchats.dto.event;

import dev.burnedchats.dto.response.SessionResponse;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.List;

/**
 * Event containing list of active sessions for a user (4.6.1, 4.6.2).
 *
 * <p>Sent in response to a GET_ACTIVE_SESSIONS request.
 * Contains all active sessions where the user is a participant.
 *
 * @see dev.burnedchats.handler.SessionHandler#getActiveSessions
 */
@Getter
@Builder
public class ActiveSessionsListEvent {

    /**
     * Whether the request was successful.
     */
    private final boolean success;

    /**
     * List of active sessions.
     */
    private final List<SessionResponse> sessions;

    /**
     * Total count of active sessions.
     */
    private final int count;

    /**
     * Server timestamp when the list was generated.
     */
    @Builder.Default
    private final Instant serverTimestamp = Instant.now();

    /**
     * Error code if the request failed.
     */
    private final String error;

    /**
     * Create successful event with sessions list.
     *
     * @param sessions list of active sessions
     * @return success event
     */
    public static ActiveSessionsListEvent success(List<SessionResponse> sessions) {
        return ActiveSessionsListEvent.builder()
                .success(true)
                .sessions(sessions)
                .count(sessions.size())
                .build();
    }

    /**
     * Create empty success event (no active sessions).
     *
     * @return success event with empty list
     */
    public static ActiveSessionsListEvent empty() {
        return ActiveSessionsListEvent.builder()
                .success(true)
                .sessions(List.of())
                .count(0)
                .build();
    }

    /**
     * Create error event.
     *
     * @param errorCode error code
     * @return error event
     */
    public static ActiveSessionsListEvent error(String errorCode) {
        return ActiveSessionsListEvent.builder()
                .success(false)
                .sessions(List.of())
                .count(0)
                .error(errorCode)
                .build();
    }
}
