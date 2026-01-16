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
     * Message-specific rate limits.
     */
    private Messages messages = new Messages();

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
     * Message rate limit configuration.
     */
    @Data
    public static class Messages {
        /**
         * Maximum messages per minute per user.
         */
        private int perMinute = 30;

        /**
         * Maximum messages per session total.
         */
        private int perSession = 100;
    }
}



