package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Event sent in response to {@code GET_ROOM_MEMBERS}.
 *
 * <p>Destination: {@code /user/queue/room-members}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMembersListEvent {

    private boolean success;

    /** The room UUID. Present on success. */
    private String roomId;

    /** List of member Telegram IDs as strings. Present when {@code success = true}. */
    private List<String> members;

    /**
     * Error code when {@code success = false}.
     * Possible values: {@code ROOM_NOT_FOUND}, {@code NOT_MEMBER}, {@code INTERNAL_ERROR}.
     */
    private String error;

    public static RoomMembersListEvent success(String roomId, List<String> members) {
        return RoomMembersListEvent.builder()
                .success(true)
                .roomId(roomId)
                .members(members)
                .build();
    }

    public static RoomMembersListEvent error(String errorCode) {
        return RoomMembersListEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}
