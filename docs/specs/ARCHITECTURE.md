# Архитектура системы

> Техническое описание компонентов Burned Chats (Java Stack)

## 📋 Содержание

- [Обзор архитектуры](#обзор-архитектуры)
- [Компоненты системы](#компоненты-системы)
- [Потоки данных](#потоки-данных)
- [Масштабирование](#масштабирование)
- [Отказоустойчивость](#отказоустойчивость)

---

## Обзор архитектуры

### Высокоуровневая схема

```
                                    ┌─────────────────────┐
                                    │   Telegram Cloud    │
                                    │  ┌───────────────┐  │
                                    │  │   Bot API     │  │
                                    │  └───────┬───────┘  │
                                    └──────────┼──────────┘
                                               │ Notifications
                                               ▼
┌──────────────┐     HTTPS/WSS      ┌─────────────────────┐
│              │◄──────────────────►│                     │
│   Frontend   │                    │      Backend        │
│  (Mini App)  │                    │   (Spring Boot)     │
│              │◄──────────────────►│  ┌───────────────┐  │
└──────────────┘    WebSocket/STOMP │  │  Spring       │  │
       │                            │  │  WebFlux      │  │
       │                            │  └───────┬───────┘  │
       │                            │          │          │
       │                            │  ┌───────▼───────┐  │
       │  Web Crypto API            │  │    Redis      │  │
       │  (все ключи здесь)         │  │  (Lettuce)    │  │
       │                            │  └───────────────┘  │
       ▼                            └─────────────────────┘
┌──────────────┐
│ sessionStorage│
│  (volatile)   │
└──────────────┘
```

### Принципы проектирования

1. **Zero-Knowledge** — сервер никогда не видит plaintext
2. **Ephemeral by Design** — данные существуют только в RAM клиентов
3. **Fail-Safe Destruction** — при любой ошибке ключи уничтожаются
4. **Minimal Trust** — доверие только к Web Crypto API браузера

---

## Компоненты системы

### 1. Frontend (Telegram Mini App)

```
frontend/
├── src/
│   ├── main.tsx                 # Entry point
│   ├── App.tsx                  # Root component
│   ├── components/
│   │   ├── Chat/
│   │   │   ├── ChatRoom.tsx     # Основной чат
│   │   │   ├── MessageList.tsx  # Список сообщений
│   │   │   ├── MessageInput.tsx # Ввод с шифрованием
│   │   │   └── BurnButton.tsx   # Кнопка уничтожения
│   │   ├── Search/
│   │   │   ├── UserSearch.tsx   # Поиск по Telegram ID
│   │   │   └── PendingRequest.tsx
│   │   ├── Verification/
│   │   │   ├── VisualFingerprint.tsx  # Визуальная верификация
│   │   │   └── SecretQuestion.tsx     # Опциональный вопрос
│   │   └── UI/
│   │       └── ...
│   ├── crypto/
│   │   ├── ecdh.ts              # ECDH key exchange
│   │   ├── aes.ts               # AES-GCM encryption
│   │   ├── fingerprint.ts       # Visual fingerprint generation
│   │   └── keyStore.ts          # sessionStorage wrapper
│   ├── socket/
│   │   ├── client.ts            # STOMP client
│   │   ├── events.ts            # Event types
│   │   └── handlers.ts          # Message handlers
│   ├── telegram/
│   │   ├── init.ts              # Mini App initialization
│   │   ├── theme.ts             # Adaptive theming
│   │   └── haptics.ts           # Haptic feedback
│   ├── hooks/
│   │   ├── useEncryptedChat.ts
│   │   ├── useKeyExchange.ts
│   │   └── useTelegram.ts
│   └── types/
│       └── index.ts
├── package.json
├── vite.config.ts
└── Dockerfile
```

#### Ключевые особенности Frontend

| Модуль | Ответственность |
|--------|-----------------|
| `crypto/` | Вся криптография изолирована, использует только Web Crypto API |
| `keyStore.ts` | Обёртка над sessionStorage с автоочисткой при закрытии |
| `socket/` | STOMP клиент для WebSocket, типизированные события |
| `telegram/` | Интеграция с Telegram: тема, haptics, back button |

---

### 2. Backend (Java 21 + Spring Boot 3.3)

```
backend/
├── src/main/java/dev/burnedchats/
│   ├── BurnedChatsApplication.java      # Entry point
│   ├── config/
│   │   ├── WebSocketConfig.java         # STOMP/WebSocket настройки
│   │   ├── RedisConfig.java             # Reactive Redis
│   │   ├── SecurityConfig.java          # Security фильтры
│   │   └── AppConfig.java               # Общие бины
│   ├── controller/
│   │   ├── HealthController.java        # Health check
│   │   ├── TelegramWebhookController.java # Webhook для бота
│   │   └── ChatController.java          # @MessageMapping для STOMP
│   ├── service/
│   │   ├── SessionService.java          # Управление сессиями
│   │   ├── MessageService.java          # Relay сообщений
│   │   ├── UserService.java             # Кеш пользователей
│   │   └── NotificationService.java     # Telegram уведомления
│   ├── telegram/
│   │   ├── BurnedChatsBot.java          # TelegramBots реализация
│   │   ├── TelegramAuthService.java     # initData валидация
│   │   └── BotCommands.java             # /start, /help команды
│   ├── websocket/
│   │   ├── WebSocketEventListener.java  # Connect/disconnect events
│   │   ├── UserSessionRegistry.java     # Маппинг user → session
│   │   ├── StompAuthInterceptor.java    # Авторизация WebSocket
│   │   └── handlers/
│   │       ├── SearchHandler.java       # SEARCH_USER
│   │       ├── SessionHandler.java      # CREATE/ACCEPT/REJECT
│   │       ├── HandshakeHandler.java    # PUBLIC_KEY relay
│   │       ├── MessageHandler.java      # SEND_MESSAGE relay
│   │       └── BurnHandler.java         # BURN_SESSION
│   ├── redis/
│   │   ├── SessionRepository.java       # session:* operations
│   │   ├── MessageRepository.java       # messages:* queue
│   │   ├── RequestRepository.java       # request:* queue
│   │   └── OnlineStatusRepository.java  # online:* heartbeat
│   ├── model/
│   │   ├── Session.java                 # Session entity
│   │   ├── ChatRequest.java             # Chat request DTO
│   │   ├── EncryptedMessage.java        # Encrypted message DTO
│   │   ├── TelegramUser.java            # Telegram user data
│   │   └── enums/
│   │       ├── SessionStatus.java
│   │       └── ErrorCode.java
│   ├── dto/
│   │   ├── request/                     # Incoming DTOs
│   │   └── response/                    # Outgoing DTOs
│   ├── exception/
│   │   ├── GlobalExceptionHandler.java
│   │   ├── SessionNotFoundException.java
│   │   └── UnauthorizedException.java
│   └── util/
│       ├── HmacUtils.java               # HMAC for initData
│       └── JsonUtils.java
├── src/main/resources/
│   ├── application.yml
│   ├── application-dev.yml
│   └── application-prod.yml
├── src/test/java/dev/burnedchats/
│   ├── service/
│   ├── websocket/
│   └── telegram/
├── build.gradle.kts
├── Dockerfile
└── docker-compose.yml
```

#### Backend НЕ делает:

- ❌ Не хранит ключи шифрования
- ❌ Не расшифровывает сообщения
- ❌ Не логирует содержимое
- ❌ Не хранит историю чатов

#### Backend делает:

- ✅ Валидирует Telegram initData
- ✅ Соединяет пользователей (rendezvous)
- ✅ Пересылает зашифрованные пакеты
- ✅ Хранит encrypted blobs с TTL (для offline)
- ✅ Отправляет push-уведомления (без содержимого)

---

### 3. Redis (Хранилище метаданных)

```
Структура ключей:

session:{sessionId}           # Метаданные активной сессии
  → TTL: 1 час
  → { participants, status, createdAt }

request:{recipientTgId}       # Входящие запросы на чат
  → TTL: 5 минут
  → { senderTgId, sessionId, timestamp }

messages:{sessionId}          # Очередь зашифрованных сообщений
  → TTL: 24 часа
  → List of encrypted blobs

online:{tgId}                 # Статус онлайн
  → TTL: 30 секунд (heartbeat)
```

#### TTL стратегия

| Тип данных | TTL | Причина |
|------------|-----|---------|
| Активная сессия | 1 час | Автоочистка неактивных |
| Запрос на чат | 5 минут | Быстрый ответ или отмена |
| Offline сообщения | 24 часа | Баланс между UX и приватностью |
| Online статус | 30 сек | Heartbeat обновление |

---

### 4. Telegram Bot

```
Функции бота:

1. Уведомления о запросах
   "🔔 Вам поступил запрос на приватный чат"
   [Открыть чат] ← inline button

2. Уведомления о сообщениях (если offline)
   "💬 У вас новое зашифрованное сообщение"
   [Открыть] ← inline button

3. НЕ содержит:
   - Имени отправителя
   - Текста сообщения
   - Любых идентификаторов, кроме sessionId
```

---

## Ключевые Java компоненты

### WebSocket Configuration

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    
    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // Используем простой брокер (или Redis для масштабирования)
        config.enableSimpleBroker("/topic", "/queue");
        config.setApplicationDestinationPrefixes("/app");
        config.setUserDestinationPrefix("/user");
    }
    
    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOrigins("*")
                .withSockJS();
    }
    
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompAuthInterceptor);
    }
}
```

### Reactive Redis Repository

```java
@Repository
@RequiredArgsConstructor
public class SessionRepository {
    
