package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event sent to the room owner after a room is successfully created.
 *
 * <p>Destination: {@code /user/queue/room-created}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomCreatedEvent {

    private boolean success;

    /** UUID of the newly created room. Present only when {@code success = true}. */
    private String roomId;

    /**
     * Telegram deep-link invite URL generated at room creation.
     * Present when {@code success = true}. May be {@code null} if token generation failed
     * (room is still created; owner can request a link later via GET_INVITE_LINK).
     */
    private String inviteUrl;

    /**
     * Error code when {@code success = false}.
     * Possible values: {@code VALIDATION_ERROR}, {@code RATE_LIMITED}, {@code INTERNAL_ERROR}.
     */
    private String error;

    public static RoomCreatedEvent success(String roomId) {
        return RoomCreatedEvent.builder()
                .success(true)
                .roomId(roomId)
                .build();
    }

    public static RoomCreatedEvent success(String roomId, String inviteUrl) {
        return RoomCreatedEvent.builder()
                .success(true)
                .roomId(roomId)
                .inviteUrl(inviteUrl)
                .build();
    }

    public static RoomCreatedEvent error(String errorCode) {
        return RoomCreatedEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}
