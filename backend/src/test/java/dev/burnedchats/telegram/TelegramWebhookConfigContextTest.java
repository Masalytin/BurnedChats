package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.ConfigurableApplicationContext;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Regression for IMP-BURNALL-06 startup crash: {@code registerWebhook(BurnedChatsWebhookBot)}
 * under {@code @EventListener(ApplicationReadyEvent.class)} received the event as arg[0]
 * ({@code IllegalStateException: argument type mismatch}) instead of the bot bean.
 */
@DisplayName("TelegramWebhookConfig ApplicationReadyEvent listener")
class TelegramWebhookConfigContextTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withPropertyValues("telegram.bot.webhook.enabled=true")
            .withUserConfiguration(TelegramWebhookConfig.class)
            .withBean(TelegramProperties.class, () -> {
                TelegramProperties props = new TelegramProperties();
                // Non-blank token so the bot bean constructs; blank webhook URL so
                // registerWebhook returns before calling Telegram setWebhook.
                props.getBot().setToken("123456:TEST-TOKEN");
                props.getBot().setUsername("test_bot");
                return props;
            })
            .withBean(BotMessageService.class, () -> {
                BotMessageService botMessages = mock(BotMessageService.class);
                when(botMessages.get(anyString(), anyString())).thenReturn("cmd");
                return botMessages;
            })
            .withBean(BotBurnCommandService.class, () -> mock(BotBurnCommandService.class))
            .withBean(InlineQueryService.class, () -> mock(InlineQueryService.class));

    @Test
    @DisplayName("ApplicationReadyEvent invokes registerWebhook without argument type mismatch")
    void applicationReadyEventResolvesWebhookBotParameter() {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(BurnedChatsWebhookBot.class);

            ConfigurableApplicationContext source =
                    context.getSourceApplicationContext();
            ApplicationReadyEvent readyEvent = new ApplicationReadyEvent(
                    new SpringApplication(),
                    new String[0],
                    source,
                    Duration.ZERO);

            assertThatCode(() -> context.publishEvent(readyEvent))
                    .doesNotThrowAnyException();
        });
    }
}
