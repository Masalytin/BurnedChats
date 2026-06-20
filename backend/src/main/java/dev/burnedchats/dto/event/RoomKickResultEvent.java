package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Acknowledgement sent to the room owner after processing a kick request.
 *
 * <p>Delivered via STOMP to {@code /user/queue/room-kick-result} for the kick initiator only.
 * Fan-out to the victim ({@code ROOM_KICKED}) and remaining members ({@code ROOM_MEMBER_REMOVED})
 * is unchanged and independent of this event.
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.request.KickMemberRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomKickResultEvent {

    private boolean success;

    /** The room UUID from the kick request. */
    private String roomId;

    /** Internal ID of the member the owner attempted to kick. */
    private String targetInternalId;

    /**
     * Error code when {@code success = false}.
     * Possible values: {@code NOT_OWNER}, {@code CANNOT_KICK_SELF}, {@code CANNOT_KICK_OWNER},
     * {@code NOT_MEMBER}, {@code ROOM_NOT_FOUND}, {@code RATE_LIMITED}, {@code INTERNAL_ERROR}.
     */
    private String error;

    public static RoomKickResultEvent success(String roomId, String targetInternalId) {
        return RoomKickResultEvent.builder()
                .success(true)
                .roomId(roomId)
                .targetInternalId(targetInternalId)
                .build();
    }

    public static RoomKickResultEvent failure(String roomId, String targetInternalId, String errorCode) {
        return RoomKickResultEvent.builder()
                .success(false)
                .roomId(roomId)
                .targetInternalId(targetInternalId)
                .error(errorCode)
                .build();
    }
}