    private final ReactiveRedisTemplate<String, Session> redisTemplate;
    private static final Duration SESSION_TTL = Duration.ofHours(1);
    
    public Mono<Session> findById(String sessionId) {
        return redisTemplate.opsForValue()
            .get(keyFor(sessionId));
    }
    
    public Mono<Boolean> save(Session session) {
        return redisTemplate.opsForValue()
            .set(keyFor(session.getId()), session, SESSION_TTL);
    }
    
    public Mono<Boolean> delete(String sessionId) {
        return redisTemplate.delete(keyFor(sessionId))
            .map(count -> count > 0);
    }
    
    private String keyFor(String sessionId) {
        return "session:" + sessionId;
    }
}
```

### Chat Controller (STOMP)

```java
@Controller
@RequiredArgsConstructor
@Slf4j
public class ChatController {
    
    private final SessionService sessionService;
    private final SimpMessagingTemplate messagingTemplate;
    
    @MessageMapping("/search")
    public void searchUser(@Payload SearchRequest request, 
                          Principal principal) {
        String tgId = principal.getName();
        
        sessionService.searchUser(request.getQuery(), tgId)
            .subscribe(result -> {
                messagingTemplate.convertAndSendToUser(
                    tgId,
                    "/queue/search-result",
                    result
                );
            });
    }
    
