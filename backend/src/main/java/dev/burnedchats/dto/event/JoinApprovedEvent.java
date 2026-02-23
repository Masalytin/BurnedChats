package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event sent to the requesting user when their join is approved (or when they join
 * a {@code BY_PASSWORD} room immediately after password verification).
 *
 * <p>Destination: {@code /user/queue/room-join-result}
 *
 * <p>On success the client can proceed to open the room chat.
 * Key exchange (P2-3) will follow separately.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class JoinApprovedEvent {

    private boolean success;

    /** UUID of the room the user has joined. Present when {@code success = true}. */
    private String roomId;

    /**
     * Error code when {@code success = false}.
     * Possible values: {@code INVALID_TOKEN}, {@code WRONG_PASSWORD},
     * {@code ALREADY_MEMBER}, {@code REQUEST_PENDING}, {@code INTERNAL_ERROR}.
     */
    private String error;

    public static JoinApprovedEvent success(String roomId) {
        return JoinApprovedEvent.builder()
                .success(true)
                .roomId(roomId)
                .build();
    }

    public static JoinApprovedEvent error(String errorCode) {
        return JoinApprovedEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}
