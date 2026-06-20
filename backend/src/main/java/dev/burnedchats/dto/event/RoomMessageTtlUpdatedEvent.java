package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event broadcast on {@code /topic/room/{roomId}} when the owner updates message auto-destruction TTL.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMessageTtlUpdatedEvent {

    /**
     * Distinguishes this payload from other events on the same topic.
     */
    @Builder.Default
    private String eventType = "ROOM_MESSAGE_TTL_UPDATED";

    private String roomId;

    /** Message lifetime in seconds; {@code 0} = disabled. */
    private int messageTtlSeconds;

    public static RoomMessageTtlUpdatedEvent of(String roomId, int messageTtlSeconds) {
        return RoomMessageTtlUpdatedEvent.builder()
                .roomId(roomId)
                .messageTtlSeconds(messageTtlSeconds)
                .build();
    }
}
