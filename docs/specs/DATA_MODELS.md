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
│  session:{sessionId}          → Hash    │ TTL: 24h (конфиг)     │
│  request:{recipientInternalId}→ List    │ TTL: 5 minutes        │
│  messages:{internalId}:{sessionId} → List │ TTL: 24h (конфиг)   │
│  messages:count:{internalId}  → String  │ счётчик pending (DM)  │
│  online:{internalId}          → String  │ TTL: 30 seconds       │
│  user:{internalId}            → Hash    │ TTL: 90 days          │
│  auth_tg:{telegramId}         → String  │ TTL: 90 days          │
│  auth_wallet:{walletAddress}  → String  │ TTL: 90 days          │
│  rate:{type}:{internalId}     → String  │ TTL: varies           │
│  blocked:{tgId}               → Set     │ No TTL                │
│  file_meta:{fileId}           → Hash    │ TTL: 24h (Phase 4)    │
│  file_context:{contextId}     → Set     │ fileIds, TTL: 24h     │
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

**Соответствие коду (`SessionRepository` / `Session`):** фактический hash-ключ `session:{uuid}` хранит `id`, `initiatorId`, `responderId`, `status`, `createdAt`, `lastActivityAt`, при необходимости `secretQuestion` и `secretAnswerHash`. Поле `secretAnswerHash` — Base64(SHA-256) от **нормализованного ожидаемого ответа** инициатора (`trim`, затем `toLowerCase`, UTF-8); задаётся при создании заявки с секретным вопросом, открытый текст не сохраняется. Ответ получателя при accept хэшируется тем же алгоритмом и сравнивается с сохранённым значением (constant-time).

**TTL:** по умолчанию 24 часа (`session.active.ttl` в `application.yml`), автоочистка неактивных сессий.

---

### Offline message queue (DM)

Очередь зашифрованных сообщений для получателя, если он офлайн в момент доставки.

| Ключ | Тип | Описание |
|------|-----|----------|
| `messages:{recipientInternalId}:{sessionId}` | List | JSON сериализованных `Message` (E2EE blob), порядок FIFO |
| `messages:count:{recipientInternalId}` | String | Суммарный счётчик не доставленных сообщений по всем сессиям пользователя |

**TTL и cap:** задаются в `burnedchats.messages.offline-queue` (`ttl`, `max-size-per-session`). Значения не должны превышать TTL метаданных сессии (`session.active.ttl`). При переполнении список обрезается с головы (старые сообщения отбрасываются); сервер ведёт метрики Micrometer `burnedchats.offline_queue.*` (без идентификаторов пользователей в тегах).

---

### `request:{recipientInternalId}`

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

### `online:{internalId}`

Статус онлайн (heartbeat).

```redis
SET online:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33 "1704067200000"
EXPIRE online:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33 30
```

Клиент отправляет heartbeat каждые 20 секунд, TTL 30 секунд.

---

### `user:{internalId}`

Кеш информации о пользователе.

```redis
HSET user:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33
  internalId    "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33"
  authType      "TELEGRAM"
  displayName   "Alice"
  telegramId    "111222333"
  walletAddress ""
  avatarUrl     "https://..."
  createdAt     "1704000000000"

EXPIRE user:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33 7776000
```

**TTL:** 90 дней (обновляется при каждом входе)

### `auth_tg:{telegramId}` / `auth_wallet:{walletAddress}`

Маппинги внешней аутентификации на единый `internalId`:

```redis
SET auth_tg:111222333 "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33"
SET auth_wallet:EQ... "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33"
EXPIRE auth_tg:111222333 7776000
EXPIRE auth_wallet:EQ... 7776000
```

---

### `rate:{type}:{internalId}`

Rate limiting counters.

```redis
INCR rate:message:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33
EXPIRE rate:message:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33 60
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

### Phase 5: TON RPC cache (`TonService`)

Стабильные ответы `runGetMethod` / `getAddressInformation` кэшируются в Redis с ключами:

| Шаблон ключа | TTL | Назначение |
|--------------|-----|------------|
| `ton:rpc:{address}:{method}:{argsHash}` | `app.ton.cache.ttl-seconds` | Нормализованный адрес, имя get-метода, SHA-256 от JSON аргументов стека |

### Phase 5: Jetton (`JettonService`)

| Шаблон ключа | TTL | Значение |
|--------------|-----|----------|
| `ton:jetton:balance:v1:{workchain}:{hex}` | 30 с | `BigInteger` nano баланса BURN |
| `ton:jetton:info:v1:{workchain}:{hex}` | 1 ч | JSON `JettonInfo` мастера (`app.ton.addresses.jetton-master`) |
| `ton:jetton:fees:v1:{workchain}:{hex}` | 5 мин | JSON `EffectiveFeeParams` (`get_effective_fee_params`) |

Адрес в суффиксе ключа нормализуется в вид `workchain:hex` (см. `TonAddressBoc.normalizeKey`).

---

## Phase 2: Комнаты (Redis)

> Полный план: [DEVELOPMENT_PLAN_ROOMS.md](../phases/phase-2-rooms/DEVELOPMENT_PLAN_ROOMS.md). Ниже — целевые структуры ключей.

### `room:{roomId}`

Метаданные комнаты (владелец, производная пароля, режим входа).

```redis
HSET room:uuid-room-1
  ownerInternalId "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33"
  ownerTgId       "111222333"
  salt            "base64..."     # пустая строка, если комната без пароля (BY_REQUEST)
  passwordProofHash "base64..."   # пустая строка, если комната без пароля
  joinMode        "by_password"   # или "by_request"
  createdAt       "1704067200000"

