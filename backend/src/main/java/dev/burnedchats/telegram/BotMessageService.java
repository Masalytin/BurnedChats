package dev.burnedchats.telegram;

import dev.burnedchats.repository.LanguagePreferenceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.util.Locale;

/**
 * Service for retrieving localized bot messages.
 * Maps Telegram language_code to Java Locale and resolves messages
 * from the MessageSource.
 *
 * <p>Supports two lookup modes:
 * <ul>
 *   <li>{@link #get} — synchronous lookup by explicit language code</li>
 *   <li>{@link #getForUser} — reactive lookup using Redis-stored user preference</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class BotMessageService {

    private final MessageSource messageSource;
    private final LanguagePreferenceRepository languagePreferenceRepository;

    /**
     * Gets localized message using stored user preference from Redis.
     * Falls back to Telegram language_code if no preference saved.
     *
     * @param key    Message key (e.g. "bot.notify.chatRequest")
     * @param userId Telegram user ID (for Redis lookup)
     * @param args   Optional interpolation arguments
     * @return Mono with localized message string
     */
    public Mono<String> getForUser(String key, Long userId, Object... args) {
        return languagePreferenceRepository.findByUserId(userId)
                .defaultIfEmpty("")
                .map(savedLang -> {
                    String lang = savedLang.isBlank() ? null : savedLang;
                    return get(key, lang, args);
                });
    }

    /**
     * Gets a localized message by key and language code directly (sync).
     * Use when language_code is already known (e.g., from incoming Telegram message).
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
        if (languageCode == null) {
            return Locale.ENGLISH;
        }
        String normalized = languageCode.toLowerCase();
        if (normalized.startsWith("zh")) {
            return Locale.forLanguageTag("zh"); // messages_zh.properties
        }
        return switch (normalized) {
            case "ar" -> Locale.forLanguageTag("ar");
            case "de" -> Locale.GERMAN;
            case "es" -> Locale.forLanguageTag("es");
            case "fr" -> Locale.FRENCH;
            case "ru" -> Locale.forLanguageTag("ru");
            case "uk" -> Locale.forLanguageTag("uk");
            default -> Locale.ENGLISH;
        };
    }
}
