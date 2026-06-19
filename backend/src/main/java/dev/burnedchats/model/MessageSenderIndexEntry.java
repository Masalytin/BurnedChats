package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Hash value for {@code message-senders:{sessionId}} — sender identity for DM delete ownership.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageSenderIndexEntry implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * Stable sender identity (primary for wallet + Telegram).
     */
    private String senderInternalId;

    /**
     * Legacy Telegram user id; omitted when absent or zero.
     */
    private Long senderId;
}
