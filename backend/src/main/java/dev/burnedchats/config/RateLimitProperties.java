package dev.burnedchats.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration properties for rate limiting.
 *
 * <p>Binds to properties under the {@code rate-limit} prefix in application.yml.
 */
@Data
@Component
@ConfigurationProperties(prefix = "rate-limit")
public class RateLimitProperties {

    /**
     * Whether rate limiting is enabled.
     */
    private boolean enabled = true;

    /**
     * General request rate limits.
     */
    private Requests requests = new Requests();

    /**
     * Message-specific rate limits (drives {@code RateLimitType.MESSAGE}).
     */
    private Messages messages = new Messages();

    /**
     * Failed room-password proof attempts (drives {@code RateLimitType.ROOM_PASSWORD_FAIL}).
     */
    private RoomPasswordFail roomPasswordFail = new RoomPasswordFail();

    /**
     * Request rate limit configuration.
     */
    @Data
    public static class Requests {
        /**
         * Maximum requests per minute per user.
         */
        private int perMinute = 60;

        /**
         * Maximum requests per hour per user.
         */
        private int perHour = 1000;
    }

    /**
     * Message rate limit configuration — source of truth for {@code MESSAGE} bucket.
     */
    @Data
    public static class Messages {
        /**
         * Maximum messages per minute per user (aligned with historical enum default of 60).
         */
        private int perMinute = 60;

        /**
         * Maximum messages per session total (reserved; not yet wired to a counter).
         */
        private int perSession = 100;
    }

    /**
     * Brute-force protection for room password proofs (SECURITY.md §room password).
     */
    @Data
    public static class RoomPasswordFail {
        /**
         * Maximum failed proof attempts in the window.
         */
        private int perWindow = 5;

        /**
         * Window length in seconds (default 600 = 10 minutes).
         */
        private int windowSeconds = 600;
    }
}
