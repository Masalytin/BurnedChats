package dev.burnedchats.telegram;

import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.service.UserBurnService;
import dev.burnedchats.service.UserBurnService.BurnAllSummary;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import org.telegram.telegrambots.meta.api.methods.send.SendMessage;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.InlineKeyboardMarkup;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.buttons.InlineKeyboardButton;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("BotBurnCommandService")
class BotBurnCommandServiceTest {

    private static final long CHAT_ID = 42L;
    private static final long TG_ID = 123456789L;
    private static final String INTERNAL_ID = "internal-abc";
    private static final String LANG = "en";

    @Mock private UserIdentityRepository userIdentityRepository;
    @Mock private UserBurnService userBurnService;
    @Mock private BotMessageService botMessages;
    @Mock private ReactiveRedisTemplate<String, String> redisTemplate;
    @Mock private ReactiveValueOperations<String, String> valueOps;
    @Mock private StompUserMessenger stompUserMessenger;

    private BotBurnCommandService service;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        service = new BotBurnCommandService(
                userIdentityRepository,
                userBurnService,
                botMessages,
                redisTemplate,
                stompUserMessenger);
    }

    @Nested
    @DisplayName("/burn command")
    class BurnCommand {

        @Test
        void unknownTelegramUser_returnsNoDataMessageWithoutKeyboard() {
            when(userIdentityRepository.findByTelegramId(TG_ID)).thenReturn(Mono.empty());
            when(botMessages.get("bot.burn.noData", LANG)).thenReturn("No data to burn.");

            StepVerifier.create(service.handleBurnCommand(CHAT_ID, TG_ID, LANG))
                    .assertNext(message -> {
                        assertThat(message.getChatId()).isEqualTo(String.valueOf(CHAT_ID));
                        assertThat(message.getText()).isEqualTo("No data to burn.");
                        assertThat(message.getReplyMarkup()).isNull();
                    })
                    .verifyComplete();

            verify(valueOps, never()).set(anyString(), anyString(), any(Duration.class));
        }

        @Test
        void knownUser_returnsConfirmationKeyboardWithThreeActions() {
            UnifiedUser user = new UnifiedUser(
                    INTERNAL_ID, AuthType.TELEGRAM, "alice", TG_ID, null, null);

            when(userIdentityRepository.findByTelegramId(TG_ID)).thenReturn(Mono.just(INTERNAL_ID));
            when(userIdentityRepository.findById(INTERNAL_ID)).thenReturn(Mono.just(user));
            when(valueOps.set(anyString(), eq(INTERNAL_ID), eq(Duration.ofSeconds(60))))
                    .thenReturn(Mono.just(true));
            when(botMessages.get("bot.burn.confirm.text", LANG)).thenReturn("Confirm burn?");
            when(botMessages.get("bot.burn.button.data", LANG)).thenReturn("Burn all data");
            when(botMessages.get("bot.burn.button.account", LANG)).thenReturn("Burn account");
            when(botMessages.get("bot.burn.button.cancel", LANG)).thenReturn("Cancel");

            StepVerifier.create(service.handleBurnCommand(CHAT_ID, TG_ID, LANG))
                    .assertNext(message -> {
                        assertThat(message.getText()).isEqualTo("Confirm burn?");
                        InlineKeyboardMarkup keyboard = (InlineKeyboardMarkup) message.getReplyMarkup();
                        assertThat(keyboard).isNotNull();
                        List<List<InlineKeyboardButton>> rows = keyboard.getKeyboard();
                        assertThat(rows).hasSize(2);
                        assertThat(rows.get(0)).hasSize(2);
                        assertThat(rows.get(1)).hasSize(1);

                        String dataBtn = rows.get(0).get(0).getCallbackData();
                        String accountBtn = rows.get(0).get(1).getCallbackData();
                        String cancelBtn = rows.get(1).get(0).getCallbackData();

                        assertThat(dataBtn).startsWith("burnall:").endsWith(":data");
                        assertThat(accountBtn).startsWith("burnall:").endsWith(":account");
                        assertThat(cancelBtn).startsWith("burnall:").endsWith(":cancel");
                        assertThat(dataBtn.split(":")[1]).isEqualTo(accountBtn.split(":")[1]);
                    })
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("callback handling")
    class CallbackHandling {

        private String nonce;

        @BeforeEach
        void storeNonce() {
            nonce = "nonce-123";
        }

        @Test
        void cancel_doesNotInvokeBurn() {
            when(botMessages.get("bot.burn.cancelled", LANG)).thenReturn("Cancelled.");

            StepVerifier.create(service.handleCallback(
                            "burnall:" + nonce + ":cancel", CHAT_ID, TG_ID, LANG))
                    .assertNext(result -> {
                        assertThat(result.burnRequested()).isFalse();
                        assertThat(result.ackText()).isEqualTo("Cancelled.");
                    })
                    .verifyComplete();

            verify(valueOps, never()).getAndDelete(anyString());
            verify(userBurnService, never()).burnAllForUser(anyString(), any(Boolean.class));
        }

        @Test
        void burnData_consumesNonceAndRunsCascadeWithWipeIdentityFalse() {
            BurnAllSummary summary = new BurnAllSummary(false, 2, 1, 0, 1_700_000_000_000L);

            when(valueOps.getAndDelete("bot:burn:nonce:" + nonce)).thenReturn(Mono.just(INTERNAL_ID));
            when(userBurnService.burnAllForUser(INTERNAL_ID, false)).thenReturn(Mono.just(summary));
            when(botMessages.get("bot.burn.processing", LANG)).thenReturn("Processing...");
            when(botMessages.get("bot.burn.complete", LANG, 2, 1, 0))
                    .thenReturn("Burned: 2 chats, 1 rooms");

            StepVerifier.create(service.handleCallback(
                            "burnall:" + nonce + ":data", CHAT_ID, TG_ID, LANG))
                    .assertNext(result -> {
                        assertThat(result.burnRequested()).isTrue();
                        assertThat(result.summaryMessage()).isEqualTo("Burned: 2 chats, 1 rooms");
                    })
                    .verifyComplete();

            verify(userBurnService).burnAllForUser(INTERNAL_ID, false);
            verify(stompUserMessenger).convertAndSendToInternalId(
                    eq(INTERNAL_ID),
                    eq("/queue/burn-all-complete"),
                    any());
        }

        @Test
        void burnAccount_consumesNonceAndRunsCascadeWithWipeIdentityTrue() {
            BurnAllSummary summary = new BurnAllSummary(true, 0, 0, 0, 1_700_000_000_000L);

            when(valueOps.getAndDelete("bot:burn:nonce:" + nonce)).thenReturn(Mono.just(INTERNAL_ID));
            when(userBurnService.burnAllForUser(INTERNAL_ID, true)).thenReturn(Mono.just(summary));
            when(botMessages.get("bot.burn.processing", LANG)).thenReturn("Processing...");
            when(botMessages.get("bot.burn.complete", LANG, 0, 0, 0))
                    .thenReturn("Account burned");

            StepVerifier.create(service.handleCallback(
                            "burnall:" + nonce + ":account", CHAT_ID, TG_ID, LANG))
                    .assertNext(result -> assertThat(result.burnRequested()).isTrue())
                    .verifyComplete();

            verify(userBurnService).burnAllForUser(INTERNAL_ID, true);
        }

        @Test
        void expiredOrMissingNonce_rejectsWithoutBurn() {
            when(valueOps.getAndDelete("bot:burn:nonce:" + nonce)).thenReturn(Mono.empty());
            when(botMessages.get("bot.burn.expired", LANG)).thenReturn("Confirmation expired.");

            StepVerifier.create(service.handleCallback(
                            "burnall:" + nonce + ":data", CHAT_ID, TG_ID, LANG))
                    .assertNext(result -> {
                        assertThat(result.burnRequested()).isFalse();
                        assertThat(result.ackText()).isEqualTo("Confirmation expired.");
                    })
                    .verifyComplete();

            verify(userBurnService, never()).burnAllForUser(anyString(), any(Boolean.class));
        }

        @Test
        void reusedNonce_rejectsSecondAttempt() {
            when(valueOps.getAndDelete("bot:burn:nonce:" + nonce))
                    .thenReturn(Mono.just(INTERNAL_ID))
                    .thenReturn(Mono.empty());
            when(userBurnService.burnAllForUser(INTERNAL_ID, false))
                    .thenReturn(Mono.just(new BurnAllSummary(false, 1, 0, 0, 1L)));
            when(botMessages.get("bot.burn.processing", LANG)).thenReturn("Processing...");
            when(botMessages.get("bot.burn.complete", LANG, 1, 0, 0)).thenReturn("Done");
            when(botMessages.get("bot.burn.expired", LANG)).thenReturn("Confirmation expired.");

            StepVerifier.create(service.handleCallback(
                            "burnall:" + nonce + ":data", CHAT_ID, TG_ID, LANG))
                    .assertNext(result -> assertThat(result.burnRequested()).isTrue())
                    .verifyComplete();

            StepVerifier.create(service.handleCallback(
                            "burnall:" + nonce + ":data", CHAT_ID, TG_ID, LANG))
                    .assertNext(result -> {
                        assertThat(result.burnRequested()).isFalse();
                        assertThat(result.ackText()).isEqualTo("Confirmation expired.");
                    })
                    .verifyComplete();

            verify(userBurnService).burnAllForUser(INTERNAL_ID, false);
        }
    }
}
