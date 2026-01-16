package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.telegram.telegrambots.meta.api.methods.BotApiMethod;
import org.telegram.telegrambots.meta.api.objects.Update;

/**
 * REST controller for receiving Telegram webhook updates.
 *
 * <p>This controller handles incoming webhook requests from Telegram's servers.
 * It validates the secret token and delegates update processing to the webhook bot.
 *
 * <p>Security:
 * <ul>
 *   <li>Validates X-Telegram-Bot-Api-Secret-Token header</li>
 *   <li>Returns 401 Unauthorized for invalid tokens</li>
 *   <li>Logs all incoming updates for debugging</li>
 * </ul>
 *
 * <p>Only active when webhook mode is enabled:
 * {@code telegram.bot.webhook.enabled=true}
 *
 * @see BurnedChatsWebhookBot
 * @see TelegramWebhookConfig
 */
@Slf4j
@RestController
@RequestMapping("/api/telegram")
@RequiredArgsConstructor
@ConditionalOnProperty(
        name = "telegram.bot.webhook.enabled",
        havingValue = "true"
)
public class TelegramWebhookController {

    private static final String SECRET_TOKEN_HEADER = "X-Telegram-Bot-Api-Secret-Token";

    private final BurnedChatsWebhookBot webhookBot;
    private final TelegramProperties telegramProperties;

    /**
     * Handles incoming webhook updates from Telegram.
     *
     * <p>Telegram sends updates to this endpoint when webhook is configured.
     * The update is validated and processed by the webhook bot.
     *
     * @param secretToken Secret token from X-Telegram-Bot-Api-Secret-Token header
     * @param update      The incoming update from Telegram
     * @return BotApiMethod response or empty response
     */
    @PostMapping("/webhook")
    public ResponseEntity<BotApiMethod<?>> onUpdateReceived(
            @RequestHeader(value = SECRET_TOKEN_HEADER, required = false) String secretToken,
            @RequestBody Update update) {

        // Validate secret token if configured
        String configuredSecret = telegramProperties.getBot().getWebhook().getSecretToken();
        if (configuredSecret != null && !configuredSecret.isBlank()) {
            if (secretToken == null || !secretToken.equals(configuredSecret)) {
                log.warn("Invalid webhook secret token received. "
                        + "Expected: [REDACTED], Got: {}", 
                        secretToken == null ? "null" : "[REDACTED]");
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }
        }

        log.debug("Webhook update received: updateId={}, hasMessage={}, hasCallbackQuery={}",
                update.getUpdateId(),
                update.hasMessage(),
                update.hasCallbackQuery());

        try {
            BotApiMethod<?> response = webhookBot.onWebhookUpdateReceived(update);

            if (response != null) {
                log.debug("Webhook response: {}", response.getClass().getSimpleName());
                return ResponseEntity.ok(response);
            }

            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("Error processing webhook update: updateId={}", 
                    update.getUpdateId(), e);
            // Return OK to prevent Telegram from retrying
            return ResponseEntity.ok().build();
        }
    }
}