    @MessageMapping("/send-message")
    public void sendMessage(@Payload SendMessageRequest request,
                           Principal principal) {
        String senderTgId = principal.getName();
        
        sessionService.relayMessage(request.getSessionId(), 
                                   request.getMessage(), 
                                   senderTgId)
            .subscribe(result -> {
                // Отправляем получателю
                messagingTemplate.convertAndSendToUser(
                    result.getRecipientTgId(),
                    "/queue/messages",
                    new NewMessageEvent(request.getSessionId(), 
                                       request.getMessage())
                );
                
                // Подтверждаем отправителю
                messagingTemplate.convertAndSendToUser(
                    senderTgId,
                    "/queue/message-sent",
                    new MessageSentEvent(request.getMessage().getId(), 
                                        result.isDelivered())
                );
            });
    }
    
    @MessageMapping("/burn")
    public void burnSession(@Payload BurnRequest request,
                           Principal principal) {
        String tgId = principal.getName();
        
        sessionService.burnSession(request.getSessionId(), tgId)
            .subscribe(session -> {
                // Уведомляем обоих участников
                session.getParticipants().forEach(participantId -> {
                    messagingTemplate.convertAndSendToUser(
                        participantId,
                        "/queue/session-burned",
                        new SessionBurnedEvent(request.getSessionId(), tgId)
                    );
                });
            });
    }
}
```

---

## Потоки данных

### Flow 1: Установка соединения

```
Alice                    Server                      Bob
  │                         │                         │
  │ 1. SEARCH_USER(@bob)    │                         │
  │────────────────────────►│                         │
  │                         │                         │
  │ 2. REQUEST_CREATED      │ 3. Bot notification     │
  │◄────────────────────────│────────────────────────►│
  │                         │                         │
  │                         │ 4. ACCEPT_REQUEST       │
  │                         │◄────────────────────────│
  │                         │                         │
  │ 5. PEER_JOINED          │ 6. PEER_JOINED          │
  │◄────────────────────────│────────────────────────►│
  │                         │                         │
  │ 7. PUBLIC_KEY (Alice)   │                         │
  │────────────────────────►│────────────────────────►│
  │                         │                         │
  │                         │ 8. PUBLIC_KEY (Bob)     │
  │◄────────────────────────│◄────────────────────────│
  │                         │                         │
  │ 9. Compute SharedSecret │ 9. Compute SharedSecret │
  │         (local)         │         (local)         │
