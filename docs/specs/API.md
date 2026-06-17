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

Эндпоинты файлов поддерживают два режима (как STOMP CONNECT):

| Режим | Заголовки |
|-------|-----------|
| `telegram` (по умолчанию) | `X-Auth-Type: telegram` (необязательный) + `X-Telegram-Init-Data` |
| `wallet` | `X-Auth-Type: wallet` + `X-Auth-Token` (opaque session token из `POST /api/auth/wallet`) |

```http
# Telegram (legacy — без X-Auth-Type, только initData)
X-Telegram-Init-Data: <query string from Telegram.WebApp.initData>

# Wallet
X-Auth-Type: wallet
X-Auth-Token: <session-token>
```

Отсутствие или невалидные креды → **401**. Участник контекста проверяется по `internalId`
в обоих режимах.

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

#### `POST /api/auth/dev-login` (только dev-профиль)

> **В проде отсутствует.** Контроллер существует только под Spring-профилем
> `dev` И при `DEV_AUTH_ENABLED=true` (по умолчанию `false`). Прод работает на
> `prod,testnet` — эндпоинт возвращает 404. Назначение: автономная авторизация
> ИИ-агентов для UI-тестирования, см.
> [dev-auth-provider](../archive/improvements/dev-auth-provider/README.md).

Выдаёт обычный opaque session token для синтетической identity `dev-{label}`
без проверки `ton_proof`. Контракт ответа идентичен `POST /api/auth/wallet`.

**Request body:** `{ "label": "agent-a" }` — `label` соответствует `[a-z0-9-]{1,32}`.

**Response `200 OK`:** `{ "token": "<opaque>", "user": { "internalId": "<uuid>", "displayName": "dev-...nt-a" } }`

**Ошибки:** `400` — невалидный `label`; `404` — выключено флагом или прод-профиль; `500` — ошибка Redis.

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
| `X-Auth-Type` | Нет | `telegram` \| `wallet`; по умолчанию `telegram` |
| `X-Telegram-Init-Data` | Да* | Валидный initData (режим `telegram`) |
| `X-Auth-Token` | Да* | Opaque session token (режим `wallet`) |
| `X-Context-Type` | Да | `session` \| `room` |
| `X-Context-Id` | Да | UUID сессии или комнаты |
| `Content-Type` | Да | `application/octet-stream` |
| `Content-Length` | Да | Размер загружаемого **зашифрованного** blob'а в байтах (≥ 1) |

\* Один из режимов auth обязателен: для `telegram` — `X-Telegram-Init-Data`, для `wallet` — `X-Auth-Token`.

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
| 401 | `AUTH_ERROR` / код из `AuthenticationException` | Отсутствуют, невалидные или просроченные auth-креды (initData или session token) |
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
| `X-Auth-Type` | Нет | `telegram` \| `wallet`; по умолчанию `telegram` |
| `X-Telegram-Init-Data` | Да* | Валидный initData (режим `telegram`) |
| `X-Auth-Token` | Да* | Opaque session token (режим `wallet`) |

\* Один из режимов auth обязателен (см. upload).

**Response `200 OK`:**

- `Content-Type: application/octet-stream`
- `Cache-Control: no-store`
- Тело: байты зашифрованного файла

**Errors (JSON):**

| HTTP | Поле `error` | Когда |
|------|--------------|--------|
| 401 | `AUTH_ERROR` | Отсутствуют, невалидные или просроченные auth-креды |
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
| `GET` | `/api/wallet/jetton-wallet?address=` | BURN jetton wallet адрес владельца; без auth |
| `GET` | `/api/wallet/staking-profile?address=` | Staking-профиль кошелька (stakes, voting power); без auth |

**`GET /api/wallet/burn-balance`**

- Query `address` (обязателен): friendly (`EQ…` / `0Q…`) или raw TON address.
- **200 OK:** `{ "balanceNano": "<decimal string>", "address": "<trimmed query address>" }` — `balanceNano` из `BigInteger`, не JSON number.
- **400:** `{ "message": "…" }` — отсутствует/пустой `address` или невалидный формат.
- **502:** `{ "message": "…" }` — сбой Ton Center / contract read (`TonRpcException`).

