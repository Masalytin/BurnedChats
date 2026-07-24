package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import jakarta.annotation.PostConstruct;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.StringUtils;
import org.telegram.telegrambots.bots.TelegramWebhookBot;
import org.telegram.telegrambots.meta.api.methods.BotApiMethod;
import org.telegram.telegrambots.meta.api.methods.commands.SetMyCommands;
import org.telegram.telegrambots.meta.api.methods.send.SendMessage;
import org.telegram.telegrambots.meta.api.methods.updatingmessages.EditMessageReplyMarkup;
import org.telegram.telegrambots.meta.api.objects.CallbackQuery;
import org.telegram.telegrambots.meta.api.objects.Update;
import org.telegram.telegrambots.meta.api.objects.commands.BotCommand;
import org.telegram.telegrambots.meta.api.objects.commands.scope.BotCommandScopeDefault;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.InlineKeyboardMarkup;
import org.telegram.telegrambots.meta.api.methods.AnswerCallbackQuery;
import org.telegram.telegrambots.meta.exceptions.TelegramApiException;

import java.util.ArrayList;
import java.util.List;

/**
 * Telegram webhook bot implementation for BurnedChats.
 *
 * <p>This bot is used in production with webhook mode instead of long polling.
 * It provides better performance and lower resource usage.
 *
 * <p>Supported commands:
 * <ul>
 *   <li>/start - Welcome message with Mini App button</li>
 *   <li>/help - Help information</li>
 *   <li>/burn - Remote burn-all with inline confirmation</li>
 * </ul>
 *
 * @see TelegramWebhookConfig
 * @see TelegramWebhookController
 */
@Slf4j
public class BurnedChatsWebhookBot extends TelegramWebhookBot {

    private final TelegramProperties telegramProperties;
    private final BotMessageService botMessages;
    private final BotBurnCommandService burnCommandService;

    @Getter
    private final String botPath;

    public BurnedChatsWebhookBot(
            TelegramProperties telegramProperties,
            BotMessageService botMessages,
            BotBurnCommandService burnCommandService) {
        super(telegramProperties.getBot().getToken());
        this.telegramProperties = telegramProperties;
        this.botMessages = botMessages;
        this.burnCommandService = burnCommandService;
        this.botPath = telegramProperties.getBot().getWebhook().getPath();
    }

    /**
     * Initialize bot commands menu after construction.
     */
    @PostConstruct
    public void init() {
        try {
            registerBotCommands();
            LOG.info("BurnedChatsWebhookBot initialized successfully. Username: @{}",
                    getBotUsername());
        } catch (TelegramApiException e) {
            LOG.error("Failed to register bot commands", e);
        }
    }

    /**
     * Registers bot commands visible in the Telegram menu for supported languages.
     */
    private void registerBotCommands() throws TelegramApiException {
        for (String lang : List.of("en", "ru", "de", "es", "fr", "ar", "uk", "zh")) {
            List<BotCommand> commands = new ArrayList<>();
            commands.add(new BotCommand("/start", botMessages.get("bot.cmd.start", lang)));
            commands.add(new BotCommand("/help", botMessages.get("bot.cmd.help", lang)));
            commands.add(new BotCommand("/burn", botMessages.get("bot.cmd.burn", lang)));

            SetMyCommands setMyCommands = new SetMyCommands();
            setMyCommands.setCommands(commands);
            setMyCommands.setScope(new BotCommandScopeDefault());
            setMyCommands.setLanguageCode(lang);

            execute(setMyCommands);
        }
        LOG.debug("Bot commands registered for all supported languages");
    }

    @Override
    public String getBotUsername() {
        return telegramProperties.getBot().getUsername();
    }

    @Override
    public BotApiMethod<?> onWebhookUpdateReceived(Update update) {
        if (update.hasCallbackQuery()) {
            return handleCallbackQuery(update.getCallbackQuery());
        }

        if (update.hasMessage() && update.getMessage().hasText()) {
            String messageText = update.getMessage().getText();
            long chatId = update.getMessage().getChatId();
            String username = update.getMessage().getFrom().getUserName();
            String langCode = update.getMessage().getFrom().getLanguageCode();
            long telegramId = update.getMessage().getFrom().getId();

            LOG.debug("Webhook received message from @{}: {}", username, messageText);

            if (messageText.startsWith("/start")) {
                return handleStartCommand(chatId, update, langCode);
            } else if ("/help".equals(messageText)) {
                return handleHelpCommand(chatId, langCode);
            } else if ("/burn".equals(messageText)) {
                return handleBurnCommand(chatId, telegramId, langCode);
            } else {
                return handleUnknownCommand(chatId, langCode);
            }
        }
        return null;
    }

    private BotApiMethod<?> handleBurnCommand(long chatId, long telegramId, String langCode) {
        return burnCommandService.handleBurnCommand(chatId, telegramId, langCode)
                .doOnNext(msg -> LOG.info("Sent /burn response to chatId: {}", chatId))
                .block();
    }

    private BotApiMethod<?> handleCallbackQuery(CallbackQuery callbackQuery) {
        String callbackData = callbackQuery.getData();
        String langCode = callbackQuery.getFrom().getLanguageCode();
        long telegramId = callbackQuery.getFrom().getId();
        long chatId = callbackQuery.getMessage().getChatId();
        int messageId = callbackQuery.getMessage().getMessageId();

        if (burnCommandService.requiresAsyncBurn(callbackData)) {
            burnCommandService.handleCallback(callbackData, chatId, telegramId, langCode)
                    .subscribe(
                            result -> deliverCallbackFollowUp(chatId, result),
                            error -> LOG.error("Burn callback failed for chatId={}: {}",
                                    chatId, error.getMessage()));

            return AnswerCallbackQuery.builder()
                    .callbackQueryId(callbackQuery.getId())
                    .text(burnCommandService.processingAckText(langCode))
                    .build();
        }

        BotBurnCommandService.BurnCallbackResult result = burnCommandService
                .handleCallback(callbackData, chatId, telegramId, langCode)
                .block();

        if (result != null && isCancelCallback(callbackData)) {
            removeInlineKeyboard(chatId, messageId);
        }

        return AnswerCallbackQuery.builder()
                .callbackQueryId(callbackQuery.getId())
                .text(result != null ? result.ackText() : "")
                .showAlert(result != null && !result.burnRequested())
                .build();
    }

