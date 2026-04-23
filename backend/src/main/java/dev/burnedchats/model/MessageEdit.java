package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;

/**
 * Pending DM message edit for a recipient (tombstone queue) when the original
 * was already removed from the offline delivery list.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageEdit implements Serializable {

    private static final long serialVersionUID = 1L;

    private String messageId;
    private String sessionId;
    private Long senderId;
    private String encryptedContent;
    private String iv;
    private Instant editedAt;
}
