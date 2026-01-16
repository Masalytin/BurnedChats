package dev.burnedchats.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration properties for chat sessions.
 *
 * <p>Binds to properties under the {@code session} prefix in application.yml.
 */
@Data
@Component
@ConfigurationProperties(prefix = "session")
public class SessionProperties {

    /**
     * Chat request settings.
     */
    private Request request = new Request();

    /**
     * Active session settings.
     */
    private Active active = new Active();

    /**
     * Handshake settings.
     */
    private Handshake handshake = new Handshake();

    /**
     * Chat request configuration.
     */
    @Data
    public static class Request {
        /**
         * Time-to-live for pending requests in seconds.
         * Default: 5 minutes.
         */
        private int ttl = 300;
    }

    /**
     * Active session configuration.
     */
    @Data
    public static class Active {
        /**
         * Time-to-live for active sessions in seconds (from last activity).
         * Default: 1 hour.
         */
        private int ttl = 3600;
    }

    /**
     * Handshake configuration.
     */
    @Data
    public static class Handshake {
        /**
         * Timeout for handshake completion in seconds.
         * Default: 30 seconds.
         */
        private int timeout = 30;
    }
}



