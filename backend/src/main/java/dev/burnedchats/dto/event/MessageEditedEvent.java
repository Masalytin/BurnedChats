package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Event sent to session participants when a DM message was edited.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageEditedEvent {

    private boolean success;
    private String sessionId;
    private String messageId;
    private String encryptedContent;
    private String iv;
    private Instant editedAt;
    private String errorCode;
}
