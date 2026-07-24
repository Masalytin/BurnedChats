package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.telegram.telegrambots.meta.api.methods.AnswerInlineQuery;
import org.telegram.telegrambots.meta.api.objects.User;
import org.telegram.telegrambots.meta.api.objects.inlinequery.InlineQuery;
import org.telegram.telegrambots.meta.api.objects.inlinequery.inputmessagecontent.InputTextMessageContent;
import org.telegram.telegrambots.meta.api.objects.inlinequery.result.InlineQueryResultArticle;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.InlineKeyboardMarkup;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("InlineQueryService")
class InlineQueryServiceTest {

    private static final String TOKEN =
            "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    private static final long TG_ID = 424242L;
    private static final String LANG = "en";

    @Mock private BotMessageService botMessages;
    @Mock private RateLimitService rateLimitService;

    private TelegramProperties telegramProperties;
    private InlineQueryService service;

    @BeforeEach
    void setUp() {
        telegramProperties = new TelegramProperties();
        telegramProperties.getBot().setUsername("BurnedChatsBot");
        service = new InlineQueryService(botMessages, telegramProperties, rateLimitService);
    }

    private InlineQuery query(String text) {
        User from = new User();
        from.setId(TG_ID);
        from.setLanguageCode(LANG);
        return InlineQuery.builder()
                .id("iq-1")
                .from(from)
                .query(text)
                .offset("")
                .build();
    }

    @Nested
    @DisplayName("valid invite_{token}")
    class ValidInvite {

        @BeforeEach
        void stubMessages() {
            doNothing().when(rateLimitService)
                    .checkRateLimitBlocking(String.valueOf(TG_ID), RateLimitType.INLINE_QUERY);
            when(botMessages.get("bot.inline.invite.title", LANG)).thenReturn("Room invite");
            when(botMessages.get("bot.inline.invite.description", LANG))
                    .thenReturn("Join a Burned Chats encrypted room");
            when(botMessages.get(eq("bot.inline.invite.message"), eq(LANG), anyString()))
                    .thenAnswer(inv -> "Invite: " + inv.getArgument(2));
            when(botMessages.get("bot.inline.invite.button", LANG)).thenReturn("Open invite");
        }

        @Test
        void returnsSingleArticleWithoutRoomName() {
            AnswerInlineQuery answer = service.answer(query("invite_" + TOKEN));

            assertThat(answer.getInlineQueryId()).isEqualTo("iq-1");
            assertThat(answer.getResults()).hasSize(1);
            assertThat(answer.getCacheTime()).isEqualTo(InlineQueryService.CACHE_TIME_SECONDS);
            assertThat(answer.getIsPersonal()).isFalse();
            assertThat(answer.getButton()).isNull();

            InlineQueryResultArticle article = (InlineQueryResultArticle) answer.getResults().get(0);
            assertThat(article.getTitle()).isEqualTo("Room invite");
            assertThat(article.getDescription()).doesNotContainIgnoringCase("room name");
            assertThat(article.getTitle() + article.getDescription()).doesNotContain("Secret");

            InputTextMessageContent content =
                    (InputTextMessageContent) article.getInputMessageContent();
            String expectedUrl =
                    "https://t.me/BurnedChatsBot/app?startapp=invite_" + TOKEN;
            assertThat(content.getMessageText()).contains(expectedUrl);
            assertThat(content.getMessageText()).doesNotContain("Secret Room");

            InlineKeyboardMarkup markup = article.getReplyMarkup();
            assertThat(markup.getKeyboard()).hasSize(1);
            assertThat(markup.getKeyboard().get(0).get(0).getUrl()).isEqualTo(expectedUrl);
        }

        @Test
        void acceptsUppercaseHexToken() {
            String upper = TOKEN.toUpperCase();
            AnswerInlineQuery answer = service.answer(query("invite_" + upper));
            assertThat(answer.getResults()).hasSize(1);
        }
    }

    @Nested
    @DisplayName("invalid or empty query")
    class InvalidQuery {

        @BeforeEach
        void stubRateLimitAndSwitchPm() {
            doNothing().when(rateLimitService)
                    .checkRateLimitBlocking(String.valueOf(TG_ID), RateLimitType.INLINE_QUERY);
            when(botMessages.get("bot.inline.switchPm", LANG)).thenReturn("Open Burned Chats");
        }

        @Test
        void emptyQuery_returnsEmptyWithSwitchPm() {
            AnswerInlineQuery answer = service.answer(query(""));

            assertThat(answer.getResults()).isEmpty();
            assertThat(answer.getButton()).isNotNull();
            assertThat(answer.getButton().getText()).isEqualTo("Open Burned Chats");
            assertThat(answer.getButton().getStartParameter())
                    .isEqualTo(InlineQueryService.SWITCH_PM_PARAMETER);
            assertThat(answer.getIsPersonal()).isFalse();
        }

        @Test
        void arbitraryQuery_returnsEmptyWithSwitchPm() {
            AnswerInlineQuery answer = service.answer(query("hello rooms"));

            assertThat(answer.getResults()).isEmpty();
            assertThat(answer.getButton()).isNotNull();
            assertThat(answer.getButton().getText()).isEqualTo("Open Burned Chats");
        }

        @Test
        void shortToken_returnsEmptyWithSwitchPm() {
            AnswerInlineQuery answer = service.answer(query("invite_abc"));

            assertThat(answer.getResults()).isEmpty();
            assertThat(answer.getButton()).isNotNull();
            assertThat(answer.getButton().getText()).isNotBlank();
        }
    }

    @Nested
    @DisplayName("rate limiting")
    class RateLimiting {

        @Test
        void rateLimited_returnsEmptyWithoutSwitchPm() {
            doThrow(new RateLimitException(Duration.ofMinutes(1)))
                    .when(rateLimitService)
                    .checkRateLimitBlocking(String.valueOf(TG_ID), RateLimitType.INLINE_QUERY);

            AnswerInlineQuery answer = service.answer(query("invite_" + TOKEN));

            assertThat(answer.getResults()).isEmpty();
            assertThat(answer.getButton()).isNull();
            verify(rateLimitService)
                    .checkRateLimitBlocking(String.valueOf(TG_ID), RateLimitType.INLINE_QUERY);
        }
    }

    @Nested
    @DisplayName("token extraction")
    class TokenExtraction {

        @Test
        void extractInviteToken_valid() {
            assertThat(service.extractInviteToken("invite_" + TOKEN)).isEqualTo(TOKEN);
        }

        @Test
        void extractInviteToken_rejectsNonHex() {
            String bad = "z".repeat(64);
            assertThat(service.extractInviteToken("invite_" + bad)).isNull();
        }
    }
}
