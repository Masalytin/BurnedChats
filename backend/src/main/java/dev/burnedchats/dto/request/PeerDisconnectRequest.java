package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;

/**
 * Request to notify peer about disconnection (5.1.5).
 *
 * <p>Sent when user closes Mini App to notify the peer
 * that the other participant has disconnected.
 *
 * @see dev.burnedchats.handler.SessionHandler#handlePeerDisconnect
 */
public record PeerDisconnectRequest(
        /**
         * Session ID.
         */
        @NotBlank(message = "Session ID is required")
        String sessionId,

        /**
         * Reason for disconnect.
         */
        String reason
) {
}
