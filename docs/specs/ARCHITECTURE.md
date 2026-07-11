# System Architecture

> Technical description of Burned Chats components (Java Stack)

## 📋 Table of Contents

- [Architecture Overview](#architecture-overview)
- [System Components](#system-components)
- [Data Flows](#data-flows)
- [Scaling](#scaling)
- [Fault Tolerance](#fault-tolerance)

---

## Architecture Overview

### High-Level Diagram

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
       │  (all keys here)           │  │  (Lettuce)    │  │
       │                            │  └───────────────┘  │
       ▼                            └─────────────────────┘
┌──────────────┐
│ sessionStorage│
│  (volatile)   │
└──────────────┘
```

### Design Principles

1. **Zero-Knowledge** — the server never sees plaintext
2. **Ephemeral by Design** — data exists only in client RAM
3. **Fail-Safe Destruction** — keys are destroyed on any error
4. **Minimal Trust** — trust only the browser's Web Crypto API

---

## System Components

### 1. Frontend (Telegram Mini App)

```
frontend/
├── src/
│   ├── main.tsx                 # Entry point
│   ├── App.tsx                  # Root component
│   ├── components/
│   │   ├── Chat/
│   │   │   ├── ChatRoom.tsx     # Main chat
│   │   │   ├── MessageList.tsx  # Message list
│   │   │   ├── MessageInput.tsx # Input with encryption
│   │   │   └── BurnButton.tsx   # Burn button
│   │   ├── Search/
│   │   │   ├── UserSearch.tsx   # Search by Telegram ID
│   │   │   └── PendingRequest.tsx
│   │   ├── Verification/
│   │   │   ├── VisualFingerprint.tsx  # Visual verification
│   │   │   └── SecretQuestion.tsx     # Optional question
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
│   ├── i18n/
│   │   ├── index.ts             # i18next init, language_code → locale
│   │   └── locales/
│   │       ├── en.json          # English (fallback)
│   │       └── ru.json          # Russian
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

#### Key Frontend Features

| Module | Responsibility |
|--------|----------------|
| `crypto/` | All cryptography isolated, uses only Web Crypto API |
| `keyStore.ts` | sessionStorage wrapper with auto-cleanup on close |
| `socket/` | STOMP client for WebSocket, typed events |
| `telegram/` | Telegram integration: theme, haptics, back button |
| `i18n/` | Multilingual support: react-i18next, auto-detect from `language_code` |

---

### 2. Backend (Java 21 + Spring Boot 3.3)

```
backend/
├── src/main/java/dev/burnedchats/
│   ├── BurnedChatsApplication.java      # Entry point
│   ├── config/
│   │   ├── WebSocketConfig.java         # STOMP/WebSocket settings
│   │   ├── RedisConfig.java             # Reactive Redis
│   │   ├── SecurityConfig.java          # Security filters
│   │   └── AppConfig.java               # Common beans
│   ├── controller/
│   │   ├── HealthController.java        # Health check
│   │   ├── TelegramWebhookController.java # Bot webhook
│   │   └── ChatController.java          # @MessageMapping for STOMP
│   ├── service/
│   │   ├── SessionService.java          # Session management
│   │   ├── MessageService.java          # Message relay
│   │   ├── UserService.java             # User cache
│   │   └── NotificationService.java     # Telegram notifications
│   ├── telegram/
│   │   ├── BurnedChatsBot.java          # TelegramBots implementation
│   │   ├── TelegramAuthService.java     # initData validation
│   │   ├── BotMessageService.java       # i18n: keys → localized text
│   │   └── BotCommands.java             # /start, /help commands
│   ├── websocket/
│   │   ├── WebSocketEventListener.java  # Connect/disconnect events
│   │   ├── UserSessionRegistry.java     # user → session mapping
│   │   ├── StompAuthInterceptor.java    # WebSocket authorization
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
│   ├── application-prod.yml
│   └── i18n/
│       ├── messages.properties      # fallback (English)
│       ├── messages_en.properties
│       └── messages_ru.properties
├── src/test/java/dev/burnedchats/
│   ├── service/
│   ├── websocket/
│   └── telegram/
├── build.gradle.kts
├── Dockerfile
└── docker-compose.yml
```

#### Backend does NOT:

- ❌ Store encryption keys
- ❌ Decrypt messages
- ❌ Log message content
- ❌ Store chat history

#### Backend does:

- ✅ Validate Telegram initData
- ✅ Connect users (rendezvous)
- ✅ Relay encrypted packets
- ✅ Store encrypted blobs with TTL (for offline)
- ✅ Send push notifications (without content)

---

### 3. Redis (Metadata Storage)

```
Key structure:

session:{sessionId}           # Active session metadata
  → TTL: 1 hour
  → { participants, status, createdAt }

request:{recipientTgId}       # Incoming chat requests
  → TTL: 5 minutes
  → { senderTgId, sessionId, timestamp }

messages:{sessionId}          # Encrypted message queue
  → TTL: 24 hours
  → List of encrypted blobs

online:{tgId}                 # Online status
  → TTL: 30 seconds (heartbeat)
```

#### TTL Strategy

| Data Type | TTL | Reason |
|-----------|-----|--------|
| Active session | 1 hour | Auto-cleanup of inactive sessions |
| Chat request | 5 minutes | Quick response or cancellation |
| Offline messages | 24 hours | Balance between UX and privacy |
| Online status | 30 sec | Heartbeat refresh |

---

### 4. Telegram Bot

```
Bot functions:

1. Request notifications
   "🔔 You received a private chat request"
   [Open chat] ← inline button

2. Message notifications (if offline)
   "💬 You have a new encrypted message"
   [Open] ← inline button

3. Does NOT contain:
   - Sender name
   - Message text
   - Any identifiers except sessionId
```

---

## Key Java Components

### WebSocket Configuration

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    
    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // Use simple broker (or Redis for scaling)
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
                // Send to recipient
                messagingTemplate.convertAndSendToUser(
                    result.getRecipientTgId(),
                    "/queue/messages",
                    new NewMessageEvent(request.getSessionId(), 
                                       request.getMessage())
                );
                
                // Confirm to sender
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
                // Notify both participants
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

## Data Flows

### Flow 1: Connection Establishment

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

### Flow 2: Message Exchange

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

### Flow 3: Session Burn

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

## Scaling

### Horizontal Scaling (v2.0+)

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

For WebSocket scaling, use Redis pub/sub via Spring Session.

### Current Architecture (v1.0)

For self-hosted MVP, the following is sufficient:
- 1 Spring Boot instance
- 1 Redis instance
- nginx as reverse proxy

---

## Fault Tolerance

### Failure Scenarios

| Scenario | Behavior | Recovery |
|----------|----------|----------|
| Connection loss | Auto-reconnect STOMP | Messages from Redis queue |
| Server crash | All active sessions are lost | Users create a new session |
| Redis unavailable | Server returns 503 | Automatic after Redis recovery |
| Mini App closed | Keys wiped from sessionStorage | New handshake on re-entry |

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
        
        // Mark user as offline
        sessionService.setOffline(tgId);
        
        // Notify conversation partners
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
        
        // Mark user as online
        sessionService.setOnline(tgId);
        
        // Sync missed messages
        sessionService.syncMessages(tgId).subscribe();
    }
}
```

---

## Preparation for Group Chats and Rooms (v2.0 / Phase 2)

The architecture accounts for future group support and **password-protected rooms**.

### Rooms: Privacy Principles

- **Password:** only a derivative (salt + KDF proof) is sent to the server. Plaintext password is not stored or logged.
- **Invite links:** one-time use or usage-limited; format `startapp=invite_{token}` for Mini App.
- **Join requests:** owner accepts/rejects; server stores requests with TTL, without excessive history.

### Redis Structure (Phase 2: Rooms)

```
room:{roomId}
  → { ownerTgId, salt, passwordProofHash, joinMode, createdAt }
  → TTL: 30 days (extended on activity)

room_members:{roomId}
  → Set of tgId (members)
  → deleted on BURN_ROOM

invite:{token}
  → { roomId, createdBy, expiresAt, maxUses? }
  → TTL per expiresAt

room_join_request:{roomId}
  → join requests (senderTgId, createdAt, …)
  → TTL: 24 hours

room_keys:{roomId}:{epoch}
  → encrypted keys for members (opaque blobs)
  → deleted on BURN_ROOM / rekey

messages:{roomId}
  → List of encrypted messages (analog of messages:{sessionId})
  → TTL: 24 hours
```

### Group E2EE

1. **Key Distribution** — Group Key Agreement (single group key in MVP or Sender Keys / Tree-DH), see [GROUP_KEY_PROTOCOL.md](./GROUP_KEY_PROTOCOL.md).
2. **Key delivery to new member** — key bundle (group key encrypted with member's public key); relay via server.
3. **Key rotation** — on member departure, a new group key is generated (rekey), distributed to remaining members.

---

## Related Documents

- [SECURITY.md](./SECURITY.md) — cryptography details (including room passwords in Phase 2)
- [API.md](./API.md) — WebSocket event specification
- [DATA_MODELS.md](./DATA_MODELS.md) — data structures (including rooms)
- [GROUP_KEY_PROTOCOL.md](./GROUP_KEY_PROTOCOL.md) — group key protocol: scheme selection, wrap/unwrap, rekey
