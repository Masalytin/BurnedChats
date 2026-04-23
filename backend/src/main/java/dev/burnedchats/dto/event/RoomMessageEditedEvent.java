package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event broadcast on {@code /topic/room/{roomId}} when a room message was edited.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMessageEditedEvent {

    /**
     * Distinguishes this payload from {@link NewRoomMessageEvent} on the same topic.
     */
    @Builder.Default
    private String eventType = "ROOM_MESSAGE_EDITED";

    private boolean success;
    private String roomId;
    private String messageId;
    private Long senderTgId;
    private String senderName;
    private String encryptedContent;
    private String iv;
    private Instant editedAt;
    private String type;
    private String fileId;
    private String thumbnailFileId;
    private String encryptedMeta;
    private Long fileSize;
    private String errorCode;
}
