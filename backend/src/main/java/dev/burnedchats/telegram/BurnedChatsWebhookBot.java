package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import jakarta.annotation.PostConstruct;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.telegram.telegrambots.bots.TelegramWebhookBot;
import org.telegram.telegrambots.meta.api.methods.BotApiMethod;
import org.telegram.telegrambots.meta.api.methods.commands.SetMyCommands;
import org.telegram.telegrambots.meta.api.methods.send.SendMessage;
import org.telegram.telegrambots.meta.api.objects.Update;
import org.telegram.telegrambots.meta.api.objects.commands.BotCommand;
import org.telegram.telegrambots.meta.api.objects.commands.scope.BotCommandScopeDefault;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.InlineKeyboardMarkup;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.buttons.InlineKeyboardButton;
import org.telegram.telegrambots.meta.api.objects.webapp.WebAppInfo;
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
 * </ul>
 *
 * @see TelegramWebhookConfig
 * @see TelegramWebhookController
 */
@Slf4j
public class BurnedChatsWebhookBot extends TelegramWebhookBot {

    private final TelegramProperties telegramProperties;
    private final BotMessageService botMessages;

    @Getter
    private final String botPath;

    public BurnedChatsWebhookBot(TelegramProperties telegramProperties, BotMessageService botMessages) {
        super(telegramProperties.getBot().getToken());
        this.telegramProperties = telegramProperties;
        this.botMessages = botMessages;
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
        for (String lang : List.of("en", "ru")) {
            List<BotCommand> commands = new ArrayList<>();
            commands.add(new BotCommand("/start", botMessages.get("bot.cmd.start", lang)));
            commands.add(new BotCommand("/help", botMessages.get("bot.cmd.help", lang)));

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
        if (update.hasMessage() && update.getMessage().hasText()) {
            String messageText = update.getMessage().getText();
            long chatId = update.getMessage().getChatId();
            String username = update.getMessage().getFrom().getUserName();
            String langCode = update.getMessage().getFrom().getLanguageCode();

            LOG.debug("Webhook received message from @{}: {}", username, messageText);

            if (messageText.startsWith("/start")) {
                return handleStartCommand(chatId, update, langCode);
            } else if ("/help".equals(messageText)) {
                return handleHelpCommand(chatId, langCode);
            } else {
                return handleUnknownCommand(chatId, langCode);
            }
        }
        return null;
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
        String miniAppUrl = telegramProperties.getMiniApp().getUrl();

        // Append deep link parameter if present
        if (deepLinkParam != null && !deepLinkParam.isEmpty()) {
            miniAppUrl = miniAppUrl + "?startParam=" + deepLinkParam;
        }

        InlineKeyboardButton miniAppButton = InlineKeyboardButton.builder()
                .text(botMessages.get("bot.start.button", langCode))
                .webApp(new WebAppInfo(miniAppUrl))
                .build();

        List<InlineKeyboardButton> row = new ArrayList<>();
        row.add(miniAppButton);

        List<List<InlineKeyboardButton>> keyboard = new ArrayList<>();
        keyboard.add(row);

        return InlineKeyboardMarkup.builder()
                .keyboard(keyboard)
                .build();
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