Frontend (`burnToken.ts`) принимает поля `balanceNano`, `nano` или `balance` в теле; при `404`/`501` уходит на Ton Center RPC из браузера.

**`GET /api/wallet/jetton-wallet`**

- Query `address` (обязателен): friendly (`EQ…` / `0Q…`) или raw TON address владельца (owner).
- **200 OK:** `{ "jettonWalletAddress": "<friendly|null>", "ownerAddress": "<trimmed query address>" }` — `jettonWalletAddress` равен `null`, если jetton wallet отсутствует или не удалось вычислить адрес (non-zero contract exit / zero address); это **не** ошибка HTTP.
- **400:** `{ "message": "…" }` — отсутствует/пустой `address` или невалидный формат.
- **502:** `{ "message": "…" }` — сбой Ton Center / transport (`TonRpcException`).

Frontend (`burnToken.ts`) сначала вызывает этот endpoint; при `404`/`501`, `502` (после одного retry) или `jettonWalletAddress: null` переходит на Ton Center RPC из браузера (`jettonWalletResolve.ts`), сохраняя таксономию ошибок из `IMP-BURN-SEND-01`.

**`GET /api/wallet/staking-profile`**

- Query `address` (обязателен): friendly (`EQ…` / `0Q…`) или raw TON address владельца.
- **200 OK:** `UserStakingProfile` — `{ "address", "highestTier", "totalStakedNano", "votingPowerNano", "stakes": [ … ] }`.
  - `highestTier`: `"FLEXIBLE"` | `"SILVER"` | `"GOLD"` | `"DIAMOND"` | `null` (нет активных стейков).
  - `totalStakedNano`, `votingPowerNano`, `stakes[].amount`, `stakes[].pendingRewards` — decimal string или JSON number (парсятся фронтом через `bigIntFromJsonField`).
  - Каждый элемент `stakes[]`: `{ "tier", "amount", "startTime", "unlockTime", "lastClaimTime", "pendingRewards" }` — формат, который читает `mapBackendStake` в `staking.ts`.
- **400:** `{ "message": "…" }` — отсутствует/пустой `address` или невалидный формат.
- **502:** `{ "message": "…" }` — сбой Ton Center / contract read (`TonRpcException`).

Реализация: `WalletController` → `StakingVerifier.getStakingProfile` (Redis-кэш профиля, TTL 30 с). Frontend (`staking.ts` → `tryBackendStakes`) при `200` использует `stakes`; при `404`/`501` уходит на Ton Center RPC из браузера.

---

## WebSocket API (STOMP)

### User destinations и идентификатор получателя (backend)

Подписки вида `/user/queue/...` маршрутизируются Spring по **имени принципала** STOMP-сессии. После миграции идентичности это имя — **`UnifiedUser.internalId()`** (UUID-строка), то же значение, что возвращает `Principal#getName()` для `TelegramPrincipal` / `WalletPrincipal`. **Нельзя** передавать в `SimpMessagingTemplate#convertAndSendToUser` первым аргументом числовой Telegram ID или `String.valueOf(telegramId)` — сообщение не дойдёт до клиента. Серверная отправка на персональные очереди должна использовать **`internalId`** (в т.ч. через компонент `StompUserMessenger`).

### Единая идентичность (`internalId`)

> Реализация: improvement [wallet-only-identity](../archive/improvements/wallet-only-identity/README.md) (карточки IMP-WALLETID-02–06). Decision-логи: `docs/archive/improvements/wallet-only-identity/decisions/`.

**Канонический адресный идентификатор на проводе — `internalId` (UUID-строка).** Числовой Telegram ID (`Long`) остаётся опциональным полем для Telegram-linked пользователей и **не используется** для маршрутизации STOMP.