```

### Flow 2: Обмен сообщениями

```
Alice                    Server                      Bob
  │                         │                         │
  │ encrypt(msg, sharedKey) │                         │
  │            │            │                         │
  │            ▼            │                         │
  │ MESSAGE {              │                         │
  │   iv: "...",           │                         │
  │   ciphertext: "...",   │                         │
  │   tag: "..."           │                         │
  │ }─────────────────────►│                         │
  │                         │                         │
  │                         │ if Bob online:         │
  │                         │   relay immediately    │
  │                         │────────────────────────►│
  │                         │                         │
  │                         │ if Bob offline:        │
  │                         │   store in Redis       │
  │                         │   send notification    │
```

### Flow 3: Уничтожение сессии

```
Alice                    Server                      Bob
  │                         │                         │
  │ BURN_SESSION            │                         │
  │────────────────────────►│                         │
  │                         │                         │
  │ Clear sessionStorage    │ Delete Redis keys      │ BURN_SIGNAL
  │ Clear RAM               │                        │◄───────────────
  │ Close Mini App          │                        │ Clear all
  │                         │                         │ Close Mini App
```

---

## Масштабирование

### Горизонтальное масштабирование (v2.0+)

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │    (nginx)      │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Spring Boot   │ │   Spring Boot   │ │   Spring Boot   │
│   (instance 1)  │ │   (instance 2)  │ │   (instance N)  │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Redis Cluster  │
                    │  (pub/sub)      │
                    └─────────────────┘
```

Для масштабирования WebSocket используем Redis pub/sub через Spring Session.

### Текущая архитектура (v1.0)

Для self-hosted MVP достаточно:
- 1 Spring Boot инстанс
- 1 Redis инстанс
- nginx как reverse proxy

---

## Отказоустойчивость

### Сценарии сбоев

| Сценарий | Поведение | Восстановление |
|----------|-----------|----------------|
| Потеря соединения | Auto-reconnect STOMP | Сообщения из Redis очереди |
| Crash сервера | Все активные сессии теряются | Пользователи создают новую сессию |
| Redis недоступен | Сервер возвращает 503 | Автоматически после восстановления Redis |
| Закрытие Mini App | Ключи стираются из sessionStorage | Новый handshake при повторном входе |

