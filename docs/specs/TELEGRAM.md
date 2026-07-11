# Telegram Integration

> Mini App SDK and Bot API (Java Backend)

## 📋 Table of Contents

- [Telegram Mini App](#telegram-mini-app)
- [Bot API (Java)](#bot-api-java)
- [Notifications](#notifications)
- [Security](#security)

---

## Telegram Mini App

### Initialization (Frontend)

```typescript
// src/telegram/init.ts
import WebApp from '@twa-dev/sdk';

export function initTelegramApp() {
  // Verify we are running inside Telegram
  if (!WebApp.initData) {
    throw new Error('App must be opened inside Telegram');
  }

  // Expand to full screen
  WebApp.expand();

  // Enable close confirmation
  WebApp.enableClosingConfirmation();

  // Configure header
  WebApp.setHeaderColor('secondary_bg_color');
  WebApp.setBackgroundColor('secondary_bg_color');

  // Ready to use
  WebApp.ready();

  return {
    initData: WebApp.initData,
    initDataUnsafe: WebApp.initDataUnsafe,
    user: WebApp.initDataUnsafe.user,
    colorScheme: WebApp.colorScheme,
    themeParams: WebApp.themeParams
  };
}
```

### Getting User Data

```typescript
// Data from initDataUnsafe
interface TelegramUser {
  id: number;              // Telegram ID
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;      // Mini Apps only
}

// Usage
const user = WebApp.initDataUnsafe.user;
console.log(`Hello, ${user.first_name}!`);
```

### Adaptive Theme

```typescript
// src/telegram/theme.ts
import WebApp from '@twa-dev/sdk';

export function getThemeCSS(): string {
  const { themeParams } = WebApp;
  
  return `
    :root {
      --tg-bg-color: ${themeParams.bg_color};
      --tg-secondary-bg-color: ${themeParams.secondary_bg_color};
      --tg-text-color: ${themeParams.text_color};
      --tg-hint-color: ${themeParams.hint_color};
      --tg-link-color: ${themeParams.link_color};
      --tg-button-color: ${themeParams.button_color};
      --tg-button-text-color: ${themeParams.button_text_color};
      --tg-destructive-color: ${themeParams.destructive_text_color};
    }
  `;
}

// Subscribe to theme changes
WebApp.onEvent('themeChanged', () => {
  document.documentElement.style.cssText = getThemeCSS();
});
```

### Haptic Feedback

```typescript
// src/telegram/haptics.ts
import WebApp from '@twa-dev/sdk';

export const haptics = {
  // Light vibration
  light: () => WebApp.HapticFeedback.impactOccurred('light'),
  
  // Medium vibration
  medium: () => WebApp.HapticFeedback.impactOccurred('medium'),
  
  // Heavy vibration
  heavy: () => WebApp.HapticFeedback.impactOccurred('heavy'),
  
  // Success
  success: () => WebApp.HapticFeedback.notificationOccurred('success'),
  
  // Error
  error: () => WebApp.HapticFeedback.notificationOccurred('error'),
  
  // Warning
  warning: () => WebApp.HapticFeedback.notificationOccurred('warning'),
  
  // Item selection
  selection: () => WebApp.HapticFeedback.selectionChanged()
};

// Usage
haptics.success(); // On successful connection
haptics.error();   // On error
haptics.light();   // On message received
```

### Back Button

```typescript
// src/telegram/navigation.ts
import WebApp from '@twa-dev/sdk';

export function setupBackButton(onBack: () => void) {
  WebApp.BackButton.show();
  WebApp.BackButton.onClick(onBack);
  
  return () => {
    WebApp.BackButton.hide();
    WebApp.BackButton.offClick(onBack);
  };
}

// In chat component
useEffect(() => {
  const cleanup = setupBackButton(() => {
    // Show confirmation dialog
    if (hasActiveSession) {
      showBurnConfirmation();
    } else {
      WebApp.close();
    }
  });
  
  return cleanup;
}, [hasActiveSession]);
```

### Main Button

```typescript
// Action button at the bottom of the screen
import WebApp from '@twa-dev/sdk';

export function showMainButton(text: string, onClick: () => void) {
  WebApp.MainButton.setText(text);
  WebApp.MainButton.show();
  WebApp.MainButton.onClick(onClick);
}

export function hideMainButton() {
  WebApp.MainButton.hide();
}

// Usage for verification
showMainButton('✓ Confirm match', () => {
  confirmVerification();
  haptics.success();
  hideMainButton();
});
```

### Popup and Confirm

```typescript
// Native Telegram dialogs
import WebApp from '@twa-dev/sdk';

export function showBurnConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    WebApp.showConfirm(
      '🔥 Destroy chat?\n\nAll messages will be deleted and cannot be recovered.',
      (confirmed) => resolve(confirmed)
    );
  });
}

export function showError(message: string) {
  WebApp.showAlert(message);
}

// Popup with buttons
export function showOptionsPopup() {
  WebApp.showPopup({
    title: 'Actions',
    message: 'Choose an action',
    buttons: [
      { id: 'burn', type: 'destructive', text: '🔥 Burn chat' },
      { id: 'block', type: 'default', text: '🚫 Block' },
      { id: 'cancel', type: 'cancel' }
    ]
  }, (buttonId) => {
    switch (buttonId) {
      case 'burn': burnSession(); break;
      case 'block': blockUser(); break;
    }
  });
}
```

### QR Scanner (for future use)

```typescript
// QR scanning for key exchange
import WebApp from '@twa-dev/sdk';

export function scanQRCode(): Promise<string | null> {
  return new Promise((resolve) => {
    WebApp.showScanQrPopup({
      text: 'Point the camera at your contact\'s QR code'
    }, (data) => {
      WebApp.closeScanQrPopup();
      resolve(data || null);
    });
  });
}
```

---

## Bot API (Java)

### Dependencies

```kotlin
// build.gradle.kts
dependencies {
    implementation("org.telegram:telegrambots:6.9.7.1")
    implementation("org.telegram:telegrambotsextensions:6.9.7.1")
}
```

### Configuration

```java
// config/TelegramBotConfig.java
@Configuration
@ConfigurationProperties(prefix = "telegram.bot")
@Data
public class TelegramBotConfig {
    private String token;
    private String username;
    private String miniAppUrl;
    private String webhookUrl;
    private String webhookSecret;
}
```

```yaml
# application.yml
telegram:
  bot:
    token: ${TELEGRAM_BOT_TOKEN}
    username: ${TELEGRAM_BOT_USERNAME}
    mini-app-url: ${MINI_APP_URL:https://app.burnedchats.com}
    webhook-url: ${WEBHOOK_URL}
    webhook-secret: ${TELEGRAM_WEBHOOK_SECRET}
```

### Bot Implementation

```java
// telegram/BurnedChatsBot.java
@Component
@Slf4j
public class BurnedChatsBot extends TelegramLongPollingBot {
    
    private final TelegramBotConfig config;
    
    public BurnedChatsBot(TelegramBotConfig config) {
        super(config.getToken());
        this.config = config;
    }
    
    @Override
    public void onUpdateReceived(Update update) {
        try {
            if (update.hasMessage() && update.getMessage().hasText()) {
                handleTextMessage(update.getMessage());
            } else if (update.hasCallbackQuery()) {
                handleCallbackQuery(update.getCallbackQuery());
            }
        } catch (Exception e) {
            log.error("Error processing update", e);
        }
    }
    
    private void handleTextMessage(Message message) throws TelegramApiException {
        String text = message.getText();
        long chatId = message.getChatId();
        
        switch (text) {
            case "/start" -> sendStartMessage(chatId);
            case "/help" -> sendHelpMessage(chatId);
            default -> {} // Ignore other messages
        }
    }
    
    private void sendStartMessage(long chatId) throws TelegramApiException {
        SendMessage message = SendMessage.builder()
            .chatId(chatId)
            .text("🔥 *Burned Chats*\n\n" +
                  "Private self-destructing chat.\n\n" +
                  "Tap the button below to get started.")
            .parseMode("Markdown")
            .replyMarkup(createMainKeyboard())
            .build();
        
        execute(message);
    }
    
    private void sendHelpMessage(long chatId) throws TelegramApiException {
        SendMessage message = SendMessage.builder()
            .chatId(chatId)
            .text("*How it works:*\n\n" +
                  "1. Open the app\n" +
                  "2. Find your contact by username\n" +
                  "3. Wait for confirmation\n" +
                  "4. Verify the Visual Fingerprint\n" +
                  "5. Chat privately!\n\n" +
                  "🔥 When you close the chat, all data is destroyed.")
            .parseMode("Markdown")
            .build();
        
        execute(message);
    }
    
    private InlineKeyboardMarkup createMainKeyboard() {
        InlineKeyboardButton webAppButton = InlineKeyboardButton.builder()
            .text("🚀 Open chat")
            .webApp(new WebAppInfo(config.getMiniAppUrl()))
            .build();
        
        return InlineKeyboardMarkup.builder()
            .keyboardRow(List.of(webAppButton))
            .build();
    }
    
    private void handleCallbackQuery(CallbackQuery callbackQuery) {
        // Handle callback buttons (if needed)
    }
    
    @Override
    public String getBotUsername() {
        return config.getUsername();
    }
}
```

### Bot Registration

```java
// config/TelegramBotInitializer.java
@Configuration
@RequiredArgsConstructor
@Slf4j
public class TelegramBotInitializer {
    
    private final BurnedChatsBot bot;
    
    @PostConstruct
    public void init() {
        try {
            TelegramBotsApi botsApi = new TelegramBotsApi(DefaultBotSession.class);
            botsApi.registerBot(bot);
            log.info("Telegram bot registered successfully");
        } catch (TelegramApiException e) {
            log.error("Failed to register Telegram bot", e);
            throw new RuntimeException("Failed to register bot", e);
        }
    }
}
```

### Webhook Mode (alternative to Long Polling)

```java
// telegram/BurnedChatsWebhookBot.java
@Component
@Slf4j
public class BurnedChatsWebhookBot extends TelegramWebhookBot {
    
    private final TelegramBotConfig config;
    private final BotCommandHandler commandHandler;
    
    public BurnedChatsWebhookBot(TelegramBotConfig config, 
                                  BotCommandHandler commandHandler) {
        super(config.getToken());
        this.config = config;
        this.commandHandler = commandHandler;
    }
    
    @Override
    public BotApiMethod<?> onWebhookUpdateReceived(Update update) {
        return commandHandler.handle(update);
    }
    
    @Override
    public String getBotPath() {
        return "/telegram/webhook";
    }
    
    @Override
    public String getBotUsername() {
        return config.getUsername();
    }
}
```

```java
// controller/TelegramWebhookController.java
@RestController
@RequestMapping("/telegram")
@RequiredArgsConstructor
@Slf4j
public class TelegramWebhookController {
    
    private final BurnedChatsWebhookBot bot;
    private final TelegramBotConfig config;
    
    @PostMapping("/webhook")
    public ResponseEntity<BotApiMethod<?>> onWebhook(
            @RequestHeader("X-Telegram-Bot-Api-Secret-Token") String secretToken,
            @RequestBody Update update) {
        
        // Verify secret token
        if (!config.getWebhookSecret().equals(secretToken)) {
            log.warn("Invalid webhook secret token");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        
        BotApiMethod<?> response = bot.onWebhookUpdateReceived(update);
        return ResponseEntity.ok(response);
    }
}
```

### Webhook Setup

```java
// telegram/WebhookSetup.java
@Component
@RequiredArgsConstructor
@Slf4j
public class WebhookSetup implements ApplicationRunner {
    
    private final BurnedChatsWebhookBot bot;
    private final TelegramBotConfig config;
    
    @Override
    public void run(ApplicationArguments args) throws Exception {
        if (config.getWebhookUrl() != null && !config.getWebhookUrl().isEmpty()) {
            SetWebhook setWebhook = SetWebhook.builder()
                .url(config.getWebhookUrl() + "/telegram/webhook")
                .secretToken(config.getWebhookSecret())
                .allowedUpdates(List.of("message", "callback_query"))
                .build();
            
            bot.setWebhook(setWebhook);
            log.info("Webhook set to: {}", config.getWebhookUrl());
        }
    }
}
```

---

## Notifications

### NotificationService

```java
// service/NotificationService.java
@Service
@RequiredArgsConstructor
@Slf4j
public class NotificationService {
    
    private final BurnedChatsBot bot;
    private final TelegramBotConfig config;
    
    /**
     * Chat request notification
     */
    public Mono<Void> notifyChatRequest(String recipientTgId, String sessionId) {
        return Mono.fromCallable(() -> {
            SendMessage message = SendMessage.builder()
                .chatId(recipientTgId)
                .text("🔔 *New private chat request*\n\n" +
                      "Someone wants to start a secure conversation with you.")
                .parseMode("Markdown")
                .replyMarkup(createOpenChatKeyboard(sessionId))
                .build();
            
            bot.execute(message);
            return null;
        }).subscribeOn(Schedulers.boundedElastic()).then();
    }
    
    /**
     * New message notification (when recipient is offline)
     */
    public Mono<Void> notifyNewMessage(String recipientTgId) {
        return Mono.fromCallable(() -> {
            SendMessage message = SendMessage.builder()
                .chatId(recipientTgId)
                .text("💬 *You have a new encrypted message*")
                .parseMode("Markdown")
                .replyMarkup(createOpenAppKeyboard())
                .build();
            
            bot.execute(message);
            return null;
        }).subscribeOn(Schedulers.boundedElastic()).then();
    }
    
    /**
     * Chat destroyed notification
     */
    public Mono<Void> notifySessionBurned(String recipientTgId) {
        return Mono.fromCallable(() -> {
            SendMessage message = SendMessage.builder()
                .chatId(recipientTgId)
                .text("🔥 *Chat was destroyed*\n\n" +
                      "Your contact ended the session. All data has been deleted.")
                .parseMode("Markdown")
                .build();
            
            bot.execute(message);
            return null;
        }).subscribeOn(Schedulers.boundedElastic()).then();
    }
    
    private InlineKeyboardMarkup createOpenChatKeyboard(String sessionId) {
        String url = config.getMiniAppUrl() + "?session=" + sessionId;
        
        InlineKeyboardButton button = InlineKeyboardButton.builder()
            .text("✅ Open")
            .webApp(new WebAppInfo(url))
            .build();
        
        return InlineKeyboardMarkup.builder()
            .keyboardRow(List.of(button))
            .build();
    }
    
    private InlineKeyboardMarkup createOpenAppKeyboard() {
        InlineKeyboardButton button = InlineKeyboardButton.builder()
            .text("📖 Read")
            .webApp(new WebAppInfo(config.getMiniAppUrl()))
            .build();
        
        return InlineKeyboardMarkup.builder()
            .keyboardRow(List.of(button))
            .build();
    }
}
```

### What Is NOT Sent in Notifications

| Data | Sent? | Reason |
|------|-------|--------|
| Sender name | ❌ | Privacy |
| Message text | ❌ | E2EE |
| Message count | ❌ | Metadata |
| Send time | ❌ | Timing attack |
| Session ID in text | ❌ | Mini App URL only |

---

## Security

### initData Validation (Java)

```java
// telegram/TelegramAuthService.java
@Service
@RequiredArgsConstructor
@Slf4j
public class TelegramAuthService {
    
    private final TelegramBotConfig config;
    private final ObjectMapper objectMapper;
    
    /**
     * Validates initData from Telegram Mini App
     * @return TelegramUser if validation succeeds
     * @throws UnauthorizedException if validation fails
     */
    public TelegramUser validateInitData(String initData) {
        try {
            Map<String, String> params = parseQueryString(initData);
            String hash = params.remove("hash");
            
            if (hash == null) {
                throw new UnauthorizedException("Missing hash in initData");
            }
            
            // Sort parameters by key
            String dataCheckString = params.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> e.getKey() + "=" + e.getValue())
                .collect(Collectors.joining("\n"));
            
            // Compute secret key: HMAC-SHA256("WebAppData", botToken)
            byte[] secretKey = hmacSha256(
                "WebAppData".getBytes(StandardCharsets.UTF_8),
                config.getToken().getBytes(StandardCharsets.UTF_8)
            );
            
            // Compute data hash
            byte[] calculatedHash = hmacSha256(
                secretKey,
                dataCheckString.getBytes(StandardCharsets.UTF_8)
            );
            String calculatedHashHex = bytesToHex(calculatedHash);
            
            // Constant-time hash comparison
            if (!MessageDigest.isEqual(
                    hash.getBytes(StandardCharsets.UTF_8),
                    calculatedHashHex.getBytes(StandardCharsets.UTF_8))) {
                throw new UnauthorizedException("Invalid initData hash");
            }
            
            // Check auth_date (not older than 1 hour)
            String authDateStr = params.get("auth_date");
            if (authDateStr == null) {
                throw new UnauthorizedException("Missing auth_date");
            }
            
            long authDate = Long.parseLong(authDateStr);
            long now = Instant.now().getEpochSecond();
            
            if (now - authDate > 3600) {
                throw new UnauthorizedException("initData expired");
            }
            
            // Parse user
            String userJson = params.get("user");
            if (userJson == null) {
                throw new UnauthorizedException("Missing user in initData");
            }
            
            // URL decode if needed
            String decodedUserJson = URLDecoder.decode(userJson, StandardCharsets.UTF_8);
            
            return objectMapper.readValue(decodedUserJson, TelegramUser.class);
            
        } catch (UnauthorizedException e) {
            throw e;
        } catch (Exception e) {
            log.error("Error validating initData", e);
            throw new UnauthorizedException("Invalid initData format");
        }
    }
    
    private Map<String, String> parseQueryString(String queryString) {
        Map<String, String> params = new LinkedHashMap<>();
        
        for (String pair : queryString.split("&")) {
            int idx = pair.indexOf('=');
            if (idx > 0) {
                String key = pair.substring(0, idx);
                String value = pair.substring(idx + 1);
                params.put(key, value);
            }
        }
        
        return params;
    }
    
    private byte[] hmacSha256(byte[] key, byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secretKeySpec = new SecretKeySpec(key, "HmacSHA256");
            mac.init(secretKeySpec);
            return mac.doFinal(data);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new RuntimeException("HMAC-SHA256 error", e);
        }
    }
    
    private String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }
}
```

### TelegramUser DTO

```java
// model/TelegramUser.java
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class TelegramUser {
    
    private Long id;
    
    @JsonProperty("first_name")
    private String firstName;
    
    @JsonProperty("last_name")
    private String lastName;
    
    private String username;
    
    @JsonProperty("language_code")
    private String languageCode;
    
    @JsonProperty("is_premium")
    private Boolean isPremium;
    
    @JsonProperty("photo_url")
    private String photoUrl;
}
```

### STOMP Auth Interceptor

```java
// websocket/StompAuthInterceptor.java
@Component
@RequiredArgsConstructor
@Slf4j
public class StompAuthInterceptor implements ChannelInterceptor {
    
    private final TelegramAuthService authService;
    
    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor
            .getAccessor(message, StompHeaderAccessor.class);
        
        if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
            // Get initData from headers
            String initData = accessor.getFirstNativeHeader("X-Telegram-Init-Data");
            
            if (initData == null || initData.isEmpty()) {
                throw new MessageDeliveryException("Missing initData");
            }
            
            try {
                TelegramUser user = authService.validateInitData(initData);
                
                // Create Principal for user identification
                accessor.setUser(new TelegramPrincipal(user));
                
                log.info("User {} connected via WebSocket", user.getId());
                
            } catch (UnauthorizedException e) {
                log.warn("WebSocket auth failed: {}", e.getMessage());
                throw new MessageDeliveryException("Authentication failed: " + e.getMessage());
            }
        }
        
        return message;
  }
}
```

### TelegramPrincipal

```java
// websocket/TelegramPrincipal.java
@Getter
@RequiredArgsConstructor
public class TelegramPrincipal implements Principal {
    
    private final TelegramUser user;
    
    @Override
    public String getName() {
        return user.getId().toString();
    }
    
    public String getUsername() {
        return user.getUsername();
    }
    
    public String getFirstName() {
        return user.getFirstName();
    }
}
```

### WebSocket Config with Auth

```java
// config/WebSocketConfig.java
@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    
    private final StompAuthInterceptor authInterceptor;
    
    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic", "/queue");
        config.setApplicationDestinationPrefixes("/app");
        config.setUserDestinationPrefix("/user");
    }
    
    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .withSockJS();
    }
    
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(authInterceptor);
    }
}
```

### Webhook Security

```java
// controller/TelegramWebhookController.java
@RestController
@RequestMapping("/telegram")
@RequiredArgsConstructor
@Slf4j
public class TelegramWebhookController {
    
    private final BurnedChatsWebhookBot bot;
    private final TelegramBotConfig config;
    
    @PostMapping("/webhook")
    public ResponseEntity<?> onWebhook(
            @RequestHeader(value = "X-Telegram-Bot-Api-Secret-Token", required = false) 
            String secretToken,
            @RequestBody Update update) {
        
        // Verify secret token
        if (!config.getWebhookSecret().equals(secretToken)) {
            log.warn("Invalid webhook secret token from IP: {}", 
                     getClientIpAddress());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Unauthorized"));
        }
        
        try {
            BotApiMethod<?> response = bot.onWebhookUpdateReceived(update);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error processing webhook", e);
            return ResponseEntity.ok().build(); // Telegram expects 200
        }
    }
    
    private String getClientIpAddress() {
        // Get the real client IP
        ServletRequestAttributes attrs = 
            (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attrs != null) {
            HttpServletRequest request = attrs.getRequest();
            String xForwardedFor = request.getHeader("X-Forwarded-For");
            if (xForwardedFor != null) {
                return xForwardedFor.split(",")[0].trim();
            }
            return request.getRemoteAddr();
        }
        return "unknown";
    }
}
```

---

## Mini App URL Parameters

### Supported Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `partner` | Username for auto-search | `?partner=alice` |
| `session` | Session ID to join | `?session=abc123` |

### Parameter Handling (Frontend)

```typescript
// src/telegram/params.ts
import WebApp from '@twa-dev/sdk';

interface StartParams {
  partner?: string;
  sessionId?: string;
}

export function parseStartParams(): StartParams {
  const params: StartParams = {};
  
  // From start_param (when opened via deep link)
  const startParam = WebApp.initDataUnsafe.start_param;
  if (startParam) {
    // Format: partner_alice or session_abc123
    const [type, value] = startParam.split('_');
    if (type === 'partner') params.partner = value;
    if (type === 'session') params.sessionId = value;
  }
  
  // From URL (when opened via web_app button)
  const url = new URL(window.location.href);
  const partner = url.searchParams.get('partner');
  const session = url.searchParams.get('session');
  
  if (partner) params.partner = partner;
  if (session) params.sessionId = session;
  
  return params;
}
```

---

## STOMP Client (Frontend)

### Connecting with Authorization

```typescript
// src/socket/client.ts
import { Client, IMessage } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import WebApp from '@twa-dev/sdk';

export function createStompClient(
  onConnect: () => void,
  onError: (error: string) => void
): Client {
  const client = new Client({
    webSocketFactory: () => new SockJS('/ws'),
    connectHeaders: {
      'X-Telegram-Init-Data': WebApp.initData
    },
    debug: (str) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('STOMP:', str);
      }
    },
    reconnectDelay: 5000,
    heartbeatIncoming: 20000,
    heartbeatOutgoing: 20000,
    onConnect: () => {
      console.log('STOMP connected');
      onConnect();
    },
    onStompError: (frame) => {
      console.error('STOMP error:', frame.headers.message);
      onError(frame.headers.message || 'Connection error');
    },
    onDisconnect: () => {
      console.log('STOMP disconnected');
    }
  });
  
  return client;
}
```

---

## Related Documents

- [API.md](./API.md) — WebSocket API
- [SECURITY.md](./SECURITY.md) — validation and security
- [USER_FLOWS.md](./USER_FLOWS.md) — user flows
