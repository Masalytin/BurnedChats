package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event pushed to the room owner when a user requests to join in {@code BY_REQUEST} mode.
 *
 * <p>Destination: {@code /user/queue/room-join-requests}
 *
 * <p>Contains minimal sender identity so the owner can make an accept/reject decision.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomJoinRequestEvent {

    /** UUID of the room. */
    private String roomId;

    /** Telegram ID of the user requesting to join. */
    private Long senderTgId;

    /** Telegram username — may be null if the user has no username. */
    private String senderUsername;

    /** First name of the requesting user. */
    private String senderFirstName;

    /** Unix timestamp (ms) when the request was created. */
    private Long requestedAt;

    public static RoomJoinRequestEvent of(String roomId, Long senderTgId,
                                          String senderUsername, String senderFirstName,
                                          Long requestedAt) {
        return RoomJoinRequestEvent.builder()
                .roomId(roomId)
                .senderTgId(senderTgId)
                .senderUsername(senderUsername)
                .senderFirstName(senderFirstName)
                .requestedAt(requestedAt)
                .build();
    }
}
