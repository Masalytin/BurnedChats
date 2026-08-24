package dev.burnedchats.telegram;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.telegram.telegrambots.meta.api.methods.updates.SetWebhook;
import org.telegram.telegrambots.meta.exceptions.TelegramApiException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Regression: TelegramBots {@code TelegramWebhookBot.setWebhook()} rewrites the URL to
 * {@code {url}/callback/{botPath}} (WebhookUtils.getBotUrl). That produced
 * {@code /api/telegram/webhook/callback/api/telegram/webhook} on prod (404).
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("TelegramWebhookConfig public webhook URL")
class TelegramWebhookConfigUrlTest {

    @Mock
    private BurnedChatsWebhookBot bot;

    @Test
    @DisplayName("does not re-append path when TELEGRAM_WEBHOOK_URL already includes it")
    void resolveDoesNotDoubleAppendPath() {
        String url = TelegramWebhookConfig.resolvePublicWebhookUrl(
                "https://burnedchats.net/api/telegram/webhook",
                "/api/telegram/webhook");

        assertThat(url).isEqualTo("https://burnedchats.net/api/telegram/webhook");
    }

    @Test
    @DisplayName("appends path when URL is origin only")
    void resolveAppendsPathToOrigin() {
        String url = TelegramWebhookConfig.resolvePublicWebhookUrl(
                "https://burnedchats.net",
                "/api/telegram/webhook");

        assertThat(url).isEqualTo("https://burnedchats.net/api/telegram/webhook");
    }

    @Test
    @DisplayName("strips trailing slash on origin before appending path")
    void resolveStripsTrailingSlash() {
        String url = TelegramWebhookConfig.resolvePublicWebhookUrl(
                "https://burnedchats.net/",
                "/api/telegram/webhook");

        assertThat(url).isEqualTo("https://burnedchats.net/api/telegram/webhook");
    }

    @Test
    @DisplayName("sends SetWebhook via execute so the library does not insert /callback/")
    void sendUsesExecuteNotLibrarySetWebhook() throws TelegramApiException {
        SetWebhook request = SetWebhook.builder()
                .url("https://burnedchats.net/api/telegram/webhook")
                .maxConnections(100)
                .build();
        when(bot.execute(request)).thenReturn(true);

        TelegramWebhookConfig.sendSetWebhook(bot, request);

        verify(bot).execute(request);
        verify(bot, never()).setWebhook(any());
    }
}
