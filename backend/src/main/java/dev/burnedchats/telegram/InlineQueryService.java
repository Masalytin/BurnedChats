package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.telegram.telegrambots.meta.api.methods.AnswerInlineQuery;
import org.telegram.telegrambots.meta.api.objects.inlinequery.InlineQuery;
import org.telegram.telegrambots.meta.api.objects.inlinequery.inputmessagecontent.InputTextMessageContent;
import org.telegram.telegrambots.meta.api.objects.inlinequery.result.InlineQueryResult;
import org.telegram.telegrambots.meta.api.objects.inlinequery.result.InlineQueryResultArticle;
import org.telegram.telegrambots.meta.api.objects.inlinequery.result.InlineQueryResultsButton;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.InlineKeyboardMarkup;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.buttons.InlineKeyboardButton;

import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Handles Telegram {@code inline_query} updates for invite-card sharing.
 *
 * <p>Only {@code invite_{token}} queries produce a result. Token format is validated
 * locally — existence is checked at join time, not here (no Redis lookup). Room titles
 * are never included (zero-knowledge).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InlineQueryService {

    static final String INVITE_PREFIX = "invite_";
    /** 32-byte hex tokens from {@link dev.burnedchats.service.InviteTokenService}. */
    static final Pattern TOKEN_HEX = Pattern.compile("^[a-fA-F0-9]{64}$");
    /** Generic cacheable answers; shared across users for the same query string. */
    static final int CACHE_TIME_SECONDS = 300;
    /** Deep-link param for switch-to-PM when the query is empty/invalid. */
    static final String SWITCH_PM_PARAMETER = "open";

    private final BotMessageService botMessages;
    private final TelegramProperties telegramProperties;
    private final RateLimitService rateLimitService;

    /**
     * Build an {@link AnswerInlineQuery} for the given update.
     *
     * @param inlineQuery Telegram inline query
     * @return answer to return from webhook or execute via long-polling bot
     */
    public AnswerInlineQuery answer(InlineQuery inlineQuery) {
        String queryId = inlineQuery.getId();
        String lang = inlineQuery.getFrom() != null
                ? inlineQuery.getFrom().getLanguageCode()
                : null;
        long telegramUserId = inlineQuery.getFrom() != null
                ? inlineQuery.getFrom().getId()
                : 0L;

        if (!allowInlineQuery(telegramUserId)) {
            LOG.debug("Inline query rate-limited for tgId={}", telegramUserId);
            return emptyAnswer(queryId, false, lang);
        }

        String token = extractInviteToken(inlineQuery.getQuery());
        if (token == null) {
            return emptyAnswer(queryId, true, lang);
        }

        return inviteArticleAnswer(queryId, token, lang);
    }

    /**
     * Parse {@code invite_{token}} and validate hex format. No Redis lookup.
     *
     * @return token hex or {@code null} if invalid / empty
     */
    String extractInviteToken(String query) {
        if (!StringUtils.hasText(query)) {
            return null;
        }
        String trimmed = query.trim();
        if (!trimmed.startsWith(INVITE_PREFIX)) {
            return null;
        }
        String token = trimmed.substring(INVITE_PREFIX.length());
        if (!TOKEN_HEX.matcher(token).matches()) {
            return null;
        }
        return token;
    }

    private boolean allowInlineQuery(long telegramUserId) {
        if (telegramUserId <= 0) {
            return true;
        }
        try {
            rateLimitService.checkRateLimitBlocking(
                    String.valueOf(telegramUserId), RateLimitType.INLINE_QUERY);
            return true;
        } catch (RateLimitException e) {
            return false;
        }
    }

    private AnswerInlineQuery inviteArticleAnswer(String queryId, String token, String lang) {
        String botUsername = telegramProperties.getBot().getUsername();
        String deepLink = "https://t.me/" + botUsername + "/app?startapp=" + INVITE_PREFIX + token;

        String title = botMessages.get("bot.inline.invite.title", lang);
        String description = botMessages.get("bot.inline.invite.description", lang);
        String messageText = botMessages.get("bot.inline.invite.message", lang, deepLink);
        String buttonText = botMessages.get("bot.inline.invite.button", lang);

        InputTextMessageContent content = InputTextMessageContent.builder()
                .messageText(messageText)
                .parseMode("HTML")
                .disableWebPagePreview(false)
                .build();

        InlineKeyboardButton openButton = InlineKeyboardButton.builder()
                .text(buttonText)
                .url(deepLink)
                .build();
        InlineKeyboardMarkup markup = InlineKeyboardMarkup.builder()
                .keyboard(List.of(List.of(openButton)))
                .build();

        InlineQueryResultArticle article = InlineQueryResultArticle.builder()
                .id("invite-" + token.substring(0, 16))
                .title(title)
                .description(description)
                .inputMessageContent(content)
                .replyMarkup(markup)
                .build();

        return AnswerInlineQuery.builder()
                .inlineQueryId(queryId)
                .results(List.<InlineQueryResult>of(article))
                .cacheTime(CACHE_TIME_SECONDS)
                .isPersonal(false)
                .build();
    }

    private AnswerInlineQuery emptyAnswer(String queryId, boolean withSwitchPm, String lang) {
        AnswerInlineQuery.AnswerInlineQueryBuilder builder = AnswerInlineQuery.builder()
                .inlineQueryId(queryId)
                .results(Collections.emptyList())
                .cacheTime(CACHE_TIME_SECONDS)
                .isPersonal(false);

        if (withSwitchPm) {
            // Prefer non-deprecated button API; JSON still exposes switch-to-PM UX.
            builder.button(InlineQueryResultsButton.builder()
                    .text(botMessages.get("bot.inline.switchPm", lang))
                    .startParameter(SWITCH_PM_PARAMETER)
                    .build());
        }

        return builder.build();
    }
}
