package dev.burnedchats.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Configuration properties for WebSocket/STOMP.
 *
 * <p>Binds to properties under the {@code websocket} prefix in application.yml.
 */
@Data
@Component
@ConfigurationProperties(prefix = "websocket")
public class WebSocketProperties {

    /**
     * Heartbeat configuration.
     */
    private Heartbeat heartbeat = new Heartbeat();

    /**
     * Message configuration.
     */
    private Message message = new Message();

    /**
     * Send configuration.
     */
    private Send send = new Send();

    /**
     * STOMP CONNECT authentication configuration.
     */
    private Auth auth = new Auth();

    /**
     * Heartbeat settings.
     */
    @Data
    public static class Heartbeat {
        /**
         * Server heartbeat interval in milliseconds.
         */
        private long server = 10000;

        /**
         * Expected client heartbeat interval in milliseconds.
         */
        private long client = 10000;
    }

    /**
     * Message settings.
     */
    @Data
    public static class Message {
        /**
         * Maximum message size in bytes.
         */
        private int maxSize = 65536;
    }

    /**
     * Send settings.
     */
    @Data
    public static class Send {
        /**
         * Send buffer size in bytes.
         */
        private int bufferSize = 524288;

        /**
         * Send timeout in milliseconds.
         */
        private int timeout = 15000;
    }

    /**
     * WebSocket handshake auth settings ({@code StompIdentityAuthService.awaitAuth} bridge).
     */
    @Data
    public static class Auth {
        /**
         * Max wait for reactive identity lookup/persist during WebSocket handshake auth.
         */
        private Duration timeout = Duration.ofSeconds(30);
    }
}



