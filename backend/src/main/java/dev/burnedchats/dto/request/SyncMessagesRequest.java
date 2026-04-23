package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;

/**
 * Request to sync pending messages after reconnection.
 *
 * <p>Sent by the client after reconnecting to retrieve any messages
 * that were queued while offline. Semantics: full offline queue drain —
 * the server returns every message currently stored in
 * {@code messages:{userId}:{sessionId}} and deletes the key.
 *
 * @param sessionId session ID to sync messages for
 * @see dev.burnedchats.handler.MessageHandler#syncMessages
 */
public record SyncMessagesRequest(
        @NotBlank(message = "Session ID is required")
        String sessionId
) {
}
