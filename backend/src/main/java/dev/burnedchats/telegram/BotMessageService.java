package dev.burnedchats.telegram;

import lombok.RequiredArgsConstructor;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Service;

import java.util.Locale;

/**
 * Service for retrieving localized bot messages.
 * Maps Telegram language_code to Java Locale and resolves messages
 * from the MessageSource.
 */
@Service
@RequiredArgsConstructor
public class BotMessageService {

    private final MessageSource messageSource;

    /**
     * Gets a localized message by key and language code.
     *
     * @param key          Message key (e.g. "bot.start.text")
     * @param languageCode Telegram user language_code (e.g. "ru", "en")
     * @param args         Optional interpolation arguments
     * @return Localized message string, falls back to key if not found
     */
    public String get(String key, String languageCode, Object... args) {
        Locale locale = resolveLocale(languageCode);
        return messageSource.getMessage(key, args, key, locale);
    }

    private Locale resolveLocale(String languageCode) {
        if (languageCode == null) return Locale.ENGLISH;
        return switch (languageCode) {
            case "ru" -> Locale.forLanguageTag("ru");
            default -> Locale.ENGLISH;
        };
    }
}
