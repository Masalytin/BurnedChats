package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import io.swagger.v3.oas.annotations.Hidden;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.telegram.telegrambots.meta.api.methods.BotApiMethod;
import org.telegram.telegrambots.meta.api.objects.Update;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * REST controller for receiving Telegram webhook updates.
 *
 * <p>Security (IMP-SECHARD-04):
 * <ul>
 *   <li>Validates {@code X-Telegram-Bot-Api-Secret-Token} with constant-time compare</li>
 *   <li>Prod profile is fail-closed when secret is unset</li>
 *   <li>Returns 401 Unauthorized without leaking details on mismatch / missing secret</li>
 * </ul>
 *
 * <p>Only active when webhook mode is enabled:
 * {@code telegram.bot.webhook.enabled=true}
 *
 * @see BurnedChatsWebhookBot
 * @see TelegramWebhookConfig
 */
@Slf4j
@Hidden
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
    private final Environment environment;

    /**
     * Handles incoming webhook updates from Telegram.
     *
     * @param secretToken Secret token from X-Telegram-Bot-Api-Secret-Token header
     * @param update      The incoming update from Telegram
     * @return BotApiMethod response or empty response
     */
    @PostMapping("/webhook")
    public ResponseEntity<BotApiMethod<?>> onUpdateReceived(
            @RequestHeader(value = SECRET_TOKEN_HEADER, required = false) String secretToken,
            @RequestBody Update update) {

        if (!isAuthorized(secretToken)) {
            LOG.warn("Webhook secret rejected (missing, mismatch, or unset in prod)");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        LOG.debug("Webhook update received: updateId={}, hasMessage={}, hasCallbackQuery={}",
                update.getUpdateId(),
                update.hasMessage(),
                update.hasCallbackQuery());

        try {
            BotApiMethod<?> response = webhookBot.onWebhookUpdateReceived(update);

            if (response != null) {
                LOG.debug("Webhook response: {}", response.getClass().getSimpleName());
                return ResponseEntity.ok(response);
            }

            return ResponseEntity.ok().build();
        } catch (Exception e) {
            LOG.error("Error processing webhook update: updateId={}",
                    update.getUpdateId(), e);
            // Return OK to prevent Telegram from retrying
            return ResponseEntity.ok().build();
        }
    }

    /**
     * Authorizes the webhook request.
     *
     * <ul>
     *   <li>Configured secret → constant-time equality with header</li>
     *   <li>Blank secret + {@code prod} profile → reject (fail-closed)</li>
     *   <li>Blank secret + non-prod → allow (dev soft path)</li>
     * </ul>
     */
    boolean isAuthorized(String providedSecret) {
        String configuredSecret = telegramProperties.getBot().getWebhook().getSecretToken();
        if (configuredSecret == null || configuredSecret.isBlank()) {
            return !environment.matchesProfiles("prod");
        }
        if (providedSecret == null) {
            return false;
        }
        byte[] expected = configuredSecret.getBytes(StandardCharsets.UTF_8);
        byte[] provided = providedSecret.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expected, provided);
    }
}
