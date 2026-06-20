package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Event sent in response to {@code GET_ROOM_BANS}.
 *
 * <p>Destination: {@code /user/queue/room-bans}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomBanListEvent {

    private boolean success;

    /** The room UUID. Present on success. */
    private String roomId;

    /** Banned internal IDs. Present when {@code success = true}. */
    private List<String> bans;

    /**
     * Error code when {@code success = false}.
     * Possible values: {@code ROOM_NOT_FOUND}, {@code NOT_OWNER}, {@code INTERNAL_ERROR}.
     */
    private String error;

    public static RoomBanListEvent success(String roomId, List<String> bans) {
        return RoomBanListEvent.builder()
                .success(true)
                .roomId(roomId)
                .bans(bans)
                .build();
    }

    public static RoomBanListEvent error(String errorCode) {
        return RoomBanListEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}
