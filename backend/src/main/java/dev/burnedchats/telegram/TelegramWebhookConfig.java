package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.telegram.telegrambots.meta.api.methods.updates.SetWebhook;
import org.telegram.telegrambots.meta.exceptions.TelegramApiException;

/**
 * Configuration for Telegram Bot webhook mode.
 *
 * <p>This configuration is active when webhook is enabled:
 * {@code telegram.bot.webhook.enabled=true}
 *
 * <p>On application startup, it:
 * <ol>
 *   <li>Creates the webhook bot bean</li>
 *   <li>Registers the webhook URL with Telegram API</li>
 * </ol>
 *
 * <p>Required configuration:
 * <ul>
 *   <li>telegram.bot.token - Bot API token</li>
 *   <li>telegram.bot.webhook.url - Public HTTPS URL</li>
 *   <li>telegram.bot.webhook.path - Webhook endpoint path</li>
 *   <li>telegram.bot.webhook.secret-token - Optional secret for validation</li>
 * </ul>
 *
 * @see BurnedChatsWebhookBot
 * @see TelegramWebhookController
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
@ConditionalOnProperty(
        name = "telegram.bot.webhook.enabled",
        havingValue = "true"
)
public class TelegramWebhookConfig {

    private final TelegramProperties telegramProperties;
    private final BotMessageService botMessages;
    private final BotBurnCommandService burnCommandService;
    private final InlineQueryService inlineQueryService;

    /**
     * Creates the webhook bot bean.
     *
     * @return Configured BurnedChatsWebhookBot instance
     */
    @Bean
    public BurnedChatsWebhookBot burnedChatsWebhookBot() {
        String token = telegramProperties.getBot().getToken();

        if (token == null || token.isBlank()) {
            LOG.warn("Telegram bot token is not configured. Webhook bot will not work.");
            LOG.warn("Set TELEGRAM_BOT_TOKEN environment variable.");
        }

        return new BurnedChatsWebhookBot(
                telegramProperties, botMessages, burnCommandService, inlineQueryService);
    }

    /**
     * Registers webhook with Telegram API after application is ready.
     *
     * <p>This ensures all beans are initialized before making API calls.
     *
     * <p>Must remain zero-arg (or take only {@link ApplicationReadyEvent}): a
     * non-event parameter under {@code @EventListener(ApplicationReadyEvent.class)}
     * receives the event itself and fails with
     * {@code IllegalStateException: argument type mismatch} (regression from
     * IMP-BURNALL-06). The bot singleton is obtained via the {@code @Bean} method
     * (CGLIB-intercepted on {@code @Configuration}).
     */
    @EventListener(ApplicationReadyEvent.class)
    public void registerWebhook() {
        String token = telegramProperties.getBot().getToken();
        if (token == null || token.isBlank()) {
            LOG.warn("Cannot register webhook: bot token is not configured");
            return;
        }

        String webhookUrl = telegramProperties.getBot().getWebhook().getUrl();
        String webhookPath = telegramProperties.getBot().getWebhook().getPath();
        String secretToken = telegramProperties.getBot().getWebhook().getSecretToken();

        if (webhookUrl == null || webhookUrl.isBlank()) {
            LOG.error("Cannot register webhook: webhook URL is not configured");
            LOG.error("Set TELEGRAM_WEBHOOK_URL environment variable "
                    + "(e.g., https://yourdomain.com)");
            return;
        }

        // Build full URL: use base URL only (no path) so path is appended once
        String baseUrl = webhookUrl.trim().replaceAll("/+$", "");
        String path = webhookPath != null ? webhookPath.trim() : "";
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        // Avoid double path if url was set with path included
        String fullWebhookUrl = baseUrl.endsWith(path) ? baseUrl : baseUrl + path;

        try {
            SetWebhook.SetWebhookBuilder webhookBuilder = SetWebhook.builder()
                    .url(fullWebhookUrl)
                    .maxConnections(100)
                    .dropPendingUpdates(false);

            // Add secret token if configured
            if (secretToken != null && !secretToken.isBlank()) {
                webhookBuilder.secretToken(secretToken);
                LOG.debug("Webhook secret token configured");
            }

            SetWebhook setWebhook = webhookBuilder.build();

            BurnedChatsWebhookBot bot = burnedChatsWebhookBot();
            bot.setWebhook(setWebhook);

            LOG.info("Telegram webhook registered successfully");
            LOG.info("Webhook URL: {}", fullWebhookUrl);
            LOG.info("Bot username: @{}", telegramProperties.getBot().getUsername());

        } catch (TelegramApiException e) {
            LOG.error("Failed to register Telegram webhook at {}", fullWebhookUrl, e);
        }
    }
}
