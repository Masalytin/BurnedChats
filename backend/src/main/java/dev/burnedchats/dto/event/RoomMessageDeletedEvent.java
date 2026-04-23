package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Broadcast on the room topic when a message is deleted for everyone.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMessageDeletedEvent {

    private String eventType;
    private boolean success;
    private String roomId;
    private String messageId;
    private Long deletedByTgId;
    private boolean deletedByOwner;
    private Instant deletedAt;
    private String errorCode;
}
