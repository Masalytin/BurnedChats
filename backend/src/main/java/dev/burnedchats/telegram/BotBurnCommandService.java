package dev.burnedchats.telegram;

import dev.burnedchats.dto.event.BurnAllCompleteEvent;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.service.UserBurnService;
import dev.burnedchats.service.UserBurnService.BurnAllSummary;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.telegram.telegrambots.meta.api.methods.send.SendMessage;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.InlineKeyboardMarkup;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.buttons.InlineKeyboardButton;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Handles the Telegram {@code /burn} command and its inline confirmation callbacks.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BotBurnCommandService {

    static final String NONCE_KEY_PREFIX = "bot:burn:nonce:";
    static final Duration NONCE_TTL = Duration.ofSeconds(60);
    static final String CALLBACK_PREFIX = "burnall:";
    private static final String BURN_ALL_COMPLETE_DESTINATION = "/queue/burn-all-complete";

    private final UserIdentityRepository userIdentityRepository;
    private final UserBurnService userBurnService;
    private final BotMessageService botMessages;
    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final StompUserMessenger stompUserMessenger;

    /**
     * Result of processing an inline burn confirmation callback.
     *
     * @param burnRequested  whether a burn cascade was executed
     * @param ackText        callback answer text (cancel / expired / invalid)
     * @param summaryMessage follow-up chat message after a successful burn
     */
    public record BurnCallbackResult(
            boolean burnRequested,
            String ackText,
            String summaryMessage) {
    }

    public Mono<SendMessage> handleBurnCommand(long chatId, long telegramId, String langCode) {
        return userIdentityRepository.findByTelegramId(telegramId)
                .flatMap(internalId -> userIdentityRepository.findById(internalId)
                        .defaultIfEmpty(emptyUser(internalId))
                        .flatMap(user -> createConfirmationMessage(chatId, internalId, user, langCode)))
                .switchIfEmpty(Mono.fromSupplier(() -> SendMessage.builder()
                        .chatId(chatId)
                        .text(botMessages.get("bot.burn.noData", langCode))
                        .parseMode("HTML")
                        .build()));
    }

    /**
     * Whether the callback should be answered immediately with a processing ack while burn runs async.
     */
    public boolean requiresAsyncBurn(String callbackData) {
        ParsedCallback parsed = parseCallback(callbackData);
        return parsed != null
                && (parsed.action() == BurnAction.DATA || parsed.action() == BurnAction.ACCOUNT);
    }

    /**
     * Immediate callback answer for burn actions (before cascade completes).
     */
    public String processingAckText(String langCode) {
        return botMessages.get("bot.burn.processing", langCode);
    }

    public Mono<BurnCallbackResult> handleCallback(
            String callbackData, long chatId, long telegramId, String langCode) {
        ParsedCallback parsed = parseCallback(callbackData);
        if (parsed == null) {
            return Mono.just(new BurnCallbackResult(
                    false,
                    botMessages.get("bot.burn.invalid", langCode),
                    null));
        }

        if (parsed.action() == BurnAction.CANCEL) {
            return Mono.just(new BurnCallbackResult(
                    false,
                    botMessages.get("bot.burn.cancelled", langCode),
                    null));
        }

        boolean wipeIdentity = parsed.action() == BurnAction.ACCOUNT;
        String nonceKey = NONCE_KEY_PREFIX + parsed.nonce();

        return redisTemplate.opsForValue().getAndDelete(nonceKey)
                .flatMap(internalId -> executeBurn(internalId, wipeIdentity, langCode))
                .switchIfEmpty(Mono.fromSupplier(() -> new BurnCallbackResult(
                        false,
                        botMessages.get("bot.burn.expired", langCode),
                        null)));
    }

    private Mono<BurnCallbackResult> executeBurn(String internalId, boolean wipeIdentity, String langCode) {
        return userBurnService.burnAllForUser(internalId, wipeIdentity)
                .doOnNext(summary -> stompUserMessenger.convertAndSendToInternalId(
                        internalId,
                        BURN_ALL_COMPLETE_DESTINATION,
                        BurnAllCompleteEvent.from(summary)))
                .map(summary -> new BurnCallbackResult(
                        true,
                        processingAckText(langCode),
                        formatSummary(summary, langCode)))
                .doOnError(error -> LOG.error(
                        "Bot burn-all failed: internalId={}, error={}",
                        internalId,
                        error.getMessage()));
    }

    private Mono<SendMessage> createConfirmationMessage(
            long chatId, String internalId, UnifiedUser user, String langCode) {
        String nonce = UUID.randomUUID().toString().replace("-", "");
        String nonceKey = NONCE_KEY_PREFIX + nonce;

        String textKey = hasLinkedWallet(user)
                ? "bot.burn.confirm.linkedWallet"
                : "bot.burn.confirm.text";

        return redisTemplate.opsForValue()
                .set(nonceKey, internalId, NONCE_TTL)
                .thenReturn(SendMessage.builder()
                        .chatId(chatId)
                        .text(botMessages.get(textKey, langCode))
                        .parseMode("HTML")
                        .replyMarkup(buildConfirmationKeyboard(nonce, langCode))
                        .build());
    }

    private InlineKeyboardMarkup buildConfirmationKeyboard(String nonce, String langCode) {
        InlineKeyboardButton burnDataButton = InlineKeyboardButton.builder()
                .text(botMessages.get("bot.burn.button.data", langCode))
                .callbackData(CALLBACK_PREFIX + nonce + ":data")
                .build();
        InlineKeyboardButton burnAccountButton = InlineKeyboardButton.builder()
                .text(botMessages.get("bot.burn.button.account", langCode))
                .callbackData(CALLBACK_PREFIX + nonce + ":account")
                .build();
        InlineKeyboardButton cancelButton = InlineKeyboardButton.builder()
                .text(botMessages.get("bot.burn.button.cancel", langCode))
                .callbackData(CALLBACK_PREFIX + nonce + ":cancel")
                .build();

        List<List<InlineKeyboardButton>> keyboard = new ArrayList<>();
        keyboard.add(List.of(burnDataButton, burnAccountButton));
        keyboard.add(List.of(cancelButton));

        return InlineKeyboardMarkup.builder().keyboard(keyboard).build();
    }

    private String formatSummary(BurnAllSummary summary, String langCode) {
        return botMessages.get(
                "bot.burn.complete",
                langCode,
                summary.burnedSessions(),
                summary.burnedRooms(),
                summary.leftRooms());
    }

    private static boolean hasLinkedWallet(UnifiedUser user) {
        return user.walletAddress() != null && !user.walletAddress().isBlank();
    }

    private static UnifiedUser emptyUser(String internalId) {
        return new UnifiedUser(
                internalId,
                dev.burnedchats.model.enums.AuthType.TELEGRAM,
                null,
                null,
                null,
                null);
    }

    static ParsedCallback parseCallback(String callbackData) {
        if (!StringUtils.hasText(callbackData) || !callbackData.startsWith(CALLBACK_PREFIX)) {
            return null;
        }
        String[] parts = callbackData.split(":", 3);
        if (parts.length != 3 || !StringUtils.hasText(parts[1])) {
            return null;
        }
        BurnAction action = switch (parts[2]) {
            case "data" -> BurnAction.DATA;
            case "account" -> BurnAction.ACCOUNT;
            case "cancel" -> BurnAction.CANCEL;
            default -> null;
        };
        if (action == null) {
            return null;
        }
        return new ParsedCallback(parts[1], action);
    }

    record ParsedCallback(String nonce, BurnAction action) {}

    enum BurnAction {
        DATA,
        ACCOUNT,
        CANCEL
    }
}
