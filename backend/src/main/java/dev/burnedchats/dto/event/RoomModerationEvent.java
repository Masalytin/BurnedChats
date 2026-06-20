package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event broadcast on {@code /topic/room/{roomId}} when moderation state changes
 * (mute, unmute, or read-only toggle).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomModerationEvent {

    /**
     * Distinguishes this payload from message events on the same topic.
     */
    @Builder.Default
    private String eventType = "ROOM_MODERATION";

    /** The room UUID. */
    private String roomId;

    /** Current read-only flag after the change. */
    private boolean readOnly;

    /** Internal ID added to the mute list; present on mute. */
    private String mutedAdded;

    /** Internal ID removed from the mute list; present on unmute. */
    private String mutedRemoved;

    public static RoomModerationEvent muted(String roomId, boolean readOnly, String mutedInternalId) {
        return RoomModerationEvent.builder()
                .roomId(roomId)
                .readOnly(readOnly)
                .mutedAdded(mutedInternalId)
                .build();
    }

    public static RoomModerationEvent unmuted(String roomId, boolean readOnly, String unmutedInternalId) {
        return RoomModerationEvent.builder()
                .roomId(roomId)
                .readOnly(readOnly)
                .mutedRemoved(unmutedInternalId)
                .build();
    }

    public static RoomModerationEvent readOnlyChanged(String roomId, boolean readOnly) {
        return RoomModerationEvent.builder()
                .roomId(roomId)
                .readOnly(readOnly)
                .build();
    }
}