    private static boolean isCancelCallback(String callbackData) {
        return callbackData != null && callbackData.endsWith(":cancel");
    }

    private void deliverCallbackFollowUp(long chatId, BotBurnCommandService.BurnCallbackResult result) {
        if (StringUtils.hasText(result.summaryMessage())) {
            sendNotification(chatId, result.summaryMessage());
            return;
        }
        if (!result.burnRequested() && StringUtils.hasText(result.ackText())) {
            sendNotification(chatId, result.ackText());
        }
    }

    private void removeInlineKeyboard(long chatId, int messageId) {
        try {
            execute(EditMessageReplyMarkup.builder()
                    .chatId(chatId)
                    .messageId(messageId)
                    .replyMarkup(new InlineKeyboardMarkup(new ArrayList<>()))
                    .build());
        } catch (TelegramApiException e) {
            LOG.debug("Failed to remove inline keyboard for chatId={}: {}", chatId, e.getMessage());
        }
    }

    /**
     * Handles /start command.
     * Returns SendMessage with welcome text and Mini App button.
     *
     * @param chatId   Chat ID to send response
     * @param update   Original update (may contain deep link parameters)
     * @param langCode Telegram user language code
     * @return SendMessage to be sent as webhook response
     */
    private SendMessage handleStartCommand(long chatId, Update update, String langCode) {
        String messageText = update.getMessage().getText();
        String deepLinkParam = null;

        // Check for deep link parameter (e.g., /start sessionId123)
        if (messageText.length() > 7) {
            deepLinkParam = messageText.substring(7).trim();
            LOG.debug("Deep link parameter received: {}", deepLinkParam);
        }

        String welcomeText = botMessages.get("bot.start.text", langCode);

        LOG.info("Sent /start response to chatId: {}", chatId);
        return SendMessage.builder()
                .chatId(chatId)
                .text(welcomeText)
                .parseMode("HTML")
                .replyMarkup(buildMiniAppKeyboard(deepLinkParam, langCode))
                .build();
    }

    /**
     * Builds inline keyboard with Mini App button.
     *
     * @param deepLinkParam Optional deep link parameter to append to Mini App URL
     * @param langCode      Telegram user language code for button text
     */
    private InlineKeyboardMarkup buildMiniAppKeyboard(String deepLinkParam, String langCode) {
        return MiniAppKeyboard.build(
                telegramProperties.getBot().getUsername(),
                telegramProperties.getMiniApp().getUrl(),
                deepLinkParam,
                botMessages.get("bot.start.button", langCode));
    }

    /**
     * Handles /help command.
     * Returns SendMessage with help information.
     *
     * @param chatId   Chat ID to send response
     * @param langCode Telegram user language code
     * @return SendMessage to be sent as webhook response
     */
    private SendMessage handleHelpCommand(long chatId, String langCode) {
        String helpText = botMessages.get("bot.help.text", langCode);

        LOG.info("Sent /help response to chatId: {}", chatId);
        return SendMessage.builder()
                .chatId(chatId)
                .text(helpText)
                .parseMode("HTML")
                .build();
    }

    /**
     * Handles unknown commands.
     *
     * @param chatId   Chat ID to send response
     * @param langCode Telegram user language code
     * @return SendMessage to be sent as webhook response
     */
    private SendMessage handleUnknownCommand(long chatId, String langCode) {
        String text = botMessages.get("bot.unknown.text", langCode);

        return SendMessage.builder()
                .chatId(chatId)
                .text(text)
                .replyMarkup(buildMiniAppKeyboard(null, langCode))
                .build();
    }

    /**
     * Sends a notification message to a specific chat.
     * Used for incoming chat requests, session events, etc.
     *
     * @param chatId Target chat ID
     * @param text   Message text (HTML supported)
     * @return true if message was sent successfully
     */
    public boolean sendNotification(long chatId, String text) {
        try {
            SendMessage message = SendMessage.builder()
                    .chatId(chatId)
                    .text(text)
                    .parseMode("HTML")
                    .build();

            execute(message);
            LOG.debug("Notification sent to chatId: {}", chatId);
            return true;
        } catch (TelegramApiException e) {
            LOG.error("Failed to send notification to chatId: {}", chatId, e);
            return false;
        }
    }

    /**
     * Sends a notification with Mini App button.
     * Used for chat request notifications with "Open" action.
     *
     * @param chatId        Target chat ID
     * @param text          Message text (HTML supported)
     * @param deepLinkParam Parameter to pass to Mini App
     * @return true if message was sent successfully
     */
    public boolean sendNotificationWithButton(long chatId, String text, String deepLinkParam) {
        try {
            SendMessage message = SendMessage.builder()
                    .chatId(chatId)
                    .text(text)
                    .parseMode("HTML")
                    .replyMarkup(buildMiniAppKeyboard(deepLinkParam, null))
                    .build();

            execute(message);
            LOG.debug("Notification with button sent to chatId: {}", chatId);
            return true;
        } catch (TelegramApiException e) {
            LOG.error("Failed to send notification with button to chatId: {}", chatId, e);
            return false;
        }
    }
}