EXPIRE room:uuid-room-1 2592000
```

| Поле | Тип | Описание |
|------|-----|----------|
| `ownerInternalId` | string | internalId владельца |
| `ownerTgId` | string | Telegram ID владельца (compat для текущих DTO) |
| `salt` | string | Salt для KDF (Base64). Пустая строка, если комната без пароля (BY_REQUEST) |
| `passwordProofHash` | string | Хеш proof. Пустая строка, если комната без пароля |
| `joinMode` | enum | `by_password` \| `by_request` |
| `createdAt` | number | Unix timestamp в мс |

**TTL:** 30 дней (продлевается при активности)

### `room_members:{roomId}`

Участники комнаты (Set internalId).

```redis
SADD room_members:uuid-room-1 "d2f44f7b-..." "f74f67a1-..."
```

Удаляется при BURN_ROOM.

### `invite:{token}`

Инвайт-токен для ссылки приглашения.

```redis
HSET invite:abc123token
  roomId      "uuid-room-1"
  createdBy   "111222333"
  expiresAt   "1704153600000"
  maxUses     "10"

EXPIRE invite:abc123token 604800
```

**TTL:** по expiresAt или 7 дней

### `room_join_request:{roomId}`

Заявки на вход в комнату (режим by_request).

```redis
LPUSH room_join_request:uuid-room-1 '{"senderTgId":"444555666","createdAt":1704067200000}'
EXPIRE room_join_request:uuid-room-1 86400
```

**TTL:** 24 часа

### `room_keys:{roomId}:{epoch}`

Зашифрованные копии группового ключа для участников (opaque blobs). Сервер не расшифровывает.

### `messages:{roomId}`

Очередь зашифрованных сообщений комнаты. Формат — `RoomMessage` (E2EE), с `senderTgId` в метаданных для отображения. Переполнение: `max-size-per-room` в `burnedchats.messages.offline-queue` (по умолчанию 500, trim с головы). **TTL:** тот же `burnedchats.messages.offline-queue.ttl` (по умолчанию 24 ч).

---

## Phase 4: Files (Redis)

> План: [DEVELOPMENT_PLAN_MEDIA.md](../phases/phase-4-media/DEVELOPMENT_PLAN_MEDIA.md). Реализация: `FileMetadataRepository`, `FileMetadata`.

### `file_meta:{fileId}`

Hash с метаданными **одного** загруженного зашифрованного blob'а (основной файл или thumbnail). `fileId` — UUID, совпадает с именем файла на диске без расширения (`{fileId}.enc`).

```redis
HSET file_meta:550e8400-e29b-41d4-a716-446655440000
  uploaderTgId   "123456789"
  contextType    "session"
  contextId      "session-uuid-or-room-uuid"
  size           "1048576"
  createdAt      "1705312200000"