| Принципал | STOMP auth | `Principal#getName()` | `telegramId` |
|-----------|------------|----------------------|--------------|
| `TelegramPrincipal` | `X-Auth-Type: telegram` + initData | `internalId` | есть |
| `WalletPrincipal` | `X-Auth-Type: wallet` + session token | `internalId` (случайный UUID) | **нет** |

**Правила контрактов (additive vs break):**

| Область | Политика | Примечание |
|---------|----------|------------|
| Поиск, DM-сессии, join-flow | **Additive** — новые `*InternalId` + optional deprecated `*TgId` / `recipientId` | Старые Telegram-клиенты продолжают работать до миграции frontend |
| Групповые ключи (KEY_BUNDLE, REKEY) | **Break** — только `recipientInternalId` | Wallet-only члены не имеют TG ID |
| Room-сообщения | **Additive** — `senderInternalId` primary, `senderTgId` optional | Legacy Redis-записи читаются через `getSenderKey()` |

**Telegram-only деградация (best-effort, без ошибки для клиента):**

- Бот-уведомления offline DM / chat request — только при `telegramId != null`.
- File upload в комнатах — валидация по `uploaderTgId` (wallet file messages — вне scope миграции).

Хендлеры используют `AppPrincipal` / `internalId`; каст `(TelegramPrincipal)` в бизнес-логике **запрещён**.

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

### `SEARCH_USER` (`/app/search`)

Поиск пользователя для начала DM. Доступен **любому** аутентифицированному STOMP-принципалу (`TelegramPrincipal` или `WalletPrincipal`).

