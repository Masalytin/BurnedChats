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

    private static final String FIRE_EMOJI = "🔥";
    private static final String LOCK_EMOJI = "🔐";
    private static final String SHIELD_EMOJI = "🛡️";
    private static final String ROCKET_EMOJI = "🚀";
    private static final String QUESTION_EMOJI = "❓";
    private static final String CHECK_EMOJI = "✅";
    private static final String KEY_EMOJI = "🔑";

    private final TelegramProperties telegramProperties;

    @Getter
    private final String botPath;

    public BurnedChatsWebhookBot(TelegramProperties telegramProperties) {
        super(telegramProperties.getBot().getToken());
        this.telegramProperties = telegramProperties;
        this.botPath = telegramProperties.getBot().getWebhook().getPath();
    }

    /**
     * Initialize bot commands menu after construction.
     */
    @PostConstruct
    public void init() {
        try {
            registerBotCommands();
            log.info("BurnedChatsWebhookBot initialized successfully. Username: @{}",
                    getBotUsername());
        } catch (TelegramApiException e) {
            log.error("Failed to register bot commands", e);
        }
    }

    /**
     * Registers bot commands visible in the Telegram menu.
     */
    private void registerBotCommands() throws TelegramApiException {
        List<BotCommand> commands = new ArrayList<>();
        commands.add(new BotCommand("/start", "Запустить приватный чат"));
        commands.add(new BotCommand("/help", "Помощь и информация"));

        SetMyCommands setMyCommands = new SetMyCommands();
        setMyCommands.setCommands(commands);
        setMyCommands.setScope(new BotCommandScopeDefault());

        execute(setMyCommands);
        log.debug("Bot commands registered: {}", commands);
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

            log.debug("Webhook received message from @{}: {}", username, messageText);

            if (messageText.startsWith("/start")) {
                return handleStartCommand(chatId, update);
            } else if (messageText.equals("/help")) {
                return handleHelpCommand(chatId);
            } else {
                return handleUnknownCommand(chatId);
            }
        }
        return null;
    }

    /**
     * Handles /start command.
     * Returns SendMessage with welcome text and Mini App button.
     *
     * @param chatId Chat ID to send response
     * @param update Original update (may contain deep link parameters)
     * @return SendMessage to be sent as webhook response
     */
    private SendMessage handleStartCommand(long chatId, Update update) {
        String messageText = update.getMessage().getText();
        String deepLinkParam = null;

        // Check for deep link parameter (e.g., /start sessionId123)
        if (messageText.length() > 7) {
            deepLinkParam = messageText.substring(7).trim();
            log.debug("Deep link parameter received: {}", deepLinkParam);
        }

        String welcomeText = buildWelcomeMessage();

        log.info("Sent /start response to chatId: {}", chatId);
        return SendMessage.builder()
                .chatId(chatId)
                .text(welcomeText)
                .parseMode("HTML")
                .replyMarkup(buildMiniAppKeyboard(deepLinkParam))
                .build();
    }

    /**
     * Builds the welcome message text.
     */
    private String buildWelcomeMessage() {
        return String.format("""
                %s <b>BurnedChats</b>
                
                Добро пожаловать в защищённый мессенджер!
                
                %s <b>Что это?</b>
                Приложение для секретных переписок с end-to-end шифрованием. \
                Сообщения не хранятся на сервере — только у вас.
                
                %s <b>Как работает:</b>
                • Найдите собеседника по @username
                • Дождитесь подтверждения связи
                • Обменивайтесь сообщениями
                • Нажмите "Сжечь" для уничтожения чата
                
                %s <b>Безопасность:</b>
                • AES-256-GCM + ECDH шифрование
                • Ключи генерируются на устройстве
                • Сервер не видит ваши сообщения
                • Данные уничтожаются без возможности восстановления
                
                Нажмите кнопку ниже, чтобы начать %s
                """,
                FIRE_EMOJI, QUESTION_EMOJI, CHECK_EMOJI, SHIELD_EMOJI, ROCKET_EMOJI);
    }

    /**
     * Builds inline keyboard with Mini App button.
     *
     * @param deepLinkParam Optional deep link parameter to append to Mini App URL
     */
    private InlineKeyboardMarkup buildMiniAppKeyboard(String deepLinkParam) {
        String miniAppUrl = telegramProperties.getMiniApp().getUrl();

        // Append deep link parameter if present
        if (deepLinkParam != null && !deepLinkParam.isEmpty()) {
            miniAppUrl = miniAppUrl + "?startParam=" + deepLinkParam;
        }

        InlineKeyboardButton miniAppButton = InlineKeyboardButton.builder()
                .text(ROCKET_EMOJI + " Открыть BurnedChats")
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
     * @param chatId Chat ID to send response
     * @return SendMessage to be sent as webhook response
     */
    private SendMessage handleHelpCommand(long chatId) {
        String helpText = String.format("""
                %s <b>Помощь — BurnedChats</b>
                
                %s <b>Основные функции:</b>
                
                %s <b>Начать чат</b>
                1. Откройте приложение
                2. Введите @username собеседника
                3. Отправьте запрос на связь
                4. Дождитесь подтверждения
                
                %s <b>Безопасная связь</b>
                После подтверждения проверьте "отпечаток безопасности" — \
                он должен совпадать у обоих участников.
                
                %s <b>Сжечь чат</b>
                Нажмите кнопку "Сжечь" для полного уничтожения переписки. \
                Данные удаляются у всех участников.
                
                ─────────────────────
                
                %s <b>FAQ:</b>
                
                <b>Q: Могут ли прочитать мои сообщения?</b>
                A: Нет. Используется end-to-end шифрование. \
                Ключи хранятся только на устройствах.
                
                <b>Q: Сохраняются ли сообщения на сервере?</b>
                A: Нет. Сервер только пересылает зашифрованные данные. \
                После доставки они удаляются.
                
                <b>Q: Что происходит при "сжигании"?</b>
                A: Все данные чата уничтожаются на всех устройствах, \
                включая ключи шифрования.
                
                ─────────────────────
                
                %s Есть вопросы? Свяжитесь с поддержкой.
                """,
                QUESTION_EMOJI, ROCKET_EMOJI, CHECK_EMOJI, KEY_EMOJI,
                FIRE_EMOJI, LOCK_EMOJI, SHIELD_EMOJI);

        log.info("Sent /help response to chatId: {}", chatId);
        return SendMessage.builder()
                .chatId(chatId)
                .text(helpText)
                .parseMode("HTML")
                .build();
    }

    /**
     * Handles unknown commands.
     *
     * @param chatId Chat ID to send response
     * @return SendMessage to be sent as webhook response
     */
    private SendMessage handleUnknownCommand(long chatId) {
        String text = String.format("""
                %s Неизвестная команда.
                
                Используйте /help для получения справки или нажмите кнопку ниже:
                """, QUESTION_EMOJI);

        return SendMessage.builder()
                .chatId(chatId)
                .text(text)
                .replyMarkup(buildMiniAppKeyboard(null))
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
            log.debug("Notification sent to chatId: {}", chatId);
            return true;
        } catch (TelegramApiException e) {
            log.error("Failed to send notification to chatId: {}", chatId, e);
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
                    .replyMarkup(buildMiniAppKeyboard(deepLinkParam))
                    .build();

            execute(message);
            log.debug("Notification with button sent to chatId: {}", chatId);
            return true;
        } catch (TelegramApiException e) {
            log.error("Failed to send notification with button to chatId: {}", chatId, e);
            return false;
        }
    }
}