EXPIRE file_meta:550e8400-e29b-41d4-a716-446655440000 86400
```

| Поле | Тип | Описание |
|------|-----|----------|
| `uploaderTgId` | string | Telegram ID пользователя, выполнившего upload |
| `contextType` | string | `session` или `room` |
| `contextId` | string | ID сессии или комнаты |
| `size` | long (строка) | Размер сохранённого **зашифрованного** blob'а в байтах |
| `createdAt` | long (строка) | Unix time (мс) |

**TTL:** по умолчанию 24 часа (`FileStorageProperties.metadataTtl`), синхронизирован с очисткой и burn cascade.

### `file_context:{contextId}`

**Set** из `fileId`, привязанных к одной сессии или комнате. Используется для каскадного удаления файлов при burn сессии/комнаты (`FileBurnService`): по списку `fileId` удаляются записи в `file_meta:*`, объекты на filesystem и члены множества.

**TTL:** продлевается при каждом добавлении файла (как у `file_meta`), чтобы индекс не переживал метаданные.

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

### File metadata (Java)

```java
// model/FileMetadata.java — см. репозиторий FileMetadataRepository (Redis Hash file_meta:{fileId})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FileMetadata {
    private String fileId;
    private String uploaderTgId;
    private String contextType;   // "session" | "room"
    private String contextId;
    private Long size;            // encrypted blob size in bytes
    private Long createdAt;       // epoch millis
}
```

### Message (1-to-1, очередь + STOMP)

Очередь offline и событие нового сообщения используют модель **`Message`** с файловыми полями для типов `image`, `video`, `file`:

```java
// model/Message.java (фрагмент)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Message implements Serializable {
    private String messageId;
    private String sessionId;
    private Long senderId;
    private Long recipientId;
    private String encryptedContent;
    private String iv;
    private Long clientTimestamp;
    private Instant serverTimestamp;
    @Builder.Default
    private String type = "text";
    private String fileId;
    private String thumbnailFileId;
    private String encryptedMeta;  // Base64 opaque: encryptFileMetadata на клиенте
    private Long fileSize;         // исходный размер файла (plaintext), байты
}
```

**Тип сообщения:** `text` \| `image` \| `video` \| `file`. Для не-text поле `fileId` обязательно (валидация `FileMessageValidator`).

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
    @NotNull
    @Positive
    private Long recipientId;

    @Size(max = 256)
    private String secretQuestion;

    /** Обязателен, если secretQuestion непустой после trim; max 256 */
    @Size(max = 256)
    private String secretExpectedAnswer;
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


// dto/request/SendMessageRequest.java — STOMP /app/message.send (см. API.md)
// Для type ∈ { image, video, file } обязателен fileId (@ValidFileMessage)
@Data
public class SendMessageRequest {
    @NotBlank private String sessionId;
    @NotBlank @Size(max = 64) private String messageId;
    @NotBlank @Size(max = 65536) private String encryptedContent;
    @NotBlank @Size(min = 16, max = 24) private String iv;
    @NotNull private Long timestamp;
    @Pattern(regexp = "^(text|image|video|file)$") private String type;
    @Size(max = 128) private String fileId;
    @Size(max = 128) private String thumbnailFileId;
    @Size(max = 4096) private String encryptedMeta;
    @Positive private Long fileSize;
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
    
    // Message / files
    MESSAGE_TOO_LARGE,
    INVALID_FORMAT,
    FILE_TOO_LARGE,
    FILE_NOT_FOUND,
    ACCESS_DENIED
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
// См. frontend/src/types/index.ts и crypto/fileEncryption.ts

type MessageType = 'text' | 'image' | 'video' | 'file';

type MessageStatus =
  | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Сообщение в UI / STOMP (фрагмент; полный тип — Message в index.ts) */
interface Message {
  id: string;
  sessionId: string;
  fromUserId: number;
  encryptedContent: string;
  iv: string;
  timestamp: number;
  status: MessageStatus;
  type: MessageType;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
}

interface DecryptedMessage extends Omit<Message, 'encryptedContent' | 'iv' | 'encryptedMeta'> {
  content: string;
  isOwn: boolean;
  senderName?: string;
}

/** Plaintext метаданные до encryptFileMetadata (fileEncryption.ts) */
interface FileMetaPlain {
  fileName: string;
  mimeType: string;
}

/** Расшифрованное медиасообщение */
interface DecryptedFileMessage extends DecryptedMessage {
  type: 'image' | 'video' | 'file';
  fileId: string;
  fileSize: number;
  fileMeta: { fileName: string; mimeType: string };
  thumbnailFileId?: string;
  thumbnailUrl?: string;
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
  messageId: string;
  senderId: number;
  encryptedContent: string;
  iv: string;
  clientTimestamp: number;
  type?: MessageType;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
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
// validation/ValidationConstants.java (фрагмент)
public final class ValidationConstants {

    /** Максимальный размер принимаемого зашифрованного blob'а (байты).
     *  Plaintext до ~25 MB + заголовок AES-GCM/chunked → потолок 26 MB. */
    public static final long MAX_ENCRYPTED_FILE_SIZE = 26 * 1024 * 1024;

    /** Лимит POST /api/files/upload на пользователя (см. RateLimitService.RateLimitType.FILE_UPLOAD). */
    public static final int FILE_UPLOAD_RATE_LIMIT = 10;

    // Message limits
    public static final int MAX_TEXT_LENGTH = 4096;
    public static final int MAX_FILE_NAME_LENGTH = 255;
    public static final int MAX_CHUNKS = 500; // legacy / client UX

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

| Поле / правило | Лимит | Причина |
|----------------|-------|---------|
| `text` | 4096 chars | Оптимально для чата |
| Зашифрованный blob upload | ≤ `MAX_ENCRYPTED_FILE_SIZE` (26 MB) | Потолок на сервере; plaintext и MIME — ориентиры продукта (см. SECURITY.md) |
| `POST /api/files/upload` | `FILE_UPLOAD_RATE_LIMIT` (10) / 1 min | Redis rate limit per user |
| `fileName` | 255 chars | Клиент + `encryptFileMetadata` |
| `sessionId` | UUID v4 | Collision resistance |
| `IV` | 12 bytes | AES-GCM standard |
| GCM `tag` | 16 bytes | Входит в ciphertext Web Crypto output |

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

