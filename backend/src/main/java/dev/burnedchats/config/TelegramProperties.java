package dev.burnedchats.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.validation.annotation.Validated;

/**
 * Configuration properties for Telegram Bot and Mini App.
 *
 * <p>Binds to properties under the {@code telegram} prefix in application.yml.
 *
 * <p>Example usage:
 * <pre>{@code
 * @Autowired
 * private TelegramProperties telegramProperties;
 *
 * public void sendNotification() {
 *     String token = telegramProperties.getBot().getToken();
 *     // ...
 * }
 * }</pre>
 */
@Data
@Component
@Validated
@ConfigurationProperties(prefix = "telegram")
public class TelegramProperties {

    /**
     * Bot configuration.
     */
    private Bot bot = new Bot();

    /**
     * Mini App configuration.
     */
    private MiniApp miniApp = new MiniApp();

    /**
     * Telegram Bot settings.
     */
    @Data
    public static class Bot {
        /**
         * Bot API token from @BotFather.
         */
        private String token;

        /**
         * Bot username (without @).
         */
        private String username;

        /**
         * Webhook configuration.
         */
        private Webhook webhook = new Webhook();
    }

    /**
     * Webhook settings for production.
     */
    @Data
    public static class Webhook {
        /**
         * Whether webhook is enabled (vs long polling).
         */
        private boolean enabled = false;

        /**
         * Public URL for webhook endpoint.
         */
        private String url;

        /**
         * Webhook path (appended to base URL).
         */
        private String path = "/api/telegram/webhook";

        /**
         * Secret token for webhook verification.
         */
        private String secretToken;
    }

    /**
     * Mini App settings.
     */
    @Data
    public static class MiniApp {
        /**
         * Mini App URL (for deep links).
         */
        private String url;

        /**
         * Authentication settings.
         */
        private Auth auth = new Auth();
    }

    /**
     * Mini App authentication settings.
     */
    @Data
    public static class Auth {
        /**
         * Maximum age of initData in seconds.
         */
        private int maxAge = 300;
    }
}



