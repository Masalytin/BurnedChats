package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.telegram.telegrambots.bots.TelegramLongPollingBot;
import org.telegram.telegrambots.meta.api.methods.AnswerCallbackQuery;
import org.telegram.telegrambots.meta.api.methods.commands.SetMyCommands;
import org.telegram.telegrambots.meta.api.methods.send.SendMessage;
import org.telegram.telegrambots.meta.api.methods.updatingmessages.EditMessageReplyMarkup;
import org.telegram.telegrambots.meta.api.objects.CallbackQuery;
import org.telegram.telegrambots.meta.api.objects.Update;
import org.telegram.telegrambots.meta.api.objects.commands.BotCommand;
import org.telegram.telegrambots.meta.api.objects.commands.scope.BotCommandScopeDefault;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.InlineKeyboardMarkup;
import org.telegram.telegrambots.meta.exceptions.TelegramApiException;

import java.util.ArrayList;
import java.util.List;

/**
 * Main Telegram bot implementation for BurnedChats.
 *
 * <p>Handles bot commands and provides Mini App launch button.
 * Uses Long Polling in development, Webhook in production.
 *
 * <p>Supported commands:
 * <ul>
 *   <li>/start - Welcome message with Mini App button</li>
 *   <li>/help - Help information</li>
 *   <li>/burn - Remote burn-all with inline confirmation</li>
 * </ul>
 */
@Slf4j
@Component
public class BurnedChatsBot extends TelegramLongPollingBot {

    private final TelegramProperties telegramProperties;
    private final BotMessageService botMessages;
    private final BotBurnCommandService burnCommandService;

    public BurnedChatsBot(
            TelegramProperties telegramProperties,
            BotMessageService botMessages,
            BotBurnCommandService burnCommandService) {
        super(telegramProperties.getBot().getToken());
        this.telegramProperties = telegramProperties;
        this.botMessages = botMessages;
        this.burnCommandService = burnCommandService;
    }

    /**
     * Initialize bot commands menu after construction.
     */
    @PostConstruct
    public void init() {
        try {
            registerBotCommands();
            LOG.info("BurnedChatsBot initialized successfully. Username: @{}", getBotUsername());
        } catch (TelegramApiException e) {
            LOG.error("Failed to register bot commands", e);
        }
    }

    /**
     * Registers bot commands visible in the Telegram menu.
     */
    private void registerBotCommands() throws TelegramApiException {
        for (String lang : List.of("en", "ru")) {
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
        LOG.debug("Bot commands registered for supported languages");
    }

    @Override
    public String getBotUsername() {
        return telegramProperties.getBot().getUsername();
    }

    @Override
    public void onUpdateReceived(Update update) {
        try {
            if (update.hasCallbackQuery()) {
                handleCallbackQuery(update.getCallbackQuery());
                return;
            }

            if (update.hasMessage() && update.getMessage().hasText()) {
                String messageText = update.getMessage().getText();
                long chatId = update.getMessage().getChatId();
                String username = update.getMessage().getFrom().getUserName();
                String langCode = update.getMessage().getFrom().getLanguageCode();
                long telegramId = update.getMessage().getFrom().getId();

                LOG.debug("Received message from @{}: {}", username, messageText);

                if (messageText.startsWith("/start")) {
                    handleStartCommand(chatId, update, langCode);
                } else if ("/help".equals(messageText)) {
                    handleHelpCommand(chatId, langCode);
                } else if ("/burn".equals(messageText)) {
                    handleBurnCommand(chatId, telegramId, langCode);
                } else {
                    handleUnknownCommand(chatId, langCode);
                }
            }
        } catch (TelegramApiException e) {
            LOG.error("Failed to process update", e);
        }
    }

    private void handleBurnCommand(long chatId, long telegramId, String langCode) throws TelegramApiException {
        SendMessage message = burnCommandService.handleBurnCommand(chatId, telegramId, langCode).block();
        if (message != null) {
            execute(message);
            LOG.info("Sent /burn response to chatId: {}", chatId);
        }
    }

    private void handleCallbackQuery(CallbackQuery callbackQuery) throws TelegramApiException {
        String callbackData = callbackQuery.getData();
        String langCode = callbackQuery.getFrom().getLanguageCode();
        long telegramId = callbackQuery.getFrom().getId();
        long chatId = callbackQuery.getMessage().getChatId();
        int messageId = callbackQuery.getMessage().getMessageId();

        if (burnCommandService.requiresAsyncBurn(callbackData)) {
            execute(AnswerCallbackQuery.builder()
                    .callbackQueryId(callbackQuery.getId())
                    .text(burnCommandService.processingAckText(langCode))
                    .build());

            burnCommandService.handleCallback(callbackData, chatId, telegramId, langCode)
                    .subscribe(
                            result -> deliverCallbackFollowUp(chatId, result),
                            error -> LOG.error("Burn callback failed for chatId={}: {}",
                                    chatId, error.getMessage()));
            return;
        }

        BotBurnCommandService.BurnCallbackResult result = burnCommandService
                .handleCallback(callbackData, chatId, telegramId, langCode)
                .block();

        if (result != null && callbackData != null && callbackData.endsWith(":cancel")) {
            removeInlineKeyboard(chatId, messageId);
        }

        execute(AnswerCallbackQuery.builder()
                .callbackQueryId(callbackQuery.getId())
                .text(result != null ? result.ackText() : "")
                .showAlert(result != null && !result.burnRequested())
                .build());
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
     * Sends welcome message with Mini App launch button.
     */
    private void handleStartCommand(long chatId, Update update, String langCode) throws TelegramApiException {
        String messageText = update.getMessage().getText();
        String deepLinkParam = null;

        if (messageText.length() > 7) {
            deepLinkParam = messageText.substring(7).trim();
            LOG.debug("Deep link parameter received: {}", deepLinkParam);
        }

        SendMessage message = SendMessage.builder()
                .chatId(chatId)
                .text(botMessages.get("bot.start.text", langCode))
                .parseMode("HTML")
                .replyMarkup(buildMiniAppKeyboard(deepLinkParam, langCode))
                .build();

        execute(message);
        LOG.info("Sent /start response to chatId: {}", chatId);
    }

    private InlineKeyboardMarkup buildMiniAppKeyboard(String deepLinkParam, String langCode) {
        return MiniAppKeyboard.build(
                telegramProperties.getBot().getUsername(),
                telegramProperties.getMiniApp().getUrl(),
                deepLinkParam,
                botMessages.get("bot.start.button", langCode));
    }

    private void handleHelpCommand(long chatId, String langCode) throws TelegramApiException {
        SendMessage message = SendMessage.builder()
                .chatId(chatId)
                .text(botMessages.get("bot.help.text", langCode))
                .parseMode("HTML")
                .build();

        execute(message);
        LOG.info("Sent /help response to chatId: {}", chatId);
    }

    private void handleUnknownCommand(long chatId, String langCode) throws TelegramApiException {
        SendMessage message = SendMessage.builder()
                .chatId(chatId)
                .text(botMessages.get("bot.unknown.text", langCode))
                .replyMarkup(buildMiniAppKeyboard(null, langCode))
                .build();

        execute(message);
    }

    /**
     * Sends a notification message to a specific chat.
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
