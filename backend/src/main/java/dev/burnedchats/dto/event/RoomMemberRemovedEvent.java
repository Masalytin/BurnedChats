package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event DTO broadcast to all remaining room members when a member is forcibly removed (kick).
 *
 * <p>Sent via STOMP to {@code /user/queue/room-member-removed} for every remaining member
 * (including the owner) after a successful kick.
 *
 * <p>On receipt, the room owner MUST initiate a group key rotation (rekey) to ensure
 * the removed member can no longer decrypt future messages:
 * <ol>
 *   <li>Send {@code GET_MEMBER_PUBKEYS} to retrieve remaining members' public keys.</li>
 *   <li>Generate a new AES-256-GCM group key.</li>
 *   <li>Wrap the key for each remaining member and send {@code REKEY}.</li>
 * </ol>
 *
 * <p>Distinct from {@link RoomMemberLeftEvent}: voluntary leave vs owner-initiated removal.
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.request.KickMemberRequest
 * @see RoomRekeyEvent
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMemberRemovedEvent {

    /** The room UUID from which the member was removed. */
    private String roomId;

    /** Internal ID of the member who was kicked. */
    private String removedInternalId;

    public static RoomMemberRemovedEvent of(String roomId, String removedInternalId) {
        return RoomMemberRemovedEvent.builder()
                .roomId(roomId)
                .removedInternalId(removedInternalId)
                .build();
    }
}
