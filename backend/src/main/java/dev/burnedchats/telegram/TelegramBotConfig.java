package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.telegram.telegrambots.meta.TelegramBotsApi;
import org.telegram.telegrambots.meta.exceptions.TelegramApiException;
import org.telegram.telegrambots.updatesreceivers.DefaultBotSession;

/**
 * Configuration for Telegram Bot registration.
 *
 * <p>Registers the bot with TelegramBotsApi for Long Polling mode.
 * Only active when webhook is disabled (development mode).
 *
 * <p>For production with webhook, see webhook controller (Sprint 2.1.6).
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
@ConditionalOnProperty(
        name = "telegram.bot.webhook.enabled",
        havingValue = "false",
        matchIfMissing = true
)
public class TelegramBotConfig {

    private final TelegramProperties telegramProperties;

    /**
     * Creates and configures TelegramBotsApi for Long Polling.
     *
     * @param bot The BurnedChatsBot instance to register
     * @return Configured TelegramBotsApi
     * @throws TelegramApiException if registration fails
     */
    @Bean
    public TelegramBotsApi telegramBotsApi(BurnedChatsBot bot) throws TelegramApiException {
        String token = telegramProperties.getBot().getToken();
        
        if (token == null || token.isBlank()) {
            LOG.warn("Telegram bot token is not configured. Bot will not be registered.");
            LOG.warn("Set TELEGRAM_BOT_TOKEN environment variable to enable the bot.");
            return new TelegramBotsApi(DefaultBotSession.class);
        }

        TelegramBotsApi api = new TelegramBotsApi(DefaultBotSession.class);
        
        try {
            api.registerBot(bot);
            LOG.info("Telegram bot registered successfully in Long Polling mode");
            LOG.info("Bot username: @{}", telegramProperties.getBot().getUsername());
        } catch (TelegramApiException e) {
            LOG.error("Failed to register Telegram bot", e);
            throw e;
        }

        return api;
    }
}
