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

Все WebSocket соединения требуют один из двух режимов аутентификации в STOMP CONNECT:

- `telegram` (legacy/current): `X-Auth-Type: telegram` + `X-Telegram-Init-Data`
- `wallet`: `X-Auth-Type: wallet` + `X-Auth-Token` (opaque session token из `POST /api/auth/wallet`)

```typescript
// Frontend (telegram)
const client = new Client({
  connectHeaders: {
    'X-Auth-Type': 'telegram',
    'X-Telegram-Init-Data': window.Telegram.WebApp.initData
  }
});

// Frontend (wallet)
const walletClient = new Client({
  connectHeaders: {
    'X-Auth-Type': 'wallet',
    'X-Auth-Token': '<session-token>'
  }
});
```

```java
// Backend - StompAuthInterceptor.java
String authType = accessor.getFirstNativeHeader("X-Auth-Type");
String token = accessor.getFirstNativeHeader("X-Auth-Token");
```

Совместимость: backend также принимает legacy-имена заголовков `auth-type` / `auth-token`.

### Rate Limits

| Эндпоинт/событие | Лимит | Окно |
|------------------|-------|------|
| REST endpoints | 100 req | 1 min |
| `POST /api/files/upload` | 10 req | 1 min |
| `SEARCH_USER` | 10 req | 1 min |
| `SEND_MESSAGE` | 30 msg | 1 min |
| `CREATE_SESSION` | 3 req | 5 min |

### REST (файлы): аутентификация

Эндпоинты файлов передают Telegram Mini App initData в заголовке (как при STOMP CONNECT):

```http
X-Telegram-Init-Data: <query string from Telegram.WebApp.initData>
```

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

### Wallet auth (Phase 3): nonce для Ton Connect

#### `GET /api/auth/nonce`

Выдаёт короткоживущую непрозрачную строку для поля Ton Connect `tonProof` в запросе подключения (`ConnectAdditionalRequest.tonProof`). Кошелёк возвращает подписанный `ton_proof`; backend сверяет подпись с этим nonce (защита от replay).

**Response `200 OK`:**

```json
{
  "nonce": "<opaque server-generated string>"
}
```

Клиент также принимает поле `payload` как синоним `nonce` для обратной совместимости.

**Примечания:**

