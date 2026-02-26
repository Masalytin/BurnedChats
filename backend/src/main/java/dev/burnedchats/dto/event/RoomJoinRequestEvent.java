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

    /**
     * ECDH P-256 public key of the sender — Base64 SPKI-encoded.
     * Provided so the owner can immediately wrap the group key when accepting the request.
     * May be null if the client did not send a public key.
     */
    private String senderPublicKey;

    public static RoomJoinRequestEvent of(String roomId, Long senderTgId,
                                          String senderUsername, String senderFirstName,
                                          Long requestedAt, String senderPublicKey) {
        return RoomJoinRequestEvent.builder()
                .roomId(roomId)
                .senderTgId(senderTgId)
                .senderUsername(senderUsername)
                .senderFirstName(senderFirstName)
                .requestedAt(requestedAt)
                .senderPublicKey(senderPublicKey)
                .build();
    }
}
