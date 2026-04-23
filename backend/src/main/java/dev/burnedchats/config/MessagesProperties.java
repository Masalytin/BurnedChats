package dev.burnedchats.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Configuration properties for offline message delivery.
 *
 * <p>Binds to properties under the {@code burnedchats.messages} prefix
 * in {@code application.yml}.
 *
 * @see dev.burnedchats.websocket.WebSocketEventListener
 */
@Data
@Component
@ConfigurationProperties(prefix = "burnedchats.messages")
public class MessagesProperties {

    /**
     * Server-initiated sync on STOMP CONNECT.
     */
    private ServerPushSync serverPushSync = new ServerPushSync();

    /**
     * Durable offline message lists (1-to-1 and room) in Redis: TTL, max length, and metrics.
     */
    private OfflineQueue offlineQueue = new OfflineQueue();

    /**
     * Server-push sync configuration.
     *
     * <p>When enabled, the backend fans out {@code SyncMessagesEvent} to the
     * freshly-connected user for every session that has pending messages in
     * Redis, without waiting for an explicit {@code /app/message.sync}
     * request from the client.
     */
    @Data
    public static class ServerPushSync {
        /**
         * Whether to push pending messages on STOMP CONNECT.
         * Default: {@code true}.
         */
        private boolean enabled = true;

        /**
         * Maximum concurrent per-session fan-out operations for a single user.
         * Prevents overload when many sessions have pending messages.
         * Default: {@code 4}.
         */
        private int concurrency = 4;
    }

    /**
     * Per-Redis list limits for messages:{recipient}:{session} (DM) and
     * messages:{roomId} (room). Must not exceed the active session/room data TTL
     * policy (see {@code session.active.ttl} and room metadata TTL).
     */
    @Data
    public static class OfflineQueue {
        /**
         * TTL for offline message list keys. Default: 24 hours (must stay within session/room life).
         */
        private Duration ttl = Duration.ofHours(24);

        /**
         * Max messages per 1:1 session offline queue. Oldest are trimmed on overflow.
         */
        private int maxSizePerSession = 100;

        /**
         * Max messages in the per-room list (separate from DM cap).
         */
        private int maxSizePerRoom = 500;

        /**
         * Subscribe to Redis keyspace expirations (requires
         * {@code notify-keyspace-events} in Redis, e.g. {@code Ee} or {@code AKE} for expired).
         * Disable in tests to avoid a second connection.
         */
        private boolean keyspaceListenerEnabled = true;
    }
}
