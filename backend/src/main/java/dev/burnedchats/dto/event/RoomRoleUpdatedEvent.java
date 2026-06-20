package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event broadcast on {@code /topic/room/{roomId}} when a member's overlay role changes.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomRoleUpdatedEvent {

    /**
     * Distinguishes this payload from message events on the same topic.
     */
    @Builder.Default
    private String eventType = "ROOM_ROLE_UPDATED";

    /** The room UUID. */
    private String roomId;

    /** Internal ID of the member whose role changed. */
    private String targetInternalId;

    /** New effective overlay role: {@code admin} or {@code member}. */
    private String role;
}
