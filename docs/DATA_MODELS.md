# Структуры данных

> Модели данных Redis, Java DTO и TypeScript интерфейсы

## 📋 Содержание

- [Redis Schema](#redis-schema)
- [Java DTOs](#java-dtos)
- [TypeScript Interfaces](#typescript-interfaces)
- [Валидация данных](#валидация-данных)

---

## Redis Schema

### Обзор ключей

```
┌─────────────────────────────────────────────────────────────────┐
│                       REDIS KEY PATTERNS                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  session:{sessionId}          → Hash    │ TTL: 1 hour           │
│  request:{recipientTgId}      → List    │ TTL: 5 minutes        │
│  messages:{sessionId}         → List    │ TTL: 24 hours         │
│  online:{tgId}                → String  │ TTL: 30 seconds       │
│  user:{tgId}                  → Hash    │ TTL: 7 days           │
│  rate:{type}:{tgId}           → String  │ TTL: varies           │
│  blocked:{tgId}               → Set     │ No TTL                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### `session:{sessionId}`

Метаданные активной сессии чата.

```redis
HSET session:abc123
  participant1    "111222333"
  participant2    "444555666"
  status          "active"
  createdAt       "1704067200000"
  hasQuestion     "true"
  questionHash    "e3b0c44298fc1c149..."
  verified1       "true"
  verified2       "false"

EXPIRE session:abc123 3600
```

| Поле | Тип | Описание |
|------|-----|----------|
| `participant1` | string | Telegram ID создателя |
| `participant2` | string | Telegram ID получателя |
| `status` | enum | `waiting` \| `active` \| `burned` |
| `createdAt` | number | Unix timestamp в мс |
| `hasQuestion` | boolean | Есть ли секретный вопрос |
| `questionHash` | string? | SHA-256 хеш вопроса (для проверки) |
| `verified1` | boolean | Подтвердил ли participant1 fingerprint |
| `verified2` | boolean | Подтвердил ли participant2 fingerprint |

**TTL:** 1 час (автоочистка неактивных сессий)

---

### `request:{recipientTgId}`

Очередь входящих запросов на чат.

```redis
LPUSH request:444555666 '{
  "sessionId": "abc123",
  "senderTgId": "111222333",
  "senderUsername": "alice",
  "senderFirstName": "Alice",
  "hasQuestion": true,
  "question": "Как звали моего кота?",
  "createdAt": 1704067200000
}'

EXPIRE request:444555666 300
```

**TTL:** 5 минут (запрос истекает)

---

### `messages:{sessionId}`

Очередь зашифрованных сообщений для offline доставки.

```redis
RPUSH messages:abc123 '{
  "id": "msg-uuid-1",
  "iv": "base64...",
  "ciphertext": "base64...",
  "tag": "base64...",
  "timestamp": 1704067200000,
  "type": "text",
  "senderTgId": "111222333"
}'

EXPIRE messages:abc123 86400
```

**Важно:** Сервер добавляет `senderTgId` для routing, но это НЕ нарушает E2EE — содержимое всё равно зашифровано.

**TTL:** 24 часа (баланс между UX и приватностью)

---

### `online:{tgId}`

Статус онлайн (heartbeat).

```redis
SET online:111222333 "1704067200000"
EXPIRE online:111222333 30
```

Клиент отправляет heartbeat каждые 20 секунд, TTL 30 секунд.

---

### `user:{tgId}`

Кеш информации о пользователе.

```redis
HSET user:111222333
  username      "alice"
  firstName     "Alice"
  lastName      "Smith"
  photoUrl      "https://..."
  lastSeen      "1704067200000"
  registered    "1704000000000"

EXPIRE user:111222333 604800
```

**TTL:** 7 дней (обновляется при каждом входе)

---

### `rate:{type}:{tgId}`

Rate limiting counters.

```redis
INCR rate:message:111222333
EXPIRE rate:message:111222333 60
```

| Type | TTL | Max |
|------|-----|-----|
| `search` | 60s | 10 |
| `message` | 60s | 30 |
| `session` | 300s | 3 |

---

### `blocked:{tgId}`

Список заблокированных пользователей.

```redis
SADD blocked:111222333 "444555666" "777888999"
```

**TTL:** Нет (пользователь управляет вручную)

---

## Java DTOs

### Session Entity

```java
// model/Session.java
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Session {
    
    private String id;
    private List<String> participants;
    private SessionStatus status;
    private Long createdAt;
    private boolean hasSecretQuestion;
    private String questionHash;
    private Map<String, Boolean> verified;
    
    public String getOtherParticipant(String tgId) {
        return participants.stream()
            .filter(p -> !p.equals(tgId))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("Participant not found"));
    }
    
    public boolean hasParticipant(String tgId) {
        return participants.contains(tgId);
    }
    
    public boolean isVerified(String tgId) {
        return Boolean.TRUE.equals(verified.get(tgId));
    }
    
    public boolean isBothVerified() {
        return verified.values().stream().allMatch(v -> v);
    }
}

// model/enums/SessionStatus.java
public enum SessionStatus {
    WAITING,
    ACTIVE,
    BURNED
}
```

### Chat Request

```java
// model/ChatRequest.java
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ChatRequest {
    private String sessionId;
    private String senderTgId;
    private String senderUsername;
    private String senderFirstName;
    private boolean hasQuestion;
    private String question;
    private Long createdAt;
}
```

### Encrypted Message

```java
// model/EncryptedMessage.java
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EncryptedMessage {
    private String id;
    private String iv;
    private String ciphertext;
    private String tag;
    private Long timestamp;
    private String type;
    private String senderTgId; // Добавляется сервером для routing
}
```

### Telegram User

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

### Peer Info

```java
// model/PeerInfo.java
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PeerInfo {
    private String tgId;
    private String username;
    private String firstName;
    private String lastName;
    private String photoUrl;
    
    public static PeerInfo from(TelegramUser user) {
        return PeerInfo.builder()
            .tgId(user.getId().toString())
            .username(user.getUsername())
            .firstName(user.getFirstName())
            .lastName(user.getLastName())
            .photoUrl(user.getPhotoUrl())
            .build();
    }
}
```

---

### Request DTOs

```java
// dto/request/SearchRequest.java
@Data
public class SearchRequest {
    @NotBlank
    @Size(min = 1, max = 100)
    private String query;
}

// dto/request/CreateSessionRequest.java
@Data
public class CreateSessionRequest {
    @NotBlank
    @Pattern(regexp = "^\\d{1,20}$")
    private String recipientTgId;
    
    @Size(max = 500)
    private String secretQuestion;
}

// dto/request/AcceptRequestDto.java
@Data
public class AcceptRequestDto {
    @NotBlank
    private String sessionId;
    
    @Size(max = 500)
    private String secretAnswer;
}

// dto/request/PublicKeyDto.java
@Data
public class PublicKeyDto {
    @NotBlank
    private String sessionId;
    
    @NotBlank
    @Size(min = 80, max = 100) // Base64 of 65 bytes
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$")
    private String publicKey;
}

// dto/request/SendMessageRequest.java
@Data
public class SendMessageRequest {
    @NotBlank
    private String sessionId;
    
    @NotNull
    @Valid
    private EncryptedMessageDto message;
}

// dto/request/EncryptedMessageDto.java
@Data
public class EncryptedMessageDto {
    @NotBlank
    @Pattern(regexp = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    private String id;
    
    @NotBlank
    @Size(min = 16, max = 24)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$")
    private String iv;
    
    @NotBlank
    @Size(max = 8000)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$")
    private String ciphertext;
    
    @NotBlank
    @Size(min = 22, max = 24)
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$")
    private String tag;
    
    @NotNull
    @Positive
    private Long timestamp;
    
    @NotBlank
    @Pattern(regexp = "^text$")
    private String type;
}

// dto/request/BurnSessionDto.java
@Data
public class BurnSessionDto {
    @NotBlank
    private String sessionId;
}

// dto/request/ConfirmVerificationDto.java
@Data
public class ConfirmVerificationDto {
    @NotBlank
    private String sessionId;
    
    private boolean confirmed;
}
```

---

### Response/Event DTOs

```java
// dto/response/SearchResultEvent.java
@Data
@AllArgsConstructor
public class SearchResultEvent {
    private boolean found;
    private PeerInfo user;
    private String error;
    
    public static SearchResultEvent found(PeerInfo user) {
        return new SearchResultEvent(true, user, null);
    }
    
    public static SearchResultEvent notFound() {
        return new SearchResultEvent(false, null, null);
    }
    
    public static SearchResultEvent error(String message) {
        return new SearchResultEvent(false, null, message);
    }
}

// dto/response/SessionCreatedEvent.java
@Data
@AllArgsConstructor
public class SessionCreatedEvent {
    private String sessionId;
    private String status;
}

// dto/response/SessionStartedEvent.java
@Data
@AllArgsConstructor
public class SessionStartedEvent {
    private String sessionId;
    private PeerInfo peer;
}

// dto/response/IncomingRequestEvent.java
@Data
@AllArgsConstructor
public class IncomingRequestEvent {
    private String sessionId;
    private PeerInfo sender;
    private boolean hasSecretQuestion;
    private String secretQuestion;
    private Long expiresAt;
}

// dto/response/PeerPublicKeyEvent.java
@Data
@AllArgsConstructor
public class PeerPublicKeyEvent {
    private String sessionId;
    private String publicKey;
}

// dto/response/NewMessageEvent.java
@Data
@AllArgsConstructor
public class NewMessageEvent {
    private String sessionId;
    private EncryptedMessage message;
}

// dto/response/MessageSentEvent.java
@Data
@AllArgsConstructor
public class MessageSentEvent {
    private String messageId;
    private boolean delivered;
}

// dto/response/SessionBurnedEvent.java
@Data
@AllArgsConstructor
public class SessionBurnedEvent {
    private String sessionId;
    private String burnedBy;
}

// dto/response/VerificationStatusEvent.java
@Data
@AllArgsConstructor
public class VerificationStatusEvent {
    private String sessionId;
    private boolean bothConfirmed;
    private boolean peerConfirmed;
}

// dto/response/ErrorEvent.java
@Data
@AllArgsConstructor
public class ErrorEvent {
    private String code;
    private String message;
    private Object details;
    
    public ErrorEvent(ErrorCode code, String message) {
        this.code = code.name();
        this.message = message;
        this.details = null;
    }
}
```

---

### Error Codes

```java
// model/enums/ErrorCode.java
public enum ErrorCode {
    // General
    UNAUTHORIZED,
    FORBIDDEN,
    NOT_FOUND,
    RATE_LIMITED,
    INTERNAL_ERROR,
    
    // Session
    SESSION_NOT_FOUND,
    SESSION_FULL,
    SESSION_EXPIRED,
    SESSION_BURNED,
    NOT_PARTICIPANT,
    
    // User
    USER_NOT_FOUND,
    USER_BLOCKED,
    SELF_CHAT,
    
    // Message
    MESSAGE_TOO_LARGE,
    INVALID_FORMAT,
    FILE_TOO_LARGE
}
```

---

## TypeScript Interfaces

### Frontend Types

```typescript
// === CRYPTO ===

interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

interface ExportedKeyPair {
  publicKey: string;   // Base64 raw
  privateKey: string;  // Base64 pkcs8
}

// === MESSAGES ===

interface EncryptedMessage {
  id: string;
  iv: string;           // Base64, 12 bytes
  ciphertext: string;   // Base64
  tag: string;          // Base64, 16 bytes
  timestamp: number;
  type: 'text';
}

interface DecryptedMessage {
  id: string;
  text: string;
  timestamp: number;
  sender: 'self' | 'peer';
}

interface EncryptedFile {
  id: string;
  fileName: string;     // Encrypted Base64
  mimeType: string;
  size: number;
  chunks: EncryptedChunk[];
  timestamp: number;
}

interface EncryptedChunk {
  index: number;
  iv: string;
  data: string;
}

interface DecryptedFile {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  blob: Blob;
  timestamp: number;
  sender: 'self' | 'peer';
}

// === SESSION ===

interface Session {
  id: string;
  peer: PeerInfo;
  status: SessionStatus;
  verified: VerificationStatus;
  createdAt: number;
}

type SessionStatus = 
  | 'waiting'      // Ждём ответа на запрос
  | 'connecting'   // Peer присоединился, идёт handshake
  | 'active'       // Ключи установлены, можно общаться
  | 'burned';      // Сессия уничтожена

interface VerificationStatus {
  self: boolean;
  peer: boolean;
}

interface PeerInfo {
  tgId: string;
  username?: string;
  firstName: string;
  lastName?: string;
  photoUrl?: string;
}

// === VISUAL FINGERPRINT ===

type Shape = '◆' | '○' | '□' | '△' | '⬡' | '⬢';
type Color = 'red' | 'blue' | 'green' | 'purple' | 'orange' | 'cyan';

interface FingerprintElement {
  shape: Shape;
  color: Color;
}

type VisualFingerprint = [
  FingerprintElement,
  FingerprintElement,
  FingerprintElement,
  FingerprintElement
];

// === CHAT REQUEST ===

interface IncomingRequest {
  sessionId: string;
  sender: PeerInfo;
  hasQuestion: boolean;
  question?: string;
  expiresAt: number;
}

// === UI STATE ===

interface ChatState {
  session: Session | null;
  messages: DecryptedMessage[];
  files: DecryptedFile[];
  isTyping: boolean;
  connectionStatus: ConnectionStatus;
}

type ConnectionStatus = 
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

// === TELEGRAM ===

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

// === STOMP MESSAGES ===

interface StompMessage<T> {
  destination: string;
  body: T;
}

// Server → Client events
interface ServerEvents {
  '/user/queue/search-result': SearchResultEvent;
  '/user/queue/session-created': SessionCreatedEvent;
  '/user/queue/session-started': SessionStartedEvent;
  '/user/queue/incoming-request': IncomingRequestEvent;
  '/user/queue/peer-public-key': PeerPublicKeyEvent;
  '/user/queue/messages': NewMessageEvent;
  '/user/queue/message-sent': MessageSentEvent;
  '/user/queue/session-burned': SessionBurnedEvent;
  '/user/queue/verification-status': VerificationStatusEvent;
  '/user/queue/error': ErrorEvent;
}

interface SearchResultEvent {
  found: boolean;
  user?: PeerInfo;
  error?: string;
}

interface SessionCreatedEvent {
  sessionId: string;
  status: 'waiting';
}

interface SessionStartedEvent {
  sessionId: string;
  peer: PeerInfo;
}

interface IncomingRequestEvent {
  sessionId: string;
  sender: PeerInfo;
  hasSecretQuestion: boolean;
  secretQuestion?: string;
  expiresAt: number;
}

interface PeerPublicKeyEvent {
  sessionId: string;
  publicKey: string;
}

interface NewMessageEvent {
  sessionId: string;
  message: EncryptedMessage;
}

interface MessageSentEvent {
  messageId: string;
  delivered: boolean;
}

interface SessionBurnedEvent {
  sessionId: string;
  burnedBy: string;
}

interface VerificationStatusEvent {
  sessionId: string;
  bothConfirmed: boolean;
  peerConfirmed: boolean;
}

interface ErrorEvent {
  code: string;
  message: string;
  details?: unknown;
}
```

---

## Валидация данных

### Java Bean Validation

```java
// validation/ValidationConstants.java
public final class ValidationConstants {
    
    // Message limits
    public static final int MAX_TEXT_LENGTH = 4096;
    public static final long MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
    public static final int MAX_FILE_NAME_LENGTH = 255;
    public static final int MAX_CHUNKS = 500; // 25MB / 64KB
    
    // Crypto sizes
    public static final int IV_LENGTH = 12;
    public static final int TAG_LENGTH = 16;
    public static final int PUBLIC_KEY_LENGTH = 65; // P-256 uncompressed
    
    // Base64 encoded sizes
    public static final int IV_BASE64_MIN = 16;
    public static final int IV_BASE64_MAX = 24;
    public static final int TAG_BASE64_MIN = 22;
    public static final int TAG_BASE64_MAX = 24;
    public static final int PUBLIC_KEY_BASE64_MIN = 80;
    public static final int PUBLIC_KEY_BASE64_MAX = 100;
    
    private ValidationConstants() {}
}
```

### Custom Validators

```java
// validation/Base64Validator.java
@Constraint(validatedBy = Base64Validator.Impl.class)
@Target({ElementType.FIELD})
@Retention(RetentionPolicy.RUNTIME)
public @interface Base64 {
    String message() default "Invalid Base64";
    int minBytes() default 0;
    int maxBytes() default Integer.MAX_VALUE;
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
    
    class Impl implements ConstraintValidator<Base64, String> {
        private int minBytes;
        private int maxBytes;
        
        @Override
        public void initialize(Base64 annotation) {
            this.minBytes = annotation.minBytes();
            this.maxBytes = annotation.maxBytes();
        }
        
        @Override
        public boolean isValid(String value, ConstraintValidatorContext ctx) {
            if (value == null || value.isEmpty()) {
                return false;
            }
            
            try {
                byte[] decoded = java.util.Base64.getDecoder().decode(value);
                return decoded.length >= minBytes && decoded.length <= maxBytes;
            } catch (IllegalArgumentException e) {
                return false;
            }
        }
    }
}
```

### Limits Summary

| Поле | Лимит | Причина |
|------|-------|---------|
| `text` | 4096 chars | Оптимально для чата |
| `file` | 25 MB | Telegram limit |
| `fileName` | 255 chars | Filesystem limit |
| `chunks` | 500 max | 25MB / 64KB |
| `sessionId` | UUID v4 | Collision resistance |
| `IV` | 12 bytes | AES-GCM standard |
| `tag` | 16 bytes | GCM auth tag |

---

## Redis Repository Examples

### Session Repository

```java
@Repository
@RequiredArgsConstructor
public class SessionRepository {
    
    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;
    
    private static final Duration SESSION_TTL = Duration.ofHours(1);
    
    public Mono<Session> findById(String sessionId) {
        return redisTemplate.opsForHash()
            .entries(keyFor(sessionId))
            .collectMap(
                entry -> entry.getKey().toString(),
                entry -> entry.getValue().toString()
            )
            .filter(map -> !map.isEmpty())
            .map(this::mapToSession);
    }
    
    public Mono<Boolean> save(Session session) {
        Map<String, String> hash = sessionToMap(session);
        String key = keyFor(session.getId());
        
        return redisTemplate.opsForHash()
            .putAll(key, hash)
            .then(redisTemplate.expire(key, SESSION_TTL));
    }
    
    public Mono<Boolean> updateVerification(String sessionId, String tgId, boolean verified) {
        String key = keyFor(sessionId);
        String field = "verified:" + tgId;
        
        return redisTemplate.opsForHash()
            .put(key, field, String.valueOf(verified));
    }
    
    public Mono<Long> delete(String sessionId) {
        return redisTemplate.delete(keyFor(sessionId));
    }
    
    private String keyFor(String sessionId) {
        return "session:" + sessionId;
    }
    
    private Session mapToSession(Map<String, String> hash) {
        return Session.builder()
            .id(hash.get("id"))
            .participants(List.of(
                hash.get("participant1"),
                hash.get("participant2")
            ))
            .status(SessionStatus.valueOf(hash.get("status")))
            .createdAt(Long.parseLong(hash.get("createdAt")))
            .hasSecretQuestion(Boolean.parseBoolean(hash.get("hasQuestion")))
            .verified(Map.of(
                hash.get("participant1"), Boolean.parseBoolean(hash.getOrDefault("verified:" + hash.get("participant1"), "false")),
                hash.get("participant2"), Boolean.parseBoolean(hash.getOrDefault("verified:" + hash.get("participant2"), "false"))
            ))
            .build();
    }
    
    private Map<String, String> sessionToMap(Session session) {
        Map<String, String> map = new HashMap<>();
        map.put("id", session.getId());
        map.put("participant1", session.getParticipants().get(0));
        map.put("participant2", session.getParticipants().get(1));
        map.put("status", session.getStatus().name());
        map.put("createdAt", String.valueOf(session.getCreatedAt()));
        map.put("hasQuestion", String.valueOf(session.isHasSecretQuestion()));
        return map;
    }
}
```

### Message Repository

```java
@Repository
@RequiredArgsConstructor
public class MessageRepository {
    
    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;
    
    private static final Duration MESSAGES_TTL = Duration.ofHours(24);
    
    public Mono<Long> save(String sessionId, EncryptedMessage message) {
        String key = keyFor(sessionId);
        
        return Mono.fromCallable(() -> objectMapper.writeValueAsString(message))
            .flatMap(json -> redisTemplate.opsForList().rightPush(key, json))
            .flatMap(size -> redisTemplate.expire(key, MESSAGES_TTL).thenReturn(size));
    }
    
    public Flux<EncryptedMessage> getMessages(String sessionId, String afterMessageId) {
        String key = keyFor(sessionId);
        
        return redisTemplate.opsForList()
            .range(key, 0, -1)
            .map(json -> {
                try {
                    return objectMapper.readValue(json, EncryptedMessage.class);
                } catch (JsonProcessingException e) {
                    throw new RuntimeException(e);
                }
            })
            .filter(msg -> afterMessageId == null || 
                           msg.getTimestamp() > findTimestamp(afterMessageId));
    }
    
    public Mono<Long> deleteAll(String sessionId) {
        return redisTemplate.delete(keyFor(sessionId));
    }
    
    private String keyFor(String sessionId) {
        return "messages:" + sessionId;
    }
}
```

---

## Связанные документы

- [API.md](./API.md) — WebSocket события
- [SECURITY.md](./SECURITY.md) — криптографические примитивы
- [ARCHITECTURE.md](./ARCHITECTURE.md) — общая архитектура

