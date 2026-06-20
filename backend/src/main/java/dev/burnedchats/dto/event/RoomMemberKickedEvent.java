package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event DTO sent to a member who was forcibly removed from a room by the owner.
 *
 * <p>Delivered via STOMP to {@code /user/queue/room-kicked} for the kicked member only.
 * The client should leave the room UI, stop decrypting new messages, and discard local key material.
 *
 * @see dev.burnedchats.handler.RoomHandler
 * @see dev.burnedchats.dto.request.KickMemberRequest
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMemberKickedEvent {

    /** The room UUID from which the member was kicked. */
    private String roomId;

    /** Internal ID of the owner who initiated the kick. */
    private String byInternalId;

    public static RoomMemberKickedEvent of(String roomId, String byInternalId) {
        return RoomMemberKickedEvent.builder()
                .roomId(roomId)
                .byInternalId(byInternalId)
                .build();
    }
}
