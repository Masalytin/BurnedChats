# API Спецификация

> WebSocket (STOMP) события и REST эндпоинты (Java Backend)

## 📋 Содержание

- [Общая информация](#общая-информация)
- [REST API](#rest-api)
- [WebSocket API (STOMP)](#websocket-api-stomp)
- [Типы данных](#типы-данных)
- [Коды ошибок](#коды-ошибок)

---

## Общая информация

### Base URL

```
Production: https://api.burnedchats.com
Development: http://localhost:8080
```

### Аутентификация

Все WebSocket соединения требуют Telegram `initData` в заголовках STOMP CONNECT:

```typescript
// Frontend
const client = new Client({
  connectHeaders: {
    'X-Telegram-Init-Data': window.Telegram.WebApp.initData
  }
});
```

```java
// Backend - StompAuthInterceptor.java
String initData = accessor.getFirstNativeHeader("X-Telegram-Init-Data");
TelegramUser user = authService.validateInitData(initData);
```

### Rate Limits

| Эндпоинт/событие | Лимит | Окно |
|------------------|-------|------|
| REST endpoints | 100 req | 1 min |
| `SEARCH_USER` | 10 req | 1 min |
| `SEND_MESSAGE` | 30 msg | 1 min |
| `CREATE_SESSION` | 3 req | 5 min |

---

## REST API

### Health Check

```http
GET /actuator/health
```

**Response:**
```json
{
  "status": "UP",
  "components": {
    "redis": {
      "status": "UP"
    },
    "diskSpace": {
      "status": "UP"
    }
  }
}
```

### Application Info

```http
GET /actuator/info
```

**Response:**
```json
{
  "app": {
    "name": "burned-chats",
    "version": "1.0.0"
  }
}
```

---

### Telegram Webhook

```http
POST /telegram/webhook
```

Обрабатывает входящие update от Telegram Bot API.

**Headers:**
```http
X-Telegram-Bot-Api-Secret-Token: <webhook_secret>
Content-Type: application/json
```

**Body:** Telegram Update object

**Java Controller:**

```java
@PostMapping("/webhook")
public ResponseEntity<?> onWebhook(
        @RequestHeader("X-Telegram-Bot-Api-Secret-Token") String secretToken,
        @RequestBody Update update) {
    
    if (!config.getWebhookSecret().equals(secretToken)) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }
    
    BotApiMethod<?> response = bot.onWebhookUpdateReceived(update);
    return ResponseEntity.ok(response);
}
```

---

## WebSocket API (STOMP)

### Подключение

```typescript
// Frontend - STOMP Client
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const client = new Client({
  webSocketFactory: () => new SockJS('https://api.burnedchats.com/ws'),
  connectHeaders: {
    'X-Telegram-Init-Data': window.Telegram.WebApp.initData
  },
  onConnect: () => {
    console.log('Connected');
    // Подписываемся на персональные сообщения
    client.subscribe('/user/queue/messages', handleMessage);
    client.subscribe('/user/queue/events', handleEvent);
  }
});

client.activate();
```

### Жизненный цикл соединения

```
┌─────────────────────────────────────────────────────────────┐
│                    CONNECTION LIFECYCLE                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Client                              Server                  │
│    │                                    │                    │
│    │ ─────── STOMP CONNECT ─────────────►│                   │
│    │         (X-Telegram-Init-Data)     │                    │
│    │                                    │ validate initData  │
│    │                                    │                    │
│    │ ◄─────── CONNECTED ────────────────│                    │
│    │                                    │                    │
│    │ ─────── SUBSCRIBE ─────────────────►│                   │
│    │         (/user/queue/*)            │                    │
│    │                                    │                    │
│    │ ══════ HEARTBEAT (20s) ═══════════│                    │
│    │                                    │                    │
│    │ ─────── DISCONNECT ────────────────►│                   │
│    │                                    │                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Клиентские события (Client → Server)

### `SEARCH_USER`

Поиск пользователя по Telegram username или ID.

**Frontend:**
```typescript
client.publish({
  destination: '/app/search',
  body: JSON.stringify({
    query: '@username' // или '123456789'
  })
});

// Подписка на результат
client.subscribe('/user/queue/search-result', (message) => {
  const result = JSON.parse(message.body);
  // { found: boolean, user?: UserInfo, error?: string }
});
```

**Backend Controller:**
```java
@MessageMapping("/search")
public void searchUser(@Payload SearchRequest request, 
                       Principal principal) {
    String tgId = principal.getName();
    
    userService.searchUser(request.getQuery(), tgId)
        .subscribe(result -> {
            messagingTemplate.convertAndSendToUser(
                tgId,
                "/queue/search-result",
                result
            );
        });
}
```

---

### `CREATE_SESSION`

Создание нового чата и отправка запроса собеседнику.

**Frontend:**
```typescript
client.publish({
  destination: '/app/session/create',
  body: JSON.stringify({
    recipientTgId: '444555666',
    secretQuestion: 'Как звали моего кота?' // опционально
  })
});

// Результат
client.subscribe('/user/queue/session-created', (message) => {
  const data = JSON.parse(message.body);
  // { sessionId: string, status: 'waiting' }
});

// Ошибка
client.subscribe('/user/queue/error', (message) => {
  const error = JSON.parse(message.body);
  // { code: string, message: string }
});
```

**Backend Controller:**
```java
@MessageMapping("/session/create")
public void createSession(@Payload CreateSessionRequest request,
                          Principal principal) {
    String senderTgId = principal.getName();
    
    sessionService.createSession(senderTgId, request)
        .flatMap(session -> 
            notificationService.notifyChatRequest(
                request.getRecipientTgId(), 
                session.getId()
            ).thenReturn(session)
        )
        .subscribe(session -> {
            messagingTemplate.convertAndSendToUser(
                senderTgId,
                "/queue/session-created",
                new SessionCreatedEvent(session.getId(), "waiting")
            );
        });
}
```

---

### `ACCEPT_REQUEST`

Принятие входящего запроса на чат.

**Frontend:**
```typescript
client.publish({
  destination: '/app/session/accept',
  body: JSON.stringify({
    sessionId: 'abc123',
    secretAnswer: 'Барсик' // если был вопрос
  })
});

// Оба участника получают
client.subscribe('/user/queue/session-started', (message) => {
  const data = JSON.parse(message.body);
  // { sessionId: string, peer: PeerInfo }
});
```

**Backend Controller:**
```java
@MessageMapping("/session/accept")
public void acceptRequest(@Payload AcceptRequestDto request,
                          Principal principal) {
    String acceptorTgId = principal.getName();
    
    sessionService.acceptRequest(request.getSessionId(), acceptorTgId, request)
        .subscribe(session -> {
            // Уведомляем обоих участников
            session.getParticipants().forEach(participantId -> {
                String peerId = session.getOtherParticipant(participantId);
                PeerInfo peer = userService.getPeerInfo(peerId).block();
                
                messagingTemplate.convertAndSendToUser(
                    participantId,
                    "/queue/session-started",
                    new SessionStartedEvent(session.getId(), peer)
                );
            });
        });
}
```

---

### `REJECT_REQUEST`

Отклонение запроса на чат.

**Frontend:**
```typescript
client.publish({
  destination: '/app/session/reject',
  body: JSON.stringify({
    sessionId: 'abc123'
  })
});
```

**Backend Controller:**
```java
@MessageMapping("/session/reject")
public void rejectRequest(@Payload RejectRequestDto request,
                          Principal principal) {
    String rejectorTgId = principal.getName();
    
    sessionService.rejectRequest(request.getSessionId(), rejectorTgId)
        .subscribe(senderId -> {
            messagingTemplate.convertAndSendToUser(
                senderId,
                "/queue/session-rejected",
                new SessionRejectedEvent(request.getSessionId())
            );
        });
}
```

---

### `SEND_PUBLIC_KEY`

Отправка публичного ключа ECDH для handshake.

**Frontend:**
```typescript
client.publish({
  destination: '/app/handshake/key',
  body: JSON.stringify({
    sessionId: 'abc123',
    publicKey: 'Base64EncodedRawKey...'
  })
});

// Peer получает
client.subscribe('/user/queue/peer-public-key', (message) => {
  const data = JSON.parse(message.body);
  // { sessionId: string, publicKey: string }
});
```

**Backend Controller:**
```java
@MessageMapping("/handshake/key")
public void sendPublicKey(@Payload PublicKeyDto request,
                          Principal principal) {
    String senderTgId = principal.getName();
    
    sessionService.getSession(request.getSessionId())
        .filter(session -> session.hasParticipant(senderTgId))
        .subscribe(session -> {
            String peerId = session.getOtherParticipant(senderTgId);
            
            messagingTemplate.convertAndSendToUser(
                peerId,
                "/queue/peer-public-key",
                new PeerPublicKeyEvent(request.getSessionId(), request.getPublicKey())
            );
        });
}
```

---

### `SEND_MESSAGE`

Отправка зашифрованного сообщения.

**Frontend:**
```typescript
client.publish({
  destination: '/app/message/send',
  body: JSON.stringify({
    sessionId: 'abc123',
    message: {
      id: 'uuid-v4',
      iv: 'Base64...',
      ciphertext: 'Base64...',
      tag: 'Base64...',
      timestamp: Date.now(),
      type: 'text'
    }
  })
});

// Peer получает
client.subscribe('/user/queue/messages', (message) => {
  const data = JSON.parse(message.body);
  // { sessionId: string, message: EncryptedMessage }
});

// Подтверждение отправителю
client.subscribe('/user/queue/message-sent', (message) => {
  const data = JSON.parse(message.body);
  // { messageId: string, delivered: boolean }
});
```

**Backend Controller:**
```java
@MessageMapping("/message/send")
public void sendMessage(@Payload SendMessageRequest request,
                        Principal principal) {
    String senderTgId = principal.getName();
    
    messageService.relayMessage(request.getSessionId(), request.getMessage(), senderTgId)
        .subscribe(result -> {
            if (result.isRecipientOnline()) {
                // Отправляем сразу
                messagingTemplate.convertAndSendToUser(
                    result.getRecipientTgId(),
                    "/queue/messages",
                    new NewMessageEvent(request.getSessionId(), request.getMessage())
                );
            } else {
                // Сохраняем и уведомляем через Telegram
                messageRepository.save(request.getSessionId(), request.getMessage())
                    .then(notificationService.notifyNewMessage(result.getRecipientTgId()))
                    .subscribe();
            }
            
            // Подтверждаем отправителю
            messagingTemplate.convertAndSendToUser(
                senderTgId,
                "/queue/message-sent",
                new MessageSentEvent(request.getMessage().getId(), result.isRecipientOnline())
            );
        });
}
```

---

### `CONFIRM_VERIFICATION`

Подтверждение Visual Fingerprint.

**Frontend:**
```typescript
client.publish({
  destination: '/app/verify/confirm',
  body: JSON.stringify({
    sessionId: 'abc123',
    confirmed: true
  })
});

// Оба получают статус
client.subscribe('/user/queue/verification-status', (message) => {
  const data = JSON.parse(message.body);
  // { sessionId: string, bothConfirmed: boolean, peerConfirmed: boolean }
});
```

**Backend Controller:**
```java
@MessageMapping("/verify/confirm")
public void confirmVerification(@Payload ConfirmVerificationDto request,
                                Principal principal) {
    String tgId = principal.getName();
    
    sessionService.confirmVerification(request.getSessionId(), tgId, request.isConfirmed())
        .subscribe(session -> {
            session.getParticipants().forEach(participantId -> {
                String peerId = session.getOtherParticipant(participantId);
                boolean peerConfirmed = session.isVerified(peerId);
                boolean bothConfirmed = session.isBothVerified();
                
                messagingTemplate.convertAndSendToUser(
                    participantId,
                    "/queue/verification-status",
                    new VerificationStatusEvent(
                        request.getSessionId(), 
                        bothConfirmed, 
                        peerConfirmed
                    )
                );
            });
        });
}
```

---

### `BURN_SESSION`

Уничтожение сессии.

**Frontend:**
```typescript
client.publish({
  destination: '/app/session/burn',
  body: JSON.stringify({
    sessionId: 'abc123'
  })
});

// Оба получают
client.subscribe('/user/queue/session-burned', (message) => {
  const data = JSON.parse(message.body);
  // { sessionId: string, burnedBy: string }
});
```

**Backend Controller:**
```java
@MessageMapping("/session/burn")
public void burnSession(@Payload BurnSessionDto request,
                        Principal principal) {
    String initiatorTgId = principal.getName();
    
    sessionService.burnSession(request.getSessionId(), initiatorTgId)
        .subscribe(session -> {
            session.getParticipants().forEach(participantId -> {
                messagingTemplate.convertAndSendToUser(
                    participantId,
                    "/queue/session-burned",
                    new SessionBurnedEvent(request.getSessionId(), initiatorTgId)
                );
            });
            
            // Очищаем Redis
            sessionRepository.delete(request.getSessionId()).subscribe();
            messageRepository.deleteAll(request.getSessionId()).subscribe();
        });
}
```

---

### `SYNC_MESSAGES`

Запрос пропущенных сообщений (при reconnect).

**Frontend:**
```typescript
client.publish({
  destination: '/app/message/sync',
  body: JSON.stringify({
    sessionId: 'abc123',
    lastMessageId: 'uuid-last-received' // опционально
  })
});

// Результат
client.subscribe('/user/queue/sync-result', (message) => {
  const data = JSON.parse(message.body);
  // { sessionId: string, messages: EncryptedMessage[] }
});
```

**Backend Controller:**
```java
@MessageMapping("/message/sync")
public void syncMessages(@Payload SyncMessagesDto request,
                         Principal principal) {
    String tgId = principal.getName();
    
    messageRepository.getMessages(request.getSessionId(), request.getLastMessageId())
        .collectList()
        .subscribe(messages -> {
            messagingTemplate.convertAndSendToUser(
                tgId,
                "/queue/sync-result",
                new SyncMessagesResult(request.getSessionId(), messages)
            );
            
            // Удаляем доставленные сообщения из очереди
            if (!messages.isEmpty()) {
                messageRepository.deleteDelivered(request.getSessionId(), messages)
                    .subscribe();
            }
        });
}
```

---

### `TYPING_START` / `TYPING_STOP`

Индикатор набора текста.

**Frontend:**
```typescript
// Начало набора
client.publish({
  destination: '/app/typing/start',
  body: JSON.stringify({ sessionId: 'abc123' })
});

// Окончание набора
client.publish({
  destination: '/app/typing/stop',
  body: JSON.stringify({ sessionId: 'abc123' })
});

// Peer получает
client.subscribe('/user/queue/peer-typing', (message) => {
  const data = JSON.parse(message.body);
  // { sessionId: string, isTyping: boolean }
});
```

**Backend Controller:**
```java
@MessageMapping("/typing/start")
public void typingStart(@Payload TypingDto request, Principal principal) {
    relayTypingStatus(request.getSessionId(), principal.getName(), true);
}

@MessageMapping("/typing/stop")
public void typingStop(@Payload TypingDto request, Principal principal) {
    relayTypingStatus(request.getSessionId(), principal.getName(), false);
}

private void relayTypingStatus(String sessionId, String senderTgId, boolean isTyping) {
    sessionService.getSession(sessionId)
        .subscribe(session -> {
            String peerId = session.getOtherParticipant(senderTgId);
            messagingTemplate.convertAndSendToUser(
                peerId,
                "/queue/peer-typing",
                new PeerTypingEvent(sessionId, isTyping)
            );
        });
}
```

---

## Серверные события (Server → Client)

Все серверные события отправляются на персональные очереди пользователя (`/user/queue/*`).

| Очередь | Событие | Описание |
|---------|---------|----------|
| `/user/queue/search-result` | SearchResult | Результат поиска |
| `/user/queue/session-created` | SessionCreated | Сессия создана |
| `/user/queue/session-started` | SessionStarted | Сессия активна |
| `/user/queue/session-rejected` | SessionRejected | Запрос отклонён |
| `/user/queue/session-burned` | SessionBurned | Сессия уничтожена |
| `/user/queue/incoming-request` | IncomingRequest | Входящий запрос |
| `/user/queue/peer-joined` | PeerJoined | Peer подключился |
| `/user/queue/peer-left` | PeerLeft | Peer отключился |
| `/user/queue/peer-public-key` | PeerPublicKey | Публичный ключ peer |
| `/user/queue/messages` | NewMessage | Новое сообщение |
| `/user/queue/message-sent` | MessageSent | Подтверждение отправки |
| `/user/queue/verification-status` | VerificationStatus | Статус верификации |
| `/user/queue/peer-typing` | PeerTyping | Peer печатает |
| `/user/queue/sync-result` | SyncResult | Пропущенные сообщения |
| `/user/queue/error` | Error | Ошибка |

---

## Типы данных

### EncryptedMessage

```java
// Java DTO
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EncryptedMessage {
    private String id;           // UUID v4
    private String iv;           // Base64, 12 bytes
    private String ciphertext;   // Base64
    private String tag;          // Base64, 16 bytes
    private Long timestamp;      // Unix timestamp ms
    private String type;         // "text"
}
```

```typescript
// TypeScript
interface EncryptedMessage {
  id: string;
  iv: string;
  ciphertext: string;
  tag: string;
  timestamp: number;
  type: 'text';
}
```

### Session

```java
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Session {
    private String id;
    private List<String> participants;  // Telegram IDs
    private SessionStatus status;       // WAITING, ACTIVE, BURNED
    private Long createdAt;
    private boolean hasSecretQuestion;
    private Map<String, Boolean> verified;  // participantId -> verified
    
    public String getOtherParticipant(String tgId) {
        return participants.stream()
            .filter(p -> !p.equals(tgId))
            .findFirst()
            .orElseThrow();
    }
    
    public boolean isBothVerified() {
        return verified.values().stream().allMatch(v -> v);
    }
}
```

### PeerInfo

```java
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PeerInfo {
    private String tgId;
    private String username;
    private String firstName;
    private String lastName;
    private String photoUrl;
}
```

---

## Коды ошибок

### Общие ошибки

| Код | HTTP | Описание |
|-----|------|----------|
| `UNAUTHORIZED` | 401 | Невалидный initData |
| `FORBIDDEN` | 403 | Нет доступа к ресурсу |
| `NOT_FOUND` | 404 | Ресурс не найден |
| `RATE_LIMITED` | 429 | Превышен лимит запросов |
| `INTERNAL_ERROR` | 500 | Внутренняя ошибка сервера |

### Ошибки сессий

| Код | Описание |
|-----|----------|
| `SESSION_NOT_FOUND` | Сессия не существует или истекла |
| `SESSION_FULL` | В сессии уже 2 участника |
| `SESSION_EXPIRED` | Время ожидания истекло |
| `SESSION_BURNED` | Сессия была уничтожена |
| `NOT_PARTICIPANT` | Вы не участник этой сессии |

### Ошибки пользователей

| Код | Описание |
|-----|----------|
| `USER_NOT_FOUND` | Пользователь не найден |
| `USER_BLOCKED` | Пользователь заблокировал вас |
| `SELF_CHAT` | Нельзя создать чат с собой |

### Ошибки сообщений

| Код | Описание |
|-----|----------|
| `MESSAGE_TOO_LARGE` | Превышен лимит размера |
| `INVALID_FORMAT` | Неверный формат данных |
| `FILE_TOO_LARGE` | Файл превышает 25 MB |

### Java Exception Handler

```java
@ControllerAdvice
@Slf4j
public class WebSocketExceptionHandler {
    
    @MessageExceptionHandler
    public void handleException(Exception ex, Principal principal) {
        log.error("WebSocket error for user {}: {}", 
            principal.getName(), ex.getMessage());
        
        ErrorCode code = mapToErrorCode(ex);
        
        messagingTemplate.convertAndSendToUser(
            principal.getName(),
            "/queue/error",
            new ErrorEvent(code, ex.getMessage())
        );
    }
    
    private ErrorCode mapToErrorCode(Exception ex) {
        if (ex instanceof SessionNotFoundException) {
            return ErrorCode.SESSION_NOT_FOUND;
        }
        if (ex instanceof UnauthorizedException) {
            return ErrorCode.UNAUTHORIZED;
        }
        // ... другие маппинги
        return ErrorCode.INTERNAL_ERROR;
    }
}
```

---

## WebSocket Reconnection

### Стратегия переподключения (Frontend)

```typescript
const client = new Client({
  webSocketFactory: () => new SockJS('/ws'),
  connectHeaders: {
    'X-Telegram-Init-Data': WebApp.initData
  },
  reconnectDelay: 5000,        // 5 секунд между попытками
  heartbeatIncoming: 20000,    // Heartbeat входящий
  heartbeatOutgoing: 20000,    // Heartbeat исходящий
  
  onConnect: () => {
    // При переподключении восстанавливаем сессию
    if (currentSessionId) {
      syncMessages(currentSessionId, lastMessageId);
    }
  },
  
  onDisconnect: () => {
    setConnectionStatus('reconnecting');
  },
  
  onStompError: (frame) => {
    console.error('STOMP error:', frame.headers.message);
  }
});
```

---

## Пример полного flow

```typescript
// 1. Подключение
const client = new Client({
  webSocketFactory: () => new SockJS('/ws'),
  connectHeaders: { 'X-Telegram-Init-Data': initData }
});

client.onConnect = () => {
  // 2. Подписки на события
  client.subscribe('/user/queue/search-result', handleSearchResult);
  client.subscribe('/user/queue/session-started', handleSessionStarted);
  client.subscribe('/user/queue/peer-public-key', handlePeerPublicKey);
  client.subscribe('/user/queue/messages', handleNewMessage);
  client.subscribe('/user/queue/session-burned', handleSessionBurned);
  client.subscribe('/user/queue/error', handleError);
  
  // 3. Поиск пользователя
  client.publish({
    destination: '/app/search',
    body: JSON.stringify({ query: '@alice' })
  });
};

// 4. Обработка результата поиска
function handleSearchResult(message) {
  const { found, user } = JSON.parse(message.body);
  if (found) {
    // 5. Создание сессии
    client.publish({
      destination: '/app/session/create',
      body: JSON.stringify({ recipientTgId: user.tgId })
    });
  }
}

// 6. Обработка старта сессии
async function handleSessionStarted(message) {
  const { sessionId, peer } = JSON.parse(message.body);
  
  // 7. Генерация и отправка ключа
  const keyPair = await generateKeyPair();
  const publicKey = await exportPublicKey(keyPair.publicKey);
  
  client.publish({
    destination: '/app/handshake/key',
    body: JSON.stringify({ sessionId, publicKey })
  });
}

// 8. Получение ключа peer
async function handlePeerPublicKey(message) {
  const { publicKey } = JSON.parse(message.body);
  const peerKey = await importPublicKey(publicKey);
  const sharedKey = await deriveKey(keyPair.privateKey, peerKey);
  
  // 9. Генерация Visual Fingerprint
  const fingerprint = await generateFingerprint(sharedKey);
  showVerificationUI(fingerprint);
}

// 10. Отправка сообщений
async function sendMessage(text: string) {
  const encrypted = await encrypt(text, sharedKey);
  client.publish({
    destination: '/app/message/send',
    body: JSON.stringify({ sessionId, message: encrypted })
  });
}

// 11. Получение сообщений
async function handleNewMessage(message) {
  const { message: encrypted } = JSON.parse(message.body);
  const decrypted = await decrypt(encrypted, sharedKey);
  displayMessage(decrypted);
}

// 12. Уничтожение
function burnSession() {
  client.publish({
    destination: '/app/session/burn',
    body: JSON.stringify({ sessionId })
  });
  clearKeys();
  WebApp.close();
}

client.activate();
```

---

## Связанные документы

- [DATA_MODELS.md](./DATA_MODELS.md) — структуры данных в Redis
- [SECURITY.md](./SECURITY.md) — криптография
- [ARCHITECTURE.md](./ARCHITECTURE.md) — общая архитектура

