package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event broadcast on {@code /topic/room/{roomId}} when room ownership is transferred.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomOwnershipTransferredEvent {

    /**
     * Distinguishes this payload from message events on the same topic.
     */
    @Builder.Default
    private String eventType = "ROOM_OWNERSHIP_TRANSFERRED";

    /** The room UUID. */
    private String roomId;

    /** Internal ID of the new owner after transfer. */
    private String newOwnerInternalId;

    /** Internal ID of the previous owner before transfer. */
    private String previousOwnerInternalId;
}
