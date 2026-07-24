package dev.burnedchats.telegram;

import org.springframework.util.StringUtils;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.InlineKeyboardMarkup;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.buttons.InlineKeyboardButton;
import org.telegram.telegrambots.meta.api.objects.webapp.WebAppInfo;

import java.util.ArrayList;
import java.util.List;

/**
 * Shared Mini App inline keyboard for bot notifications and /start.
 *
 * <p>When a deep-link param is present, uses a URL button
 * {@code https://t.me/{bot}/app?startapp={param}} so Telegram fills
 * {@code initDataUnsafe.start_param}. Bare open (no param) keeps {@code WebAppInfo}.
 */
final class MiniAppKeyboard {

    private MiniAppKeyboard() {
    }

    static InlineKeyboardMarkup build(
            String botUsername,
            String miniAppUrl,
            String deepLinkParam,
            String buttonText) {
        InlineKeyboardButton.InlineKeyboardButtonBuilder buttonBuilder =
                InlineKeyboardButton.builder().text(buttonText);

        if (StringUtils.hasText(deepLinkParam) && StringUtils.hasText(botUsername)) {
            String url = "https://t.me/" + botUsername.trim() + "/app?startapp=" + deepLinkParam.trim();
            buttonBuilder.url(url);
        } else {
            buttonBuilder.webApp(new WebAppInfo(miniAppUrl));
        }

        List<InlineKeyboardButton> row = new ArrayList<>();
        row.add(buttonBuilder.build());

        List<List<InlineKeyboardButton>> keyboard = new ArrayList<>();
        keyboard.add(row);

        return InlineKeyboardMarkup.builder()
                .keyboard(keyboard)
                .build();
    }
}
