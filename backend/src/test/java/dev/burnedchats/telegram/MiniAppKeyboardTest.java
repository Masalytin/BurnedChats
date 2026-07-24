package dev.burnedchats.telegram;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.InlineKeyboardMarkup;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.buttons.InlineKeyboardButton;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("MiniAppKeyboard (IMP-TGUX-03)")
class MiniAppKeyboardTest {

    private static final String BOT = "BurnedChatsBot";
    private static final String MINI_APP_URL = "https://app.example.com/app";
    private static final String BUTTON = "Open";

    @Test
    @DisplayName("with deepLinkParam uses t.me URL button with startapp")
    void withDeepLinkParam_usesStartAppUrlButton() {
        InlineKeyboardMarkup markup = MiniAppKeyboard.build(
                BOT, MINI_APP_URL, "dm_session-abc", BUTTON);

        InlineKeyboardButton button = markup.getKeyboard().get(0).get(0);
        assertThat(button.getText()).isEqualTo(BUTTON);
        assertThat(button.getUrl())
                .isEqualTo("https://t.me/BurnedChatsBot/app?startapp=dm_session-abc");
        assertThat(button.getWebApp()).isNull();
    }

    @Test
    @DisplayName("without deepLinkParam keeps WebAppInfo mini-app URL")
    void withoutDeepLinkParam_usesWebAppInfo() {
        InlineKeyboardMarkup markup = MiniAppKeyboard.build(
                BOT, MINI_APP_URL, null, BUTTON);

        InlineKeyboardButton button = markup.getKeyboard().get(0).get(0);
        assertThat(button.getText()).isEqualTo(BUTTON);
        assertThat(button.getUrl()).isNull();
        assertThat(button.getWebApp()).isNotNull();
        assertThat(button.getWebApp().getUrl()).isEqualTo(MINI_APP_URL);
    }

    @Test
    @DisplayName("empty deepLinkParam keeps WebAppInfo")
    void emptyDeepLinkParam_usesWebAppInfo() {
        InlineKeyboardMarkup markup = MiniAppKeyboard.build(
                BOT, MINI_APP_URL, "  ", BUTTON);

        InlineKeyboardButton button = markup.getKeyboard().get(0).get(0);
        assertThat(button.getWebApp()).isNotNull();
        assertThat(button.getUrl()).isNull();
    }
}
