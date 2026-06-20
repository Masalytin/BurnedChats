package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event broadcast on {@code /topic/room/{roomId}} when the owner updates managed room TTL.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomTtlUpdatedEvent {

    /**
     * Distinguishes this payload from other events on the same topic.
     */
    @Builder.Default
    private String eventType = "ROOM_TTL_UPDATED";

    private String roomId;

    /** Absolute auto-burn instant as Unix epoch milliseconds. */
    private Long autoBurnAt;

    public static RoomTtlUpdatedEvent of(String roomId, Long autoBurnAt) {
        return RoomTtlUpdatedEvent.builder()
                .roomId(roomId)
                .autoBurnAt(autoBurnAt)
                .build();
    }
}
