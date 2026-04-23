package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;

/**
 * Request to notify peer about disconnection (5.1.5).
 *
 * <p>Sent when user closes Mini App to notify the peer
 * that the other participant has disconnected.
 *
 * @param sessionId session ID (required)
 * @param reason    reason for disconnect
 * @see dev.burnedchats.handler.SessionHandler#handlePeerDisconnect
 */
public record PeerDisconnectRequest(
        @NotBlank(message = "Session ID is required")
        String sessionId,
        String reason
) {
}
