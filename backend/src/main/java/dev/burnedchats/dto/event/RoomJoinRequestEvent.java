package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event pushed to the room owner when a user requests to join in {@code BY_REQUEST} mode.
 *
 * <p>Destination: {@code /user/queue/room-join-requests}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomJoinRequestEvent {

    private String roomId;

    /** Internal ID of the user requesting to join. */
    private String senderInternalId;

    /**
     * Telegram ID when linked; null for wallet-only requesters.
     *
     * @deprecated Prefer {@link #senderInternalId}.
     */
    @Deprecated
    private Long senderTgId;

    private String senderUsername;

    /** Display name for the owner UI (from catalog or Telegram first name). */
    private String senderDisplayName;

    /**
     * @deprecated Use {@link #senderDisplayName}.
     */
    @Deprecated
    private String senderFirstName;

    private Long requestedAt;

    private String senderPublicKey;

    private boolean autoApproved;

    public static RoomJoinRequestEvent of(String roomId, String senderInternalId, Long senderTgId,
                                          String senderUsername, String senderDisplayName,
                                          Long requestedAt, String senderPublicKey) {
        return RoomJoinRequestEvent.builder()
                .roomId(roomId)
                .senderInternalId(senderInternalId)
                .senderTgId(senderTgId)
                .senderUsername(senderUsername)
                .senderDisplayName(senderDisplayName)
                .senderFirstName(senderDisplayName)
                .requestedAt(requestedAt)
                .senderPublicKey(senderPublicKey)
                .autoApproved(false)
                .build();
    }

    public static RoomJoinRequestEvent autoApproved(String roomId, String senderInternalId, Long senderTgId,
                                                    String senderUsername, String senderDisplayName,
                                                    Long requestedAt, String senderPublicKey) {
        return RoomJoinRequestEvent.builder()
                .roomId(roomId)
                .senderInternalId(senderInternalId)
                .senderTgId(senderTgId)
                .senderUsername(senderUsername)
                .senderDisplayName(senderDisplayName)
                .senderFirstName(senderDisplayName)
                .requestedAt(requestedAt)
                .senderPublicKey(senderPublicKey)
                .autoApproved(true)
                .build();
    }
}
