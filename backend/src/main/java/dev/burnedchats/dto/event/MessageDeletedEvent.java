package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Notifies a DM participant that a message was deleted for everyone.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageDeletedEvent {

    private boolean success;
    private String sessionId;
    private String messageId;
    private Long deletedByTgId;
    private boolean deletedByOwner;
    private Instant deletedAt;
    private String errorCode;
}