- Требования к авторизации запроса (публичный эндпоинт vs привязка к сессии) задаёт реализация backend; рекомендуется rate limiting.
- Базовый URL тот же, что в разделе [Base URL](#base-url); во frontend dev без `VITE_API_URL` используется относительный путь `/api/auth/nonce` (прокси Vite).

#### `POST /api/auth/wallet`

Проверяет TON `walletProof` (формат: сериализованный `ton_proof` JSON из Ton Connect) и выдаёт opaque session token для STOMP.

**Request body:**

```json
{
  "walletAddress": "EQBx7...",
  "walletProof": "{\"address\":\"EQBx7...\",\"proof\":{\"timestamp\":1679312400,\"domain\":{\"value\":\"burnedchats.net\",\"lengthBytes\":16},\"signature\":\"base64...\",\"payload\":\"nonce\"}}",
  "walletPublicKey": "0a1b2c3...",
  "walletStateInit": "te6cckEC..."
}
```

`walletPublicKey` (hex, 32 bytes) и `walletStateInit` (base64 BoC) **опциональны**, но должны передаваться **парой**.
Если оба присутствуют, backend верифицирует `publicKey ↔ stateInit ↔ address` локально (без RPC к toncenter).
Если отсутствуют — используется legacy fallback через toncenter (см. `BURNEDCHATS_TON_API_KEY`).

**Response `200 OK`:**

```json
{
  "token": "opaque-session-token",
  "user": {
    "internalId": "uuid",
    "displayName": "EQBx...7JfP"
  }
}
```

**Ошибки:**

Тело ошибки (JSON):

```json
{
  "error": "Unauthorized",
  "code": "DOMAIN_MISMATCH",
  "message": "TON proof domain mismatch (expected: burnedchats.net, got: www.burnedchats.net)"
}
```

Поле `code` — машиночитаемая причина (`WalletProofException.Reason.name()`). Поле `error` сохранено для обратной совместимости.

| HTTP | `code` (примеры) | Когда |
|------|------------------|-------|
| `400` | `INVALID_REQUEST`, `ADDRESS_INVALID` | Пустой/битый body, невалидный адрес или JSON proof |
| `401` | `PROOF_EXPIRED`, `DOMAIN_MISMATCH`, `NONCE_UNKNOWN`, `SIGNATURE_INVALID`, … | Клиентская ошибка proof (см. полный список в backend `WalletProofException.Reason`) |
| `502` | `PUBLIC_KEY_UNAVAILABLE` | toncenter недоступен / не вернул `public_key` (transient; retry имеет смысл) |
| `500` | `INTERNAL` | Неожиданная ошибка backend |

Полный список `code` → HTTP:

| `code` | HTTP |
|--------|------|
| `INVALID_REQUEST` | 400 |
| `ADDRESS_INVALID` | 400 |
| `PROOF_TIMESTAMP_FUTURE` | 401 |
| `PROOF_EXPIRED` | 401 |
| `DOMAIN_MISMATCH` | 401 |
| `DOMAIN_LENGTH_MISMATCH` | 401 |
| `NONCE_MISSING` | 401 |
| `NONCE_UNKNOWN` | 401 |
| `SIGNATURE_INVALID` | 401 |
| `PUBLIC_KEY_UNAVAILABLE` | 502 |
| `INTERNAL` | 500 |

- `500 Internal Server Error` — внутренняя ошибка при выдаче token (`INTERNAL` или необработанное исключение).

---

### Account linking (Phase 3): Telegram ↔ TON wallet

Все эндпоинты ниже **не** требуют Spring Security cookie: доверие строится на валидном `initData` (Telegram) и/или проверенном `walletProof` / opaque `sessionToken`.

#### `POST /api/auth/link-wallet`

Привязка кошелька к пользователю, вошедшему через Mini App.

**Request body:**

```json
{
  "initData": "...",
  "walletAddress": "EQBx7...",
  "walletProof": "{... Ton Connect ton_proof JSON ...}"
}
```

**Ответ `200 OK`:** объект в форме «linked accounts» (см. `POST /api/auth/linked-accounts`).

**Ошибки:** `400` — невалидное тело; `401` — initData / proof; `409` — кошелёк или другой кошелёк уже привязан к другому аккаунту / нужно сначала отвязать; `500` — внутренняя ошибка.

**Failure body (пример):**

```json
{
  "error": "Unauthorized",
  "code": "SIGNATURE_INVALID",
  "message": "TON proof signature verification failed"
}
```

| `code` | HTTP | Описание |
|--------|------|----------|
| `SIGNATURE_INVALID`, `PROOF_EXPIRED`, `NONCE_UNKNOWN`, … | 401 | Отклонён `ton_proof` (те же коды, что у `POST /api/auth/wallet`) |
| `CONFLICT` | 409 | Кошелёк уже привязан к другому аккаунту или у пользователя другой кошелёк |
| `INTERNAL` | 500 | Необработанная ошибка сервера / Redis |

#### `POST /api/auth/link-telegram/challenge`

Для **wallet-only** сессии (opaque token после `POST /api/auth/wallet`): создаёт одноразовый challenge в Redis (TTL ~15 мин).

**Request body:** `{ "sessionToken": "<opaque>" }`

**Response `200 OK`:** `{ "ok": true, "challengeId": "<32 hex>", "telegramLink": "https://t.me/<bot>?startapp=lt_<challengeId>" }`  
Поле `telegramLink` может отсутствовать, если в конфиге не задан `telegram.bot.username`.

#### `POST /api/auth/link-telegram/complete`

Завершение привязки Telegram из Mini App: `start_param` имеет вид `lt_<challengeId>`.

**Request body:** `{ "challengeId": "<32 hex>", "initData": "..." }`

**Ответ `200 OK`:** как у `linked-accounts`.

**Ошибки:** `401` — просроченный challenge / невалидный initData; `409` — Telegram уже привязан к другому internalId.

#### `POST /api/auth/linked-accounts`

Снимок привязок для текущего пользователя. Ровно одно из полей:

```json
{ "initData": "...", "sessionToken": null }
```

или

```json
{ "initData": null, "sessionToken": "..." }
```

**Response `200 OK` (пример):**

```json
{
  "ok": true,
  "internalId": "...",
  "authType": "TELEGRAM",
  "displayName": "...",
  "telegramLinked": true,
  "telegramId": 123456789,
  "telegramLabel": "@username",
  "walletLinked": true,
  "walletAddress": "0:...",
  "linkedMethodCount": 2
}
```

#### `POST /api/auth/unlink-wallet`

Тело: `{ "initData": "..." }`. Отвязывает кошелёк, если остаётся привязанный Telegram (`400`, если это единственный способ входа).

#### `POST /api/auth/unlink-telegram`

Тело: `{ "sessionToken": "..." }`. Отвязывает Telegram, если остаётся кошелёк.

---

### REST API: Files (Phase 4)

Загрузка и скачивание **зашифрованных на клиенте** blob'ов. Тело запроса/ответа — сырая бинарная последовательность (`application/octet-stream`), не JSON.

#### `POST /api/files/upload`

Сохраняет один зашифрованный файл (основной медиафайл или thumbnail) и создаёт метаданные в Redis (`file_meta:{fileId}`, TTL 24 ч).

**Headers:**

| Заголовок | Обязательно | Описание |
|-----------|-------------|----------|
| `X-Telegram-Init-Data` | Да | Валидный initData (как в STOMP) |
| `X-Context-Type` | Да | `session` \| `room` |
| `X-Context-Id` | Да | UUID сессии или комнаты |
| `Content-Type` | Да | `application/octet-stream` |
| `Content-Length` | Да | Размер загружаемого **зашифрованного** blob'а в байтах (≥ 1) |

**Body:** поток байт зашифрованных данных (см. [SECURITY.md](./SECURITY.md) — формат blob'а на клиенте).

**Response `200 OK`:**

```json
{
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "size": 1048576
}
```

**Errors (JSON body, кроме 429 где указано):**

| HTTP | Поле `error` | Когда |
|------|--------------|--------|
| 401 | `UNAUTHORIZED` / код из `AuthenticationException` | Невалидный или просроченный initData |
| 400 | `INVALID_CONTEXT_TYPE` | `X-Context-Type` не `session` и не `room` |
| 400 | `FILE_SIZE_INVALID` | Несоответствие размера на диске и `Content-Length` после загрузки |
| 403 | `ACCESS_DENIED` | Пользователь не участник сессии / не член комнаты |
| 404 | `CONTEXT_NOT_FOUND` | Сессия не найдена (для `session`) |
| 413 | `FILE_TOO_LARGE` | Размер вне допустимого диапазона (см. `ValidationConstants.MAX_ENCRYPTED_FILE_SIZE`) |
| 429 | `RATE_LIMITED` | Превышен лимит загрузок; возможны заголовки `Retry-After` и поле `retryAfter` в JSON |

Пример тела при 429:

```json
{
  "error": "RATE_LIMITED",
  "message": "...",
  "retryAfter": 45
}
```

#### `GET /api/files/{fileId}`

Возвращает **тот же** зашифрованный blob, если вызывающий — участник контекста (session/room), к которому привязан файл.

**Headers:**

| Заголовок | Обязательно | Описание |
|-----------|-------------|----------|
| `X-Telegram-Init-Data` | Да | Валидный initData |

**Response `200 OK`:**

- `Content-Type: application/octet-stream`
- `Cache-Control: no-store`
- Тело: байты зашифрованного файла

**Errors (JSON):**

| HTTP | Поле `error` | Когда |
|------|--------------|--------|
| 401 | — | Невалидная аутентификация |
| 403 | `ACCESS_DENIED` | Нет прав на контекст файла |
| 404 | `FILE_NOT_FOUND` | Нет метаданных, истёк TTL, или файл отсутствует на диске |

> Семантика «нет доступа к файлу» в обсуждениях иногда обозначается как `FILE_ACCESS_DENIED`; в JSON ответов REST используется код **`ACCESS_DENIED`**.

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

### Phase 5: BURN jetton / staking / governance (backend read services)

Публичные **read-only** GET для governance Mini App (кэш + TON RPC через `GovernanceVerifier`):

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/governance/active-proposals` | `Flux<ProposalSummary>` — предложения в состоянии `ACTIVE` |
| `GET` | `/api/governance/recent-proposals?limit=` | Последние N предложений по id (убывание) |
| `GET` | `/api/governance/proposals/{id}` | `ProposalDetail` (summary + декодированный payload + кворум / порог bps) |
| `GET` | `/api/governance/proposals/{proposalId}/vote?address=` | `UserVote` или **404**, если пользователь не голосовал |
| `GET` | `/api/governance/voting-power?address=` | `{ "votingPower": "<bigint string>" }` — VP через `StakingVerifier` |

Тела соответствуют `dev.burnedchats.ton.dto.*` (`ProposalSummary`, `ProposalDetail`, `UserVote`). Перечисления Jackson сериализует как строки (`PARAMETER_CHANGE`, …).

Публичные **read-only** GET для on-chain данных кошелька (кэш + TON RPC через **`JettonService`**):

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/wallet/burn-balance?address=` | BURN jetton balance в nano; без auth |

**`GET /api/wallet/burn-balance`**

- Query `address` (обязателен): friendly (`EQ…` / `0Q…`) или raw TON address.
- **200 OK:** `{ "balanceNano": "<decimal string>", "address": "<trimmed query address>" }` — `balanceNano` из `BigInteger`, не JSON number.
- **400:** `{ "message": "…" }` — отсутствует/пустой `address` или невалидный формат.
- **502:** `{ "message": "…" }` — сбой Ton Center / contract read (`TonRpcException`).

Frontend (`burnToken.ts`) принимает поля `balanceNano`, `nano` или `balance` в теле; при `404`/`501` уходит на Ton Center RPC из браузера.

Чтение staking on-chain по-прежнему внутри **`StakingVerifier`**; отдельной HTTP-обёртки для стейкинга может не быть (см. `backend/.../ton/dto`).

---

## WebSocket API (STOMP)

### User destinations и идентификатор получателя (backend)

Подписки вида `/user/queue/...` маршрутизируются Spring по **имени принципала** STOMP-сессии. После миграции идентичности это имя — **`UnifiedUser.internalId()`** (UUID-строка), то же значение, что возвращает `Principal#getName()` для `TelegramPrincipal` / `WalletPrincipal`. **Нельзя** передавать в `SimpMessagingTemplate#convertAndSendToUser` первым аргументом числовой Telegram ID или `String.valueOf(telegramId)` — сообщение не дойдёт до клиента. Серверная отправка на персональные очереди должна использовать **`internalId`** (в т.ч. через компонент `StompUserMessenger`).

### Подключение

```typescript
// Frontend - STOMP Client
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const client = new Client({
  webSocketFactory: () => new SockJS('https://api.burnedchats.com/ws'),
  connectHeaders: {
    'X-Auth-Type': 'telegram',
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
│    │  (X-Auth-Type + auth header)       │                    │
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

### `CREATE_SESSION` (`/app/session.create`)

Создание нового чата и отправка запроса собеседнику.

**Нормализация секретного ответа** (инициатор и получатель должны совпадать по смыслу): `trim` → `toLowerCase()` на строке → UTF-8 → SHA-256 → Base64 (см. `SecretAnswerHasher` на сервере).

**Frontend:**
```typescript
client.publish({
  destination: '/app/session.create',
  body: JSON.stringify({
    recipientId: 444555666,
    secretQuestion: 'Как звали моего кота?', // опционально; если задан — нужен secretExpectedAnswer
    secretExpectedAnswer: 'Барсик' // обязателен, если secretQuestion непустой; не логировать
  })
});

// Результат — `/user/queue/session-created` (SessionCreatedEvent)
client.subscribe('/user/queue/session-created', (message) => {
  const data = JSON.parse(message.body);
  // success, sessionId, recipient, hasSecretQuestion, createdAt, expiresAt | error
});

// Коды ошибок создания (поле error при success: false), в т.ч.:
// EXPECTED_ANSWER_REQUIRED — вопрос задан без ожидаемого ответа или пустой ответ
// EXPECTED_ANSWER_TOO_LONG — ответ длиннее 256 символов
```

**Backend:** `SessionHandler` — `@MessageMapping("/session.create")`, ответы на `/user/queue/session-created` (`SessionCreatedEvent`).

---

### `ACCEPT_REQUEST` (`/app/session.accept`)

Принятие входящего запроса на чат.

**Frontend:**
```typescript
client.publish({
  destination: '/app/session.accept',
  body: JSON.stringify({
    sessionId: 'abc123',
    secretAnswer: 'Барсик' // если был секретный вопрос; нормализация та же, что при создании
  })
});

// Оба участника получают успех на `/user/queue/session-accepted`
client.subscribe('/user/queue/session-accepted', (message) => {
  const data = JSON.parse(message.body);
  // success, sessionId, peer, acceptedAt, expiresAt | error
});

// Ошибки принятия (только получатель), в т.ч. WRONG_ANSWER — ответ не совпал с ожидаемым хэшем
```

**Backend:** `SessionHandler` — `@MessageMapping("/session.accept")`, событие `SessionAcceptedEvent`.

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

### `SEND_MESSAGE` (`/app/message.send`)

Отправка зашифрованного сообщения (текст или файл: изображение, видео, документ).

**Текстовое сообщение (Frontend):**
```typescript
client.publish({
  destination: '/app/message.send',
  body: JSON.stringify({
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    messageId: 'client-generated-id',
    encryptedContent: 'base64...', // AES-GCM ciphertext (текст)
    iv: 'base64...',
    timestamp: Date.now(),
    type: 'text'
  })
});
```

**Файловое сообщение** — после `POST /api/files/upload` для основного blob'а и при необходимости для thumbnail клиент передаёт `fileId` и опционально `thumbnailFileId`, а также зашифрованные метаданные и размер **исходного** файла:

```typescript
// type: "image" | "video" | "file"
client.publish({
  destination: '/app/message.send',
  body: JSON.stringify({
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    messageId: 'client-generated-id',
    encryptedContent: 'base64...', // опциональная подпись к медиа; может быть пустой заглушкой
    iv: 'base64...',
    timestamp: Date.now(),
    type: 'image',
    fileId: 'uuid-of-main-upload',
    thumbnailFileId: 'uuid-of-thumb-upload', // опционально
    encryptedMeta: 'base64...', // см. encryptFileMetadata: { fileName, mimeType }
    fileSize: 1048576
  })
});
```

Сервер перед ретрансляцией проверяет, что `fileId` (и `thumbnailFileId`, если есть) существуют в `file_meta:*`, загружены отправителем и привязаны к той же `sessionId`. При ошибке валидации возможны коды: `FILE_NOT_FOUND`, `FILE_NOT_OWNED`, `FILE_CONTEXT_MISMATCH`.

**События:**

- Получатель: `/user/queue/new-message` — тело в формате `NewMessageEvent` (включая `type`, `fileId`, `thumbnailFileId`, `encryptedMeta`, `fileSize` для медиа).
- Отправитель: `/user/queue/message-sent` — подтверждение доставки.

```typescript
client.subscribe('/user/queue/new-message', (message) => {
  const data = JSON.parse(message.body);
  // success, sessionId, messageId, senderId, encryptedContent, iv,
  // clientTimestamp, serverTimestamp, type, fileId?, thumbnailFileId?, encryptedMeta?, fileSize?
});
```

**Backend:** `MessageHandler` — `@MessageMapping("/message.send")`, см. `SendMessageRequest`, `NewMessageEvent`.

> Для **комнат** используется отдельный handler и `SendRoomMessageRequest` с теми же файловыми полями; destination см. в коде (`RoomMessageHandler`).

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

### `SYNC_MESSAGES` (`/app/message.sync`)

Запрос пропущенных DM-сообщений из Redis-очереди (reconnect, cold start, серверный push; см. offline sync). Тело: `SyncMessagesRequest` с полем `sessionId`.

**Frontend:**
```typescript
client.publish({
  destination: '/app/message.sync',
  body: JSON.stringify({
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
  })
});

// Результат: SyncMessagesEvent
client.subscribe('/user/queue/sync-messages', (message) => {
  const data = JSON.parse(message.body);
  // success, sessionId, error?, messages
});
```

**Backend:** `MessageHandler` — `@MessageMapping("/message.sync")`, `SyncMessagesRequest`, `SyncMessagesEvent` на `/user/queue/sync-messages`, после отправки — удаление ключа `messages:{userId}:{sessionId}`. Параметры списка: `burnedchats.messages.offline-queue` (см. `DATA_MODELS.md`).

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

### Полезная нагрузка сообщения (STOMP / offline queue)

В протоколе используются **`SendMessageRequest`** (клиент → сервер) и **`Message`** / **`NewMessageEvent`** (сервер → клиент), а не отдельный класс с полями `ciphertext`/`tag`.

Общие поля:

| Поле | Описание |
|------|----------|
| `type` | `text` \| `image` \| `video` \| `file` |
| `encryptedContent`, `iv` | Зашифрованный текст или подпись к медиа (opaque Base64) |
| `messageId`, `timestamp` / `clientTimestamp` | Идемпотентность и порядок |

Для `image` / `video` / `file` дополнительно:

| Поле | Описание |
|------|----------|
| `fileId` | ID основного файла после `POST /api/files/upload` |
| `thumbnailFileId` | ID зашифрованного thumbnail (опционально) |
| `encryptedMeta` | Base64: зашифрованный JSON `{ fileName, mimeType }` |
| `fileSize` | Размер **исходного** файла в байтах (plaintext size) |

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

### Ошибки сообщений и файлов

| Код | Описание |
|-----|----------|
| `MESSAGE_TOO_LARGE` | Превышен лимит размера |
| `INVALID_FORMAT` | Неверный формат данных |
| `FILE_TOO_LARGE` | Зашифрованный blob превышает серверный потолок (`MAX_ENCRYPTED_FILE_SIZE`) |
| `FILE_NOT_FOUND` | Файл не найден в Redis или истёк TTL (REST download / валидация ретрансляции) |
| `ACCESS_DENIED` | Нет доступа к файлу или контексту (REST); в документации также: «file access denied» |
| `FILE_NOT_OWNED` | Отправитель не совпадает с `uploaderTgId` в метаданных файла |
| `FILE_CONTEXT_MISMATCH` | Файл привязан к другому session/room, чем сообщение |
| `CONTEXT_NOT_FOUND` | Сессия для загрузки не найдена |
| `FILE_SIZE_INVALID` | Размер после загрузки не совпал с `Content-Length` |
| `INVALID_CONTEXT_TYPE` | Неверный `X-Context-Type` |

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

## Комнаты (Phase 2 — P2-1)

### CREATE_ROOM

**Направление:** Client → Server  
**Destination:** `/app/room.create`

```json
{
  "salt": "base64... (optional when BY_REQUEST)",
  "passwordProof": "base64... (optional when BY_REQUEST)",
  "joinMode": "BY_PASSWORD | BY_REQUEST",
  "ownerPublicKey": "base64... (optional)",
  "nameEncrypted": "base64... (optional)"
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `salt` | string (Base64, 16–48 bytes) | При BY_PASSWORD | KDF salt, client-generated. При BY_REQUEST без пароля — не передавать |
| `passwordProof` | string (Base64, 32 bytes) | При BY_PASSWORD | PBKDF2 proof. При BY_REQUEST без пароля — не передавать |
| `joinMode` | enum | Да | `BY_PASSWORD` — вход сразу; `BY_REQUEST` — по одобрению (пароль опционален) |
| `ownerPublicKey` | string (Base64) | Нет | Публичный ключ владельца (ECDH) |
| `nameEncrypted` | string (Base64) | Нет | Зашифрованное имя комнаты |

---

### GET_INVITE_INFO / room-invite-info

**Запрос:** Client → Server, destination `/app/room.getInviteInfo`, body `{ "inviteToken": "string" }`.

**Ответ:** Server → Client, destination `/user/queue/room-invite-info`.

При успехе клиент получает `salt`, `joinMode` и **`hasPassword`** (boolean). Если `hasPassword === false`, комната без пароля (BY_REQUEST): на экране «Войти по ссылке» не показывать поле пароля, только кнопку «Отправить заявку».

---

### REQUEST_JOIN_ROOM

**Направление:** Client → Server  
**Destination:** `/app/room.requestJoin`

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `inviteToken` | string | Да | Токен из deep link |
| `passwordProof` | string (Base64) | Если у комнаты пароль | При комнате без пароля не передавать |
| `publicKey` | string (Base64) | Нет | Публичный ключ ECDH запрашивающего |

---

### ROOM_CREATED

**Направление:** Server → Client  
**Destination:** `/user/queue/room-created`

**Success:**
```json
{
  "success": true,
  "roomId": "uuid-v4"
}
```

**Error:**
```json
{
  "success": false,
  "error": "VALIDATION_ERROR | RATE_LIMITED | INTERNAL_ERROR"
}
```

---

## Связанные документы

- [DATA_MODELS.md](./DATA_MODELS.md) — структуры данных в Redis
- [SECURITY.md](./SECURITY.md) — криптография
- [ARCHITECTURE.md](./ARCHITECTURE.md) — общая архитектура

