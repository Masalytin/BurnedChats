package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event broadcast on {@code /topic/room/{roomId}} when the room owner updates the encrypted name.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomNameUpdatedEvent {

    /**
     * Distinguishes this payload from message events on the same topic.
     */
    @Builder.Default
    private String eventType = "ROOM_NAME_UPDATED";

    private String roomId;

    /** Base64 AES-GCM ciphertext — opaque to the server. */
    private String nameEncrypted;

    /** Base64 12-byte GCM IV. */
    private String nameIv;

    public static RoomNameUpdatedEvent of(String roomId, String nameEncrypted, String nameIv) {
        return RoomNameUpdatedEvent.builder()
                .roomId(roomId)
                .nameEncrypted(nameEncrypted)
                .nameIv(nameIv)
                .build();
    }
}