**Запрос** (`SearchRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `query` | string (1–64) | Да | Строка поиска — см. форматы ниже |

**Поддерживаемые форматы `query` (exact match):**

| Формат | Пример | Резолв |
|--------|--------|--------|
| `@username` | `@alice` | `UserRepository` (Telegram cache) |
| `username` | `alice` | то же (без `@`) |
| Numeric TG ID | `123456789` | `UserRepository` + `auth_tg:` → `internalId` |
| `internalId` (UUID) | `550e8400-e29b-41d4-a716-446655440000` | `UserIdentityRepository.findById` |
| Wallet address | `EQBx7...` / `UQ...` | `auth_wallet:` → `internalId` (normalized lowercase) |

Неподходящая строка → `INVALID_QUERY`. Частичный UUID / префикс wallet → **не** enumeration (см. [SECURITY.md](./SECURITY.md)).

**Ответ** — `/user/queue/search-result` (`SearchResultEvent`):

```json
{
  "found": true,
  "user": {
    "internalId": "550e8400-e29b-41d4-a716-446655440000",
    "id": 123456789,
    "username": "alice",
    "displayName": "Alice",
    "photoUrl": "https://...",
    "online": true,
    "premium": false
  }
}
```

| Поле `user` | Тип | Описание |
|-------------|-----|----------|
| `internalId` | string | **Primary** — передаётся в `session.create` как `recipientInternalId` |
| `id` | number \| null | Telegram numeric ID; `null` для wallet-only |
| `username` | string? | Telegram username (без `@`) |
| `displayName` | string | Имя для UI |
| `photoUrl` | string? | Аватар |
| `online` | boolean | Статус heartbeat |
| `premium` | boolean | Telegram Premium |

**Ошибки:** `NOT_FOUND`, `INVALID_QUERY`, `SELF_SEARCH`, `RATE_LIMITED`.

**Backend:** `SearchHandler` — `@MessageMapping("/search")`, доставка через `StompUserMessenger` по `internalId` инициатора поиска.

---

### `POW_CHALLENGE` (`/app/pow.challenge`)

Запрос PoW-challenge перед gated-действием (см. [DESIGN.md](../improvements/antispam-pow/DESIGN.md)). Маршрут **не** требует PoW (иначе «курица/яйцо»). **Rate-limit на issuance:** `RateLimitService.POW_CHALLENGE` — **10 запросов / мин / `internalId`**; при превышении → `/user/queue/errors` с `RATE_LIMIT_EXCEEDED` и `retryAfter` (секунды).

**Реализованный scope (2026-06-16):** backend **верифицирует** PoW только на `/app/session.create`; frontend решает PoW только для `session_create` (`useSession` / `ChatRequestDialog`). Wire-format `action` также принимает `search`, `room_create`, `invite` для выдачи challenge — enforcement на этих маршрутах **ещё не подключён** (задел IMP-ASPOW-04).

**Запрос** (`PowHandler.PowChallengeRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `action` | string | Да | Wire-format: `session_create`, `search`, `room_create`, `invite` (`PowAction`) |

```typescript
client.publish({
  destination: '/app/pow.challenge',
  body: JSON.stringify({ action: 'session_create' })
});
```

Неизвестный или пустой `action` → сервер **молча игнорирует** запрос (debug-log, без error event).

**Ответ** — `/user/queue/pow-challenge` (`PowChallengeEvent`):

| Поле | Тип | Описание |
|------|-----|----------|
| `challengeId` | string | 16 байт случайности, hex (32 символа) |
| `action` | string | Действие, к которому привязан challenge |
| `difficulty` | number | Целевое число ведущих нулевых **бит** (SHA-256 Hashcash) |
| `ttlMs` | number | TTL challenge в миллисекундах (из `pow.challenge-ttl`, default ~60000) |

Поле `issuedAt` хранится **только в Redis** (`pow:challenge:{id}`), в STOMP-событие **не** входит.

Сложность адаптивная (глобальный abuse-сигнал `pow:abuse:global`, DESIGN §5). Сервер хранит авторитетные `action`/`difficulty` только в Redis; клиентским значениям не доверяет. Выданная сложность cap'ится `pow.ceiling` (default 26).

**Backend:** `PowHandler` — `@MessageMapping("/pow.challenge")`. Доставка через `StompUserMessenger.convertAndSendToUser` → `/user/queue/pow-challenge`.

**`pow.enabled`:**

| Профиль | Значение | Поведение |
|---------|----------|-----------|
| default / `prod` / `prod,testnet` | `true` (`${POW_ENABLED:true}`) | Challenge с реальной difficulty; verify обязателен на gated-маршрутах |
| `dev`, `test` | `false` | Challenge с `difficulty: 0`; `PowVerificationService.verify` — no-op |

Prod/testnet **не** переопределяют `pow.enabled` в `application-prod.yml` / `application-testnet.yml`.

---

### `CREATE_SESSION` (`/app/session.create`)

Создание нового чата и отправка запроса собеседнику.

**Нормализация секретного ответа** (инициатор и получатель должны совпадать по смыслу): `trim` → `toLowerCase()` на строке → UTF-8 → SHA-256 → Base64 (см. `SecretAnswerHasher` на сервере).

**Запрос** (`CreateSessionRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `recipientInternalId` | string (UUID) | Да* | Primary address key из `UserResponse.internalId` поиска |
| `recipientId` | number | Нет (deprecated) | Legacy Telegram ID; резолвится в `internalId` через `auth_tg:` |
| `secretQuestion` | string (≤256) | Нет | Секретный вопрос |
| `secretExpectedAnswer` | string (≤256) | Если есть вопрос | Ожидаемый ответ; не логировать |
| `pow` | object | Если `pow.enabled=true` на gated-маршруте | Решение PoW: `{ challengeId, nonce }` (`PowSolution`) |

\* Обязателен один из `recipientInternalId` или `recipientId` (legacy). Новые клиенты передают только `recipientInternalId`.

**Порядок на сервере (DESIGN §6.2):** PoW verify → rate-limit `SESSION_CREATE` (3/min) → бизнес-логика.

```typescript
client.publish({
  destination: '/app/session.create',
  body: JSON.stringify({
    recipientInternalId: '550e8400-e29b-41d4-a716-446655440000',
    secretQuestion: 'Как звали моего кота?',
    secretExpectedAnswer: 'Барсик',
    pow: { challengeId: '00112233445566778899aabbccddeeff', nonce: '1373' }
  })
});
```

**Ответ инициатору** — `/user/queue/session-created` (`SessionCreatedEvent`).

**Уведомление получателю** — `/user/queue/incoming-request` (`IncomingRequestEvent`):

| Поле | Тип | Описание |
|------|-----|----------|
| `sessionId` | string | UUID сессии |
| `sender` | `UserResponse` | Профиль отправителя (вкл. `sender.internalId`) |
| `fromInternalId` | string | Дублирует `sender.internalId` для явного доступа |
| `hasSecretQuestion` | boolean | Есть ли секретный вопрос |
| `secretQuestion` | string? | Текст вопроса |
| `createdAt`, `expiresAt` | ISO-8601 | TTL запроса (5 мин) |

Очередь pending: Redis `request:{recipientInternalId}` (см. [DATA_MODELS.md](./DATA_MODELS.md)).

**Коды ошибок** (`success: false` на `/user/queue/session-created`): `USER_NOT_FOUND`, `SELF_CHAT`, `USER_BLOCKED`, `EXPECTED_ANSWER_REQUIRED`, `EXPECTED_ANSWER_TOO_LONG`, `RATE_LIMITED`.

**PoW / rate-limit ошибки** (на `/user/queue/errors`, `WebSocketExceptionHandler`):

Формат тела (`Map`):

| Поле | Тип | PoW / rate-limit |
|------|-----|------------------|
| `success` | boolean | всегда `false` |
| `error` | string | код ошибки |
| `message` | string | человекочитаемое сообщение |
| `timestamp` | string | ISO-8601 instant |
| `retryAfter` | number | только для `RATE_LIMIT_EXCEEDED` (секунды) |

| Код | Когда |
|-----|-------|
| `POW_REQUIRED` | Нет/пустой `pow`, challenge истёк или отсутствует в Redis |
| `POW_INVALID` | Неверный nonce, action mismatch, replay (`pow:spent` уже занят) |
| `RATE_LIMIT_EXCEEDED` | Превышен per-identity cap **после** валидного PoW |

**Backend:** `SessionHandler` — `@MessageMapping("/session.create")`. Доставка по `StompUserMessenger.convertAndSendToInternalId`. Telegram-бот offline — best-effort при `telegramId` получателя.

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

### UserResponse (поиск, incoming-request, session events)

```java
public class UserResponse {
    private String internalId;   // primary address key (always set)
    private Long id;             // Telegram ID; null for wallet-only
    private String username;
    private String displayName;
    private String photoUrl;
    private boolean online;
    private boolean premium;
}
```

### Session (Redis + handler logic)

Участники адресуются по **`initiatorInternalId` / `responderInternalId`**. Optional `initiatorTelegramId` / `responderTelegramId` — для отображения и Telegram-only веток.

```java
public class Session {
    private String id;
    private String initiatorInternalId;
    private Long initiatorTelegramId;   // null for wallet-only
    private String responderInternalId;
    private Long responderTelegramId;   // null for wallet-only
    private SessionStatus status;       // PENDING, HANDSHAKE, ACTIVE, BURNED
    // secretQuestion, secretAnswerHash, initiatorVerified, responderVerified, ...
    
    public boolean isParticipant(String internalId) { ... }
    public String getPeerInternalId(String myInternalId) { ... }
}
```

DM-доставка peer-событий (handshake, message, verify, burn): `StompUserMessenger.convertAndSendToInternalId(peerInternalId, ...)`. Numeric `senderId` / `peerId` в событиях — best-effort при наличии `telegramId`.

### PeerInfo / frontend peer display

Клиенты IMP-WALLETID-07+ используют `internalId` как primary peer key. Legacy `PeerInfo.tgId` / `fromUserId: number` deprecated на frontend.

---

## Коды ошибок

### Общие ошибки

| Код | HTTP | Описание |
|-----|------|----------|
| `UNAUTHORIZED` | 401 | Невалидный initData |
| `FORBIDDEN` | 403 | Нет доступа к ресурсу |
| `NOT_FOUND` | 404 | Ресурс не найден |
| `RATE_LIMITED` | 429 | Превышен лимит запросов |
| `POW_REQUIRED` | — | STOMP `/user/queue/errors`: нет/истёк PoW challenge на gated-действии |
| `POW_INVALID` | — | STOMP `/user/queue/errors`: неверное PoW-решение, action mismatch или replay |
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

**Событие владельцу** — `/user/queue/room-join-requests` (`RoomJoinRequestEvent`):

| Поле | Тип | Описание |
|------|-----|----------|
| `roomId` | string | UUID комнаты |
| `senderInternalId` | string | **Primary** — идентификатор заявителя |
| `senderTgId` | number? | Deprecated; `null` для wallet-only |
| `senderDisplayName` | string | Имя из каталога `user:{internalId}` |
| `senderUsername` | string? | Telegram username, если есть |
| `senderPublicKey` | string? | Base64 ECDH pubkey для KEY_BUNDLE |
| `requestedAt` | number | Unix ms |
| `autoApproved` | boolean | `true` при BY_PASSWORD без ожидания |

Redis: `room_join_request:{roomId}:{senderInternalId}` (см. [DATA_MODELS.md](./DATA_MODELS.md)).

---

### ACCEPT_ROOM_JOIN / REJECT_ROOM_JOIN

**Destinations:** `/app/room.acceptJoin`, `/app/room.rejectJoin`  
**Запрос** (`RoomJoinDecisionRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `senderInternalId` | string | Да* | Заявитель из `RoomJoinRequestEvent` |
| `senderTgId` | number | Нет (deprecated) | Legacy; резолвится в `senderInternalId` |

\* Только владелец (`ownerInternalId`). После accept владелец отправляет KEY_BUNDLE.

---

### SEND_KEY_BUNDLE (`/app/room.sendKeyBundle`)

Владелец передаёт зашифрованный групповой ключ новому члену.

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `recipientInternalId` | string | Да | **Break** — только internalId (не TG ID) |
| `epoch` | number | Да | Текущая эпоха ключа (0 для новой комнаты) |
| `ephemeralPublicKey` | string (Base64) | Да | Ephemeral ECDH P-256 |
| `encryptedKey` | string (Base64) | Да | AES-GCM ciphertext wrapped group key |
| `iv` | string (Base64) | Да | 12-byte GCM IV |

**Доставка** — `/user/queue/key-bundle` получателю по `recipientInternalId`.

---

### REKEY (`/app/room.rekey`)

Владелец ротирует групповой ключ после ухода члена.

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `newEpoch` | number | Да | `currentEpoch + 1` |
| `bundles` | array | Да | По одному bundle на оставшегося члена |
| `bundles[].recipientInternalId` | string | Да | Получатель bundle |
| `bundles[].ephemeralPublicKey` | string | Да | Base64 |
| `bundles[].encryptedKey` | string | Да | Base64 |
| `bundles[].iv` | string | Да | Base64 |

Каждый bundle доставляется на `/user/queue/key-bundle` соответствующему `recipientInternalId`.

---

### ROOM_MESSAGES (текст / медиа)

**Отправка:** `/app/room.message.send` (`SendRoomMessageRequest` — те же файловые поля, что у DM).

**Fan-out:** `/topic/room/{roomId}` — `NewRoomMessageEvent`:

| Поле | Тип | Описание |
|------|-----|----------|
| `senderInternalId` | string | **Primary** — canonical sender |
| `senderTgId` | number? | Deprecated; `null` для wallet-only |
| `senderName` | string? | Display name из каталога |
| `messageId`, `roomId`, `encryptedContent`, `iv` | — | Как у DM |
| `type`, `fileId`, … | — | Медиа-поля при `type != text` |

**Sync:** `/app/room.message.sync` → `/user/queue/sync-room-messages` (`SyncRoomMessagesEvent` с `senderInternalId`).

**Edit/delete:** события `RoomMessageEditedEvent`, `RoomMessageDeletedEvent` с `deletedByInternalId` (+ optional `deletedByTgId`).

Проверка членства: `roomMembersRepository.isMember(roomId, internalId)`.

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

