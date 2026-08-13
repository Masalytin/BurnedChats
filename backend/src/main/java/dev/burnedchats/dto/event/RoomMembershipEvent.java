package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event broadcast on {@code /topic/room/{roomId}} when room membership changes
 * (join, voluntary leave, or kick/ban).
 *
 * <p>Plaintext metadata for members currently subscribed to the room topic.
 * Not written to the E2EE queue {@code messages:{roomId}}. Distinct from
 * {@link RoomMemberLeftEvent} / {@link RoomMemberRemovedEvent}, which remain
 * the {@code /user/queue/*} control-plane payloads for rekey.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMembershipEvent {

    public static final String JOINED = "ROOM_MEMBER_JOINED";
    public static final String LEFT = "ROOM_MEMBER_LEFT";
    public static final String REMOVED = "ROOM_MEMBER_REMOVED";

    /** Distinguishes this payload from message events on the same topic. */
    private String eventType;

    /** The room UUID. */
    private String roomId;

    /** Internal ID of the member who joined, left, or was removed. */
    private String memberInternalId;

    /** Best-effort catalog / firstName; {@code null} when lookup misses. */
    private String displayName;

    /** Server clock millis at emit time; client overlay sorts by receivedAt. */
    private long occurredAt;

    public static RoomMembershipEvent joined(String roomId, String memberInternalId, String displayName) {
        return of(JOINED, roomId, memberInternalId, displayName);
    }

    public static RoomMembershipEvent left(String roomId, String memberInternalId, String displayName) {
        return of(LEFT, roomId, memberInternalId, displayName);
    }

    public static RoomMembershipEvent removed(String roomId, String memberInternalId, String displayName) {
        return of(REMOVED, roomId, memberInternalId, displayName);
    }

    private static RoomMembershipEvent of(
            String eventType, String roomId, String memberInternalId, String displayName) {
        return RoomMembershipEvent.builder()
                .eventType(eventType)
                .roomId(roomId)
                .memberInternalId(memberInternalId)
                .displayName(displayName)
                .occurredAt(System.currentTimeMillis())
                .build();
    }
}
