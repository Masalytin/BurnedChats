package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;

/**
 * Request to sync pending messages after reconnection.
 *
 * <p>Sent by the client after reconnecting to retrieve any messages
 * that were queued while offline.
 *
 * @see dev.burnedchats.handler.MessageHandler#syncMessages
 */
public record SyncMessagesRequest(
        /**
         * Session ID to sync messages for.
         */
        @NotBlank(message = "Session ID is required")
        String sessionId,

        /**
         * Optional: timestamp of last received message.
         * Messages after this timestamp will be returned.
         * If null, all pending messages are returned.
         */
        Long lastMessageTimestamp
) {
}
