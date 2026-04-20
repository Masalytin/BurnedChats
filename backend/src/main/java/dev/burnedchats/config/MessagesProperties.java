package dev.burnedchats.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

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
}
