package dev.burnedchats.dto.event;

import lombok.Builder;
import lombok.Getter;

import java.time.Instant;

/**
 * Event sent to peer when the other participant disconnects (5.1.5).
 *
 * <p>This is sent when:
 * <ul>
 *   <li>User closes the Mini App</li>
 *   <li>WebSocket connection is lost for extended period</li>
 *   <li>User explicitly ends the session</li>
 * </ul>
 *
 * @see dev.burnedchats.handler.SessionHandler#handlePeerDisconnect
 */
@Getter
@Builder
public class PeerDisconnectedEvent {

    /**
     * Session ID.
     */
    private final String sessionId;

    /**
     * Telegram user ID of the disconnected peer.
     */
    private final Long peerId;

    /**
     * Stable internal id of the disconnected peer (wallet-safe).
     */
    private final String internalId;

    /**
     * Reason for disconnect.
     */
    private final DisconnectReason reason;

    /**
     * Server timestamp.
     */
    @Builder.Default
    private final Instant timestamp = Instant.now();

    /**
     * Reasons why peer disconnected.
     */
    public enum DisconnectReason {
        /**
         * User closed the Mini App.
         */
        APP_CLOSED,

        /**
         * WebSocket connection lost.
         */
        CONNECTION_LOST,

        /**
         * Session was burned.
         */
        BURNED,

        /**
         * Unknown reason.
         */
        UNKNOWN
    }

    /**
     * Create event for app closed.
     */
    public static PeerDisconnectedEvent appClosed(String sessionId, Long peerId) {
        return appClosed(sessionId, peerId, null);
    }

    public static PeerDisconnectedEvent appClosed(String sessionId, Long peerId, String internalId) {
        return PeerDisconnectedEvent.builder()
                .sessionId(sessionId)
                .peerId(peerId)
                .internalId(internalId)
                .reason(DisconnectReason.APP_CLOSED)
                .build();
    }

    /**
     * Create event for connection lost.
     */
    public static PeerDisconnectedEvent connectionLost(String sessionId, Long peerId) {
        return PeerDisconnectedEvent.builder()
                .sessionId(sessionId)
                .peerId(peerId)
                .reason(DisconnectReason.CONNECTION_LOST)
                .build();
    }
}