### Graceful Degradation

```java
@Component
@RequiredArgsConstructor
public class WebSocketEventListener {
    
    private final SessionService sessionService;
    private final SimpMessagingTemplate messagingTemplate;
    
    @EventListener
    public void handleSessionDisconnect(SessionDisconnectEvent event) {
        StompHeaderAccessor headers = StompHeaderAccessor.wrap(event.getMessage());
        String tgId = headers.getUser().getName();
        
        // Помечаем пользователя как offline
        sessionService.setOffline(tgId);
        
        // Уведомляем собеседников
        sessionService.getActiveSessions(tgId)
            .flatMap(session -> {
                String peerId = session.getOtherParticipant(tgId);
                return Mono.fromRunnable(() -> 
                    messagingTemplate.convertAndSendToUser(
                        peerId,
                        "/queue/peer-status",
                        new PeerStatusEvent(session.getId(), false)
                    )
                );
            })
            .subscribe();
    }
    
    @EventListener
    public void handleSessionConnect(SessionConnectedEvent event) {
        StompHeaderAccessor headers = StompHeaderAccessor.wrap(event.getMessage());
        String tgId = headers.getUser().getName();
        
        // Помечаем пользователя как online
        sessionService.setOnline(tgId);
        
        // Синхронизируем пропущенные сообщения
        sessionService.syncMessages(tgId).subscribe();
    }
}
```

---

## Подготовка к групповым чатам и комнатам (v2.0 / Phase 2)

Архитектура учитывает будущую поддержку групп и **комнат с паролем**. Детальный план: [DEVELOPMENT_PLAN_ROOMS.md](../phases/phase-2-rooms/DEVELOPMENT_PLAN_ROOMS.md).

### Комнаты: принципы конфиденциальности

- **Пароль:** на сервер передаётся только производная (salt + proof от KDF). Plaintext пароль не хранится и не логируется.
- **Инвайт-ссылки:** одноразовые или с лимитом использований; формат `startapp=invite_{token}` для Mini App.
- **Заявки на вход:** владелец принимает/отклоняет; сервер хранит заявки с TTL, без избыточной истории.

### Redis структура (Phase 2: комнаты)

```
room:{roomId}
  → { ownerTgId, salt, passwordProofHash, joinMode, createdAt }
  → TTL: 30 дней (продлевается при активности)

room_members:{roomId}
  → Set of tgId (участники)
  → удаляется при BURN_ROOM

invite:{token}
  → { roomId, createdBy, expiresAt, maxUses? }
  → TTL по expiresAt

room_join_request:{roomId}
  → заявки на вход (senderTgId, createdAt, …)
  → TTL: 24 часа

room_keys:{roomId}:{epoch}
  → зашифрованные ключи для участников (opaque blobs)
  → удаляется при BURN_ROOM / rekey

messages:{roomId}
  → List зашифрованных сообщений (аналог messages:{sessionId})
  → TTL: 24 часа
```

### Групповой E2EE

1. **Key Distribution** — Group Key Agreement (один групповой ключ в MVP или Sender Keys / Tree-DH), см. phase-2-rooms.
2. **Выдача ключа новому участнику** — key bundle (групповой ключ, зашифрованный публичным ключом участника); relay через сервер.
3. **Ротация ключей** — при выходе участника генерируется новый групповой ключ (rekey), рассылка оставшимся.

---

## Связанные документы

- [SECURITY.md](./SECURITY.md) — детали криптографии (в т.ч. пароли комнат в Phase 2)
- [API.md](./API.md) — спецификация WebSocket событий
- [DATA_MODELS.md](./DATA_MODELS.md) — структуры данных (в т.ч. комнаты)
- [DEVELOPMENT_PLAN_ROOMS.md](../phases/phase-2-rooms/DEVELOPMENT_PLAN_ROOMS.md) — план фазы 2: комнаты

