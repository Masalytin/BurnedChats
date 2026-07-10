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

**Auth выполняется на HTTP WebSocket handshake** (`StompHandshakeAuthInterceptor` +
`StompIdentityAuthService`), не в STOMP `CONNECT`. Клиент передаёт креды в
handshake headers (и дублирует в query-параметрах для SockJS). STOMP `CONNECT`
только подтверждает, что principal уже установлен (`StompAuthInterceptor`);
повторной Redis-аутентификации на `CONNECT` нет.

Режимы:

- `telegram` (по умолчанию, если `X-Auth-Type` отсутствует): `X-Telegram-Init-Data`
- `wallet`: `X-Auth-Type: wallet` + `X-Auth-Token` (opaque session token из `POST /api/auth/wallet`)

```typescript
// Frontend — auth на HTTP handshake (SockJS / raw WS), не в CONNECT-only
const client = new Client({
  webSocketFactory: () => new SockJS(
    // query-параметры нужны для SockJS (кастомные headers на handshake недоступны)
    `https://api.burnedchats.com/ws?X-Auth-Type=telegram&X-Telegram-Init-Data=${encodeURIComponent(initData)}`
  ),
  // connectHeaders опциональны для raw WebSocket; для SockJS креды уже в URL
  connectHeaders: {
    'X-Auth-Type': 'telegram',
    'X-Telegram-Init-Data': window.Telegram.WebApp.initData
  }
});

// Wallet
const walletClient = new Client({
  webSocketFactory: () => new SockJS(
    `https://api.burnedchats.com/ws?X-Auth-Type=wallet&X-Auth-Token=${encodeURIComponent(token)}`
  ),
  connectHeaders: {
    'X-Auth-Type': 'wallet',
    'X-Auth-Token': '<session-token>'
  }
});
```

Handshake без кредов допускается (соединение поднимается неаутентифицированным);
невалидные креды → handshake **отклоняется**. `Principal#getName()` =
`UnifiedUser.internalId()` (UUID), не Telegram numeric ID.

Совместимость: backend также принимает legacy-имена заголовков/query `auth-type` / `auth-token`.

### Rate Limits

| Эндпоинт/событие | Лимит | Окно | Примечание |
|------------------|-------|------|------------|
| REST `/api/auth/**` | 20 req | 1 min | `RestRateLimitInterceptor` (по IP / token) |
| REST `/api/wallet/**`, `/api/governance/**` | 60 req | 1 min | тот же интерцептор |
| REST `/api/files/**` | — | — | **вне** REST-интерцептора; upload — отдельный bucket |
| `POST /api/files/upload` | 10 req | 1 min | `FILE_UPLOAD` (`FileValidationService`) |
| `SEARCH_USER` (`/app/search`) | 10 req | 1 min | `SEARCH` |
| `SEND_MESSAGE` (`/app/message.send`, `/app/message.sync`) | 60 msg | 1 min | `MESSAGE` (`RateLimitService`; yaml `rate-limit.messages.per-minute`) |
| `CREATE_SESSION` (`/app/session.create`) | 3 req | 1 min | `SESSION_CREATE` (после PoW) |
| `session.accept` / `session.reject` / `verification.confirm`; `room.kick` / `room.ban` / `room.mute` | 10 req | 1 min | `SESSION_ACTION` (accept/reject — в `RateLimitInterceptor`; kick/ban/mute — `enforceRateLimit` в `RoomHandler`) |
| `handshake.key` (`/app/handshake.key`) | 10 req | 1 min | `HANDSHAKE` |
| `message.edit` / `room.message.edit` | 10 req | 1 min | `MESSAGE_EDIT` |
| `message.delete` / `room.message.delete` | 30 req | 1 min | `MESSAGE_DELETE` |
| `room.getMembers` / `room.getPresence` / `room.getBans` | 30 req | 1 min | `ROOM_READ` |
| `pow.challenge` (`/app/pow.challenge`) | 10 req | 1 min | `POW_CHALLENGE` (`PowHandler`, не interceptor) |
| Неудачный proof пароля комнаты (`room.requestJoin`) | 5 fails | 10 min | `ROOM_PASSWORD_FAIL` — ключ `ratelimit:room_password_fail:{roomId}:{internalId}`; yaml `rate-limit.room-password-fail.*`; атомарный INCR на попытку, reset при успехе (IMP-FAUDIT2-F01) |
| Прочие незамапленные `/app/*` | 100 req | 1 min | `GENERAL` fallback в `RateLimitInterceptor` |
| `/app/heartbeat` | exempt | — | presence heartbeat |

При превышении STOMP-лимита SEND-фрейм дропается; клиент получает
`RATE_LIMIT_EXCEEDED` на `/user/queue/errors` (соединение остаётся открытым).

### REST (файлы): аутентификация

Эндпоинты файлов поддерживают те же два режима, что и WebSocket handshake:

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

Кастомные эндпоинты (`HealthController`, префикс `/api`):

```http
GET /api/health
```

**Response:**
```json
{
  "status": "UP",
  "service": "burned-chats-backend",
  "timestamp": "2026-07-09T10:00:00Z"
}
```

```http
GET /api/health/detailed
```

**Response:** `status` = `UP` | `DEGRADED`; `components.redis` / `components.websocket`
(Redis через `RedisHealthService`).

Также доступны Spring Actuator: `GET /actuator/health`, `GET /actuator/info`
(см. `application.yml` management endpoints).

### Application Info

```http
GET /api/info
```

**Response** (`HealthController` — версия **захардкожена**):
```json
{
  "name": "BurnedChats Backend",
  "version": "0.1.0-SNAPSHOT",
  "description": "Secure ephemeral chat backend for Telegram Mini App",
  "features": {
    "websocket": "STOMP over WebSocket with SockJS fallback",
    "redis": "Lettuce reactive client with connection pooling"
  }
}
```

> Actuator `/actuator/info` может отдавать `info.app.version` из Maven
> (`@project.version@`) — это **отдельный** эндпоинт; канон для агентов —
> `/api/info` → `0.1.0-SNAPSHOT`.

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

`size` — размер **зашифрованного** blob'а, сохранённого на сервере (байты ciphertext), не исходного plaintext-файла. Для STOMP `fileSize` клиент передаёт plaintext size отдельно (см. ниже).

**Errors (JSON body, кроме 429 где указано):**

| HTTP | Поле `error` | Когда |
|------|--------------|--------|
| 401 | `AUTH_ERROR` / код из `AuthenticationException` | Отсутствуют, невалидные или просроченные auth-креды (initData или session token) |
| 400 | `INVALID_CONTEXT_TYPE` | `X-Context-Type` не `session` и не `room` |
| 400 | `FILE_SIZE_INVALID` | Несоответствие размера на диске и `Content-Length` после загрузки |
| 403 | `ACCESS_DENIED` | Пользователь не участник сессии / не член комнаты |
| 404 | `CONTEXT_NOT_FOUND` | Сессия не найдена (для `session`) |
| 413 | `FILE_TOO_LARGE` | Размер вне допустимого диапазона (см. `ValidationConstants.MAX_ENCRYPTED_FILE_SIZE`) |
| 429 | `RATE_LIMIT_EXCEEDED` | Превышен лимит загрузок; возможны заголовки `Retry-After` и поле `retryAfter` в JSON |

Пример тела при 429:

```json
{
  "error": "RATE_LIMIT_EXCEEDED",
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
POST /api/telegram/webhook
```

Обрабатывает входящие update от Telegram Bot API.
Контроллер: `TelegramWebhookController` (`@RequestMapping("/api/telegram")` +
`@PostMapping("/webhook")`). Включается при `telegram.bot.webhook.enabled=true`.

**Headers:**
```http
X-Telegram-Bot-Api-Secret-Token: <webhook_secret>
Content-Type: application/json
```

**Body:** Telegram Update object

Невалидный secret → **401**. Nginx prod проксирует тот же путь
(`/api/telegram/webhook`).

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

**Окно голосования и состояние `ACTIVE`**

- `GET /api/governance/active-proposals` и `ProposalSummary.state == ACTIVE` включают **pre-vote окно** `CANCEL_LAG` (**3600 с**): on-chain proposal в `PS_ACTIVE`, но голосование ещё **не открыто** (proposer может отменить proposal; см. IMP-PREMNT-08).
- `startTime = creationTime + CANCEL_LAG` (`governor.tact`); голосование доступно только при **`now >= startTime`** и `now <= endTime`.
- Голос до `startTime` отклоняется on-chain: `Proposal.ProposalVoteRelay` → `require(t >= self.startTime, "Not started")` → **exit code `54220`** (bounce; голос не засчитывается). См. [REPORT IMP-GOVOTE](../archive/improvements/governance-vote-tx-fail/REPORT.md) RC-1.
- Клиент обязан блокировать `CastVote`, пока `now < startTime` (IMP-GOVOTE-01), даже если backend возвращает `ACTIVE`.

**On-chain relay-флоу голоса и газовый бюджет (IMP-GOVOTE-04 / IMP-GOVREFUND-01)**

| Шаг | От → К | Сообщение | Value (TON) | Примечание |
|-----|--------|-----------|-------------|------------|
| 1 | Wallet → **Governor** | `CastVote` (`0x5a040102`) | attach **≥ `GasVoteAttach` = 0.18** | `require(context().value >= GasVoteAttach, "Need TON for vote")` |
| 2 | Governor → **StakingMaster** | `GovernorVoteRelay` (`0x5a040019`) | **`value: 0`** | `SendRemainingValue`; VP relay |
| 3 | StakingMaster → **Proposal** | `ProposalVoteRelay` (`0x5a040011`) | **`value: 0`** | `SendRemainingValue`; VP cap по on-chain staking |

- Успешный голос: остаток relay возвращается **voter'у** из Proposal (`SendRemainingValue | SendIgnoreErrors`).
- Bounce (отклонение на Governor/StakingMaster): value **поглощается** на hop'е без `cashback` — voter не получает refund из truncated bounce body (RC-2 / AD-1).
- Источник констант: `contracts/governance/governor.tact`; зеркало — `contracts/wrappers/Governor.ts` (`GOVERNOR_VOTE_ATTACH_NANO`), `frontend/src/ton/transactionBuilder.ts` (`VOTE_ATTACHED_TON`). Decisions: [IMP-GOVOTE-04](../archive/improvements/governance-vote-tx-fail/decisions/IMP-GOVOTE-04-vote-gas-attach.md), [IMP-GOVREFUND-01](../archive/governance-vote-refund-leak/cards/IMP-GOVREFUND-01.md).

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
- File upload в комнатах — валидация ownership по `uploaderInternalId` (канонический `internalId`); legacy-fallback по `uploaderTgId` для метаданных до IMP-WFT-05.

Хендлеры используют `AppPrincipal` / `internalId`; каст `(TelegramPrincipal)` в бизнес-логике **запрещён**.

### Подключение

```typescript
// Frontend - STOMP Client (auth на HTTP handshake; см. «Аутентификация»)
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const client = new Client({
  webSocketFactory: () => new SockJS(
    `https://api.burnedchats.com/ws?X-Auth-Type=telegram&X-Telegram-Init-Data=${encodeURIComponent(initData)}`
  ),
  // Broker heartbeat: 10s (WebSocketConfig / application.yml)
  heartbeatIncoming: 10000,
  heartbeatOutgoing: 10000,
  onConnect: () => {
    console.log('Connected');
    // Персональные очереди — актуальные имена из кода
    client.subscribe('/user/queue/new-message', handleMessage);
    client.subscribe('/user/queue/errors', handleError);
    client.subscribe('/user/queue/sync-messages', handleSync);
  }
});

client.activate();

// Presence heartbeat (отдельно от STOMP broker heartbeat): каждые ~20s
setInterval(() => {
  client.publish({ destination: '/app/heartbeat', body: '{}' });
}, 20000);
```

### Жизненный цикл соединения

```
┌─────────────────────────────────────────────────────────────┐
│                    CONNECTION LIFECYCLE                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Client                              Server                  │
│    │                                    │                    │
│    │ ── HTTP WS handshake ─────────────►│                   │
│    │  (auth headers / SockJS query)     │ validate creds     │
│    │                                    │                    │
│    │ ─────── STOMP CONNECT ─────────────►│                   │
│    │  (подтверждает principal)          │                    │
│    │ ◄─────── CONNECTED ────────────────│                    │
│    │                                    │                    │
│    │ ─────── SUBSCRIBE ─────────────────►│                   │
│    │         (/user/queue/*)            │                    │
│    │                                    │                    │
│    │ ══════ STOMP heartbeat 10s ═══════│                    │
│    │ ══════ /app/heartbeat ~20s ═══════│ (presence TTL 30s) │
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

**Ответы на `/user/queue/search-result`:**

| Условие | Payload |
|---------|---------|
| Найден | `{ found: true, user: UserResponse }` |
| Не найден / ошибка репозитория | `{ found: false }` (`error` = `null`) — **не** отдельный код `NOT_FOUND` |
| Невалидный формат | `{ found: false, error: "INVALID_QUERY" }` |
| Self-search | `{ found: false, error: "SELF_SEARCH" }` |

**Rate-limit** (`SEARCH` 10/min): SEND дропается; клиент получает
`RATE_LIMIT_EXCEEDED` на `/user/queue/errors` (не на `search-result`).

**Backend:** `SearchHandler` — `@MessageMapping("/search")`, доставка через `StompUserMessenger` по `internalId` инициатора поиска.

---

### `POW_CHALLENGE` (`/app/pow.challenge`)

Запрос PoW-challenge перед gated-действием (см. [DESIGN.md](../archive/antispam-pow/DESIGN.md)). Маршрут **не** требует PoW (иначе «курица/яйцо»). **Rate-limit на issuance:** `RateLimitService.POW_CHALLENGE` — **10 запросов / мин / `internalId`**; при превышении → `/user/queue/errors` с `RATE_LIMIT_EXCEEDED` и `retryAfter` (секунды).

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

**Коды ошибок** (`success: false` на `/user/queue/session-created`):
`SELF_REQUEST`, `INVALID_RECIPIENT`, `EXPECTED_ANSWER_REQUIRED`,
`EXPECTED_ANSWER_TOO_LONG`, `ALREADY_HAS_SESSION`, `RECIPIENT_HAS_SESSION`,
`PENDING_REQUEST_EXISTS`, `INTERNAL_ERROR`.

> Коды `USER_NOT_FOUND` / `SELF_CHAT` / `USER_BLOCKED` / `RATE_LIMITED` на
> `session-created` **не используются**. Rate-limit и PoW идут на
> `/user/queue/errors` (см. ниже).

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

### `REJECT_REQUEST` (`/app/session.reject`)

Отклонение запроса на чат.

**Frontend:**
```typescript
client.publish({
  destination: '/app/session.reject',
  body: JSON.stringify({
    sessionId: 'abc123'
  })
});

client.subscribe('/user/queue/session-rejected', (message) => {
  const data = JSON.parse(message.body);
  // SessionRejectedEvent: sessionId, …
});
```

**Backend:** `SessionHandler` — `@MessageMapping("/session.reject")`.
Доставка инициатору через `StompUserMessenger` по **`internalId`**
(не Telegram ID). Principal name = `UnifiedUser.internalId()`.

---

### `SEND_PUBLIC_KEY` (`/app/handshake.key`)

Отправка публичного ключа ECDH для handshake.

**Frontend:**
```typescript
client.publish({
  destination: '/app/handshake.key',
  body: JSON.stringify({
    sessionId: 'abc123',
    publicKey: 'Base64EncodedRawKey...'
  })
});

// Peer получает
client.subscribe('/user/queue/peer-key', (message) => {
  const data = JSON.parse(message.body);
  // PeerPublicKeyEvent: sessionId, publicKey, …
});
```

**Backend:** `HandshakeHandler` — `@MessageMapping("/handshake.key")`.
Peer-доставка: `StompUserMessenger` → `/user/queue/peer-key` по `internalId`.
Также существует `/user/queue/handshake-refresh` при refresh handshake.

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
    type: 'text',
    replyToMessageId: 'optional-parent-message-id' // опционально
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
    fileSize: 1048576,
    replyToMessageId: 'optional-parent-message-id' // опционально
  })
});
```

Сервер перед ретрансляцией проверяет, что `fileId` (и `thumbnailFileId`, если есть) существуют в `file_meta:*`, загружены отправителем (ownership по `uploaderInternalId` == `sender.internalId()`; legacy-fallback по `uploaderTgId` только для старых метаданных без `uploaderInternalId` и при `sender.telegramId != null`) и привязаны к той же `sessionId`. При ошибке валидации возможны коды: `FILE_NOT_FOUND`, `FILE_NOT_OWNED`, `FILE_CONTEXT_MISMATCH`.

**События:**

- Получатель: `/user/queue/new-message` — тело в формате `NewMessageEvent` (включая `senderInternalId`, `replyToMessageId?`, `type`, `fileId`, `thumbnailFileId`, `encryptedMeta`, `fileSize` для медиа).
- Отправитель: `/user/queue/message-sent` — подтверждение доставки.

```typescript
client.subscribe('/user/queue/new-message', (message) => {
  const data = JSON.parse(message.body);
  // success, sessionId, messageId, senderId, senderInternalId, encryptedContent, iv,
  // clientTimestamp, serverTimestamp, type, replyToMessageId?,
  // fileId?, thumbnailFileId?, encryptedMeta?, fileSize?
});
```

**Backend:** `MessageHandler` — `@MessageMapping("/message.send")`, см. `SendMessageRequest`, `NewMessageEvent`.

> Для **комнат** используется отдельный handler и `SendRoomMessageRequest` с теми же файловыми полями; destination см. в коде (`RoomMessageHandler`).

---

### `CONFIRM_VERIFICATION` (`/app/verification.confirm`)

Подтверждение Visual Fingerprint.

**Frontend:**
```typescript
client.publish({
  destination: '/app/verification.confirm',
  body: JSON.stringify({
    sessionId: 'abc123',
    confirmed: true
  })
});

// Оба получают статус
client.subscribe('/user/queue/verification', (message) => {
  const data = JSON.parse(message.body);
  // VerificationEvent: success, sessionId, verified, peerVerified, bothVerified, verifiedAt?, error?
});
```

**Backend:** `VerificationHandler` — `@MessageMapping("/verification.confirm")`.
Доставка через `StompUserMessenger` → `/user/queue/verification` по `internalId`.

---

### `BURN_SESSION` (`/app/session.burn`)

Уничтожение сессии.

**Frontend:**
```typescript
client.publish({
  destination: '/app/session.burn',
  body: JSON.stringify({
    sessionId: 'abc123'
  })
});

// Оба получают
client.subscribe('/user/queue/burn-signal', (message) => {
  const data = JSON.parse(message.body);
  // BurnSignalEvent: sessionId, burnedBy?, burnedAt, success
});
```

**Backend:** `BurnHandler` — `@MessageMapping("/session.burn")`.
Доставка через `StompUserMessenger` → `/user/queue/burn-signal` по `internalId`
обоих участников. После burn клиент обязан уничтожить ключи и очистить историю.

---

### `BURN_ALL` (`/app/user.burnAll`)

Глобальное серверное уничтожение всех данных пользователя одним каскадом
(IMP-BURNALL-01). Требует живого STOMP-соединения.

**Frontend:**
```typescript
client.publish({
  destination: '/app/user.burnAll',
  body: JSON.stringify({
    wipeIdentity: false  // true = также удалить user:{internalId}, auth_*, lang:pref, member_rooms, session_token:*
  })
});

client.subscribe('/user/queue/burn-all-complete', (message) => {
  const data = JSON.parse(message.body);
  // BurnAllCompleteEvent: wipeIdentity, burnedSessions, burnedRooms, leftRooms, timestamp
});
```

**Backend:** `UserBurnHandler` — `@MessageMapping("/user.burnAll")`.
Каскад `UserBurnService.burnAllForUser(internalId, wipeIdentity)`:

1. Все активные DM-сессии → burn как `/app/session.burn` + `BurnSignalEvent` пирам.
2. Комнаты во владении → `RoomService.burnRoomAsOwner` + `RoomBurnedEvent` участникам.
3. Чужие комнаты → leave-каскад + `room-member-left` оставшимся (rekey у owner).
4. Хвосты: `request:*`, offline/tombstone-очереди пользователя, `file_context` через `FileBurnService`.
5. При `wipeIdentity=true` — `user:{internalId}`, `auth_tg`, `auth_wallet`, `lang:pref`, `member_rooms`, `session_token:*`.
6. Ack инициатору → `/user/queue/burn-all-complete` **до** разрыва соединения (disconnect на клиенте).

**Rate-limit:** `RateLimitService.checkRestRateLimit("burn_all", internalId, 3, 1 min)` —
без PoW. Повторный вызов идемпотентен (добивает остатки).

**События пирам (не инициатору):**

| Очередь | Событие | Когда |
|---------|---------|-------|
| `/user/queue/burn-signal` | `BurnSignalEvent` | Каждая сожжённая DM-сессия |
| `/user/queue/room-burned` | `RoomBurnedEvent` | Каждая сожжённая owned-комната |
| `/user/queue/room-member-left` | `RoomMemberLeftEvent` | Каждый leave из чужой комнаты |

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

### `TYPING_START` / `TYPING_STOP` — **planned (не реализовано)**

> **Статус:** destinations `/app/typing/start`, `/app/typing/stop` и очередь
> `/user/queue/peer-typing` **отсутствуют в коде** (нет `@MessageMapping`, нет
> публикаций). Не подписываться и не публиковать — клиент получит тишину.
> Зарезервировано на будущее; до реализации индикатор набора не поддерживается.

---

### Дополнительные DM / session destinations (код)

Следующие маршруты реализованы в `SessionHandler` / `MessageHandler` /
`HeartbeatHandler` / `UserPreferenceHandler` и ранее не были сведены в одну таблицу:

| Destination | Handler | Ответ / очередь | Описание |
|-------------|---------|-----------------|----------|
| `/app/session.pending` | `SessionHandler` | (см. handler) | Список / получение pending-запросов |
| `/app/session.status` | `SessionHandler` | `/user/queue/session-status` | Статус сессии (`SessionStatusEvent`) |
| `/app/peer.disconnect` | `SessionHandler` | `/user/queue/peer-disconnected` | Уведомление peer об disconnect |
| `/app/session.active.list` | `SessionHandler` | `/user/queue/active-sessions` | Список активных сессий |
| `/app/session.resume` | `SessionHandler` | `/user/queue/session-resumed` | Resume после reconnect |
| `/app/message.edit` | `MessageHandler` | `/user/queue/message-edited` | Редактирование DM |
| `/app/message.delete` | `MessageHandler` | `/user/queue/message-deleted` | Удаление DM |
| `/app/heartbeat` | `HeartbeatHandler` | — (обновляет `online:*`) | Presence; rate-limit **exempt**; клиент ~20s |
| `/app/user.setLanguage` | `UserPreferenceHandler` | — (fire-and-forget) | Сохранение языковой pref |

---

## Серверные события (Server → Client)

Все серверные события отправляются на персональные очереди пользователя
(`/user/queue/*`) через `StompUserMessenger` по **`internalId`**.

### DM / session / system

| Очередь | Событие / DTO | Описание |
|---------|---------------|----------|
| `/user/queue/search-result` | `SearchResultEvent` | Результат поиска |
| `/user/queue/pow-challenge` | `PowChallengeEvent` | Выданный PoW challenge |
| `/user/queue/session-created` | `SessionCreatedEvent` | Ответ на `session.create` |
| `/user/queue/session-accepted` | `SessionAcceptedEvent` | Запрос принят |
| `/user/queue/session-rejected` | `SessionRejectedEvent` | Запрос отклонён |
| `/user/queue/session-status` | `SessionStatusEvent` | Статус сессии |
| `/user/queue/incoming-request` | `IncomingRequestEvent` | Входящий запрос на чат |
| `/user/queue/peer-disconnected` | `PeerDisconnectedEvent` | Peer отключился |
| `/user/queue/active-sessions` | `ActiveSessionsListEvent` | Список активных сессий |
| `/user/queue/session-resumed` | `SessionResumedEvent` | Resume после reconnect |
| `/user/queue/peer-key` | `PeerPublicKeyEvent` | Публичный ключ peer |
| `/user/queue/handshake-refresh` | handshake refresh | Обновление handshake |
| `/user/queue/new-message` | `NewMessageEvent` | Новое DM-сообщение |
| `/user/queue/message-sent` | `MessageSentEvent` | Ack / ошибки отправки DM |
| `/user/queue/sync-messages` | `SyncMessagesEvent` | Offline sync DM |
| `/user/queue/message-edited` | `MessageEditedEvent` | DM отредактировано |
| `/user/queue/message-deleted` | `MessageDeletedEvent` | DM удалено |
| `/user/queue/verification` | `VerificationEvent` | Статус fingerprint |
| `/user/queue/burn-signal` | `BurnSignalEvent` | Сессия сожжена |
| `/user/queue/burn-all-complete` | `BurnAllCompleteEvent` | Ack глобального burn-all |
| `/user/queue/errors` | error map | Глобальные STOMP-ошибки (rate-limit, PoW, validation) |

> **Не реализовано (не эмитятся):** `/user/queue/session-started`,
> `peer-joined`, `peer-left`, `peer-typing`. Не подписываться.
> Устаревшие имена из старых спек (`messages`, `sync-result`, `error`,
> `peer-public-key`, `session-burned`, `verification-status`) **заменены**
> строками таблицы выше.

### Room user queues

| Очередь | Описание |
|---------|----------|
| `/user/queue/room-created` | Комната создана |
| `/user/queue/invite-link` | Инвайт-ссылка |
| `/user/queue/room-invites` | Список инвайтов |
| `/user/queue/room-invite-info` | Инфо по токену |
| `/user/queue/room-join-requests` | Заявки на вступление |
| `/user/queue/room-join-result` | Результат join (approve/reject) |
| `/user/queue/key-bundle` | Key bundle |
| `/user/queue/room-rekey` | Rekey |
| `/user/queue/member-pubkeys` | Pubkeys членов |
| `/user/queue/room-list` | Список комнат пользователя |
| `/user/queue/room-members` | Список членов |
| `/user/queue/room-presence` | Snapshot presence |
| `/user/queue/room-burned` | Комната сожжена |
| `/user/queue/room-left` | Вы вышли |
| `/user/queue/room-member-left` | Участник вышел |
| `/user/queue/room-kicked` | Вас кикнули |
| `/user/queue/room-kick-result` | Результат kick |
| `/user/queue/room-member-removed` | Участник удалён |
| `/user/queue/room-bans` | Список банов |
| `/user/queue/room-message-sent` | Ack / ошибки room send |
| `/user/queue/room-sync-messages` | Offline sync room |
| `/user/queue/room-message-edited` | Room edit ack/error |
| `/user/queue/room-message-deleted` | Room delete ack/error |

> Константа `/queue/room-message-error` в коде **определена, но не используется** —
> ошибки room-send идут в `/user/queue/room-message-sent`.

Топик: `/topic/room/{roomId}` (мультиплекс по типу события; подписка только для членов).

### Дополнительные room destinations (client → server)

| Destination | Описание |
|-------------|----------|
| `/app/room.leave` | Выход из комнаты → `/user/queue/room-left` (+ peer `room-member-left`) |
| `/app/room.requestKeyBundle` | Запрос key bundle |
| `/app/room.getMemberPubkeys` | Pubkeys членов → `/user/queue/member-pubkeys` |
| `/app/room.message.edit` | Редактирование room-сообщения |
| `/app/room.message.delete` | Удаление room-сообщения |
| `/app/room.burn` | Сожжение комнаты → `/user/queue/room-burned` |
| `/app/user.burnAll` | Глобальный burn-all каскад → `/user/queue/burn-all-complete` (+ peer-события) |

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
| `replyToMessageId` | Опционально — ID сообщения, на которое это reply (plaintext metadata; в `SendMessageRequest` и `NewMessageEvent`) |
| `senderInternalId` | Только в `NewMessageEvent` — primary identity отправителя (wallet-safe); `senderId` (TG) может быть `null` |

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

| Код | HTTP / канал | Описание |
|-----|--------------|----------|
| `UNAUTHORIZED` | 401 | Невалидный initData / session token |
| `FORBIDDEN` | 403 | Нет доступа к ресурсу |
| `NOT_FOUND` | 404 | Ресурс не найден |
| `RATE_LIMIT_EXCEEDED` | 429 / STOMP `/user/queue/errors` | Превышен лимит запросов (REST и STOMP) |
| `POW_REQUIRED` | STOMP `/user/queue/errors` | Нет/истёк PoW challenge на gated-действии |
| `POW_INVALID` | STOMP `/user/queue/errors` | Неверное PoW-решение, action mismatch или replay |
| `INTERNAL_ERROR` | 500 / STOMP | Внутренняя ошибка сервера |

> Устаревший код `RATE_LIMITED` в REST/STOMP global errors **не используется**
> (`RateLimitException` → `RATE_LIMIT_EXCEEDED`). Некоторые room-event DTO
> всё ещё могут писать строку `RATE_LIMITED` в поле `error` локального ack —
> это отдельный wire-контракт room-handlers, не глобальный `/user/queue/errors`.

### Ошибки сессий

| Код | Описание |
|-----|----------|
| `SESSION_NOT_FOUND` | Сессия не существует или истекла |
| `SESSION_FULL` | В сессии уже 2 участника |
| `SESSION_EXPIRED` | Время ожидания истекло |
| `SESSION_BURNED` | Сессия была уничтожена |
| `NOT_PARTICIPANT` | Вы не участник этой сессии |
| `SELF_REQUEST` | Нельзя создать чат с собой (`session.create`) |
| `INVALID_RECIPIENT` | Получатель не резолвится |
| `ALREADY_HAS_SESSION` | У инициатора уже есть активная сессия |
| `RECIPIENT_HAS_SESSION` | У получателя уже есть активная сессия |
| `PENDING_REQUEST_EXISTS` | Дублирующий pending-запрос |

### Ошибки пользователей

| Код | Описание |
|-----|----------|
| `INVALID_QUERY` | Невалидный формат search query |
| `SELF_SEARCH` | Поиск самого себя |

> Коды `USER_NOT_FOUND`, `USER_BLOCKED`, `SELF_CHAT` **не эмитятся** кодом
> (блокировки пользователей не реализованы; not-found поиска = `{found:false}`).

### Ошибки сообщений и файлов

| Код | Описание |
|-----|----------|
| `MESSAGE_TOO_LARGE` | Превышен лимит размера |
| `INVALID_FORMAT` | Неверный формат данных |
| `FILE_TOO_LARGE` | Зашифрованный blob превышает серверный потолок (`MAX_ENCRYPTED_FILE_SIZE`) |
| `FILE_NOT_FOUND` | Файл не найден в Redis или истёк TTL (REST download / валидация ретрансляции) |
| `ACCESS_DENIED` | Нет доступа к файлу или контексту (REST); в документации также: «file access denied» |
| `FILE_NOT_OWNED` | Отправитель не совпадает с загрузчиком (`uploaderInternalId` или legacy `uploaderTgId`) |
| `FILE_CONTEXT_MISMATCH` | Файл привязан к другому session/room, чем сообщение |
| `CONTEXT_NOT_FOUND` | Сессия для загрузки не найдена |
| `FILE_SIZE_INVALID` | Размер после загрузки не совпал с `Content-Length` |
| `INVALID_CONTEXT_TYPE` | Неверный `X-Context-Type` |

### STOMP Exception Handler

`WebSocketExceptionHandler` ловит исключения на STOMP-маршрутах и шлёт
payload на `/user/queue/errors` через `StompUserMessenger` по **`internalId`**
принципала (не Telegram ID). Типичные коды: `RATE_LIMIT_EXCEEDED`,
`POW_REQUIRED`, `POW_INVALID`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.
Тело — `Map` с полями `success`, `error`, `message`, `timestamp`
(+ `retryAfter` для rate-limit).

---

## WebSocket Reconnection

### Стратегия переподключения (Frontend)

```typescript
const client = new Client({
  webSocketFactory: () => new SockJS(
    `/ws?X-Auth-Type=telegram&X-Telegram-Init-Data=${encodeURIComponent(WebApp.initData)}`
  ),
  reconnectDelay: 5000,
  // STOMP broker heartbeat — 10s (совпадает с WebSocketConfig)
  heartbeatIncoming: 10000,
  heartbeatOutgoing: 10000,

  onConnect: () => {
    if (currentSessionId) {
      client.publish({
        destination: '/app/message.sync',
        body: JSON.stringify({ sessionId: currentSessionId })
      });
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
// 1. Подключение (auth на HTTP handshake / SockJS query)
const client = new Client({
  webSocketFactory: () => new SockJS(
    `/ws?X-Auth-Type=telegram&X-Telegram-Init-Data=${encodeURIComponent(initData)}`
  ),
  heartbeatIncoming: 10000,
  heartbeatOutgoing: 10000
});

client.onConnect = () => {
  // 2. Подписки на актуальные очереди
  client.subscribe('/user/queue/search-result', handleSearchResult);
  client.subscribe('/user/queue/session-created', handleSessionCreated);
  client.subscribe('/user/queue/session-accepted', handleSessionAccepted);
  client.subscribe('/user/queue/incoming-request', handleIncomingRequest);
  client.subscribe('/user/queue/peer-key', handlePeerPublicKey);
  client.subscribe('/user/queue/new-message', handleNewMessage);
  client.subscribe('/user/queue/burn-signal', handleBurnSignal);
  client.subscribe('/user/queue/errors', handleError);
  client.subscribe('/user/queue/sync-messages', handleSync);

  // Presence heartbeat ~20s
  setInterval(() => {
    client.publish({ destination: '/app/heartbeat', body: '{}' });
  }, 20000);

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
    // 5. Создание сессии (primary: recipientInternalId)
    client.publish({
      destination: '/app/session.create',
      body: JSON.stringify({
        recipientInternalId: user.internalId,
        pow: { challengeId: '...', nonce: '...' } // если pow.enabled
      })
    });
  }
}

// 6. После session-accepted / handshake — обмен ключами
async function startHandshake(sessionId: string) {
  const keyPair = await generateKeyPair();
  const publicKey = await exportPublicKey(keyPair.publicKey);

  client.publish({
    destination: '/app/handshake.key',
    body: JSON.stringify({ sessionId, publicKey })
  });
}

// 7. Получение ключа peer
async function handlePeerPublicKey(message) {
  const { publicKey, sessionId } = JSON.parse(message.body);
  const peerKey = await importPublicKey(publicKey);
  const sharedKey = await deriveKey(keyPair.privateKey, peerKey);

  const fingerprint = await generateFingerprint(sharedKey);
  showVerificationUI(fingerprint);
}

// 8. Отправка сообщений
async function sendMessage(text: string) {
  const encrypted = await encrypt(text, sharedKey);
  client.publish({
    destination: '/app/message.send',
    body: JSON.stringify({
      sessionId,
      messageId: crypto.randomUUID(),
      encryptedContent: encrypted.ciphertext,
      iv: encrypted.iv,
      timestamp: Date.now(),
      type: 'text'
    })
  });
}

// 9. Получение сообщений (плоский NewMessageEvent)
async function handleNewMessage(message) {
  const data = JSON.parse(message.body);
  const decrypted = await decrypt(
    { ciphertext: data.encryptedContent, iv: data.iv },
    sharedKey
  );
  displayMessage(decrypted);
}

// 10. Уничтожение
function burnSession() {
  client.publish({
    destination: '/app/session.burn',
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
  "roomId": "uuid (optional; required when nameEncrypted is set)",
  "nameEncrypted": "base64... (optional)",
  "nameIv": "base64... (optional; required together with nameEncrypted)"
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `salt` | string (Base64, 16–48 bytes) | При BY_PASSWORD | KDF salt, client-generated. При BY_REQUEST без пароля — не передавать |
| `passwordProof` | string (Base64, 32 bytes) | При BY_PASSWORD | PBKDF2 proof. При BY_REQUEST без пароля — не передавать |
| `joinMode` | enum | Да | `BY_PASSWORD` — вход сразу; `BY_REQUEST` — по одобрению (пароль опционален) |
| `ownerPublicKey` | string (Base64) | Нет | Публичный ключ владельца (ECDH) |
| `roomId` | string (UUID v4) | При `nameEncrypted`* | Client-proposed UUID комнаты; сервер использует его при отсутствии коллизии. Без имени — сервер генерирует UUID |
| `nameEncrypted` | string (Base64) | Нет* | AES-GCM ciphertext имени (opaque, max 512 chars) |
| `nameIv` | string (Base64) | Нет* | 12-byte GCM IV для `nameEncrypted` (max 32 chars Base64) |

\* `nameEncrypted` и `nameIv` передаются **оба** или **ни одного**; при наличии **обязателен**
client `roomId` (AES-GCM AAD = `roomId`, см.
[IMP-RCDF-05](../archive/improvements/room-create-decryption-fix/decisions/IMP-RCDF-05-group-key-and-room-id-order.md)).
При создании с именем отдельный `SET_ROOM_NAME` **не** требуется — имя сохраняется в Redis
атомарно с create; `ROOM_NAME_UPDATED` при create **не** публикуется.

**Ответ:** `/user/queue/room-created` — `RoomCreatedEvent` с `roomId` и опциональным `inviteUrl` (default token, 7d TTL, unlimited uses).

**Формат `inviteUrl` / `invites[].url` (IMP-WEBINVITE-01):** канонический web-URL
`{telegram.mini-app.url}/join#invite_{token}` — токен во **фрагменте** (`#`), не в path/query.
Fallback при пустом `telegram.mini-app.url`: `https://t.me/{bot}/app?startapp=invite_{token}`.
Старые t.me-ссылки остаются валидными на клиенте через `start_param`.

---

### GET_INVITE_LINK (`/app/room.getInviteLink`)

**Направление:** Client → Server (owner or admin)

**Запрос** (`GetInviteLinkRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `expiresInSeconds` | number | Нет | TTL от текущего момента (60 с … 30 д); default 7 дней |
| `maxUses` | number | Нет | Лимит успешных join; `0`/отсутствует = безлимит |

**Ответ:** `/user/queue/invite-link` — `InviteLinkEvent` с `inviteUrl`.

Ошибки: `ROOM_NOT_FOUND`, `NOT_OWNER`, `INTERNAL_ERROR`.

---

### REVOKE_INVITE (`/app/room.revokeInvite`)

**Направление:** Client → Server (owner or admin)

**Запрос** (`RevokeInviteRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `token` | string | Да | Token string (не URL) |

Удаляет `invite:{token}` и убирает token из `room_invites:{roomId}`. Отдельный ack не рассылается (fire-and-forget); ошибки логируются (`NOT_OWNER`, `INVALID_TOKEN`, `ROOM_NOT_FOUND`).

---

### GET_INVITES (`/app/room.getInvites`)

**Направление:** Client → Server (owner or admin)

**Запрос:** `{ "roomId": "uuid" }` (тот же DTO, что у `getInviteLink`, без опциональных полей).

**Ответ:** `/user/queue/room-invites` — `RoomInvitesEvent`:

| Поле | Тип | Описание |
|------|-----|----------|
| `success` | boolean | |
| `roomId` | string | UUID комнаты |
| `invites[]` | array | Активные токены из `room_invites:{roomId}` |
| `invites[].token` | string | Token string |
| `invites[].url` | string | Web invite URL (`/join#invite_{token}`) или fallback t.me deep link |
| `invites[].createdAt` | number | Unix ms |
| `invites[].expiresAt` | number | Unix ms |
| `invites[].maxUses` | number? | `null`/0 = безлимит |
| `invites[].usedCount` | number | Текущий счётчик |
| `error` | string | При `success=false`: `NOT_OWNER`, `ROOM_NOT_FOUND`, `INTERNAL_ERROR` |

---

### GET_INVITE_INFO / room-invite-info

**Запрос:** Client → Server, destination `/app/room.getInviteInfo`, body `{ "inviteToken": "string" }`.

**Ответ:** Server → Client, destination `/user/queue/room-invite-info`.

При успехе клиент получает `salt`, `joinMode` и **`hasPassword`** (boolean). Если `hasPassword === false`, комната без пароля (BY_REQUEST): на экране «Войти по ссылке» не показывать поле пароля, только кнопку «Отправить заявку».

Ошибки (без раскрытия данных комнаты): `INVALID_TOKEN`, `INVITE_EXPIRED`, `INVITE_EXHAUSTED`.

---

### REQUEST_JOIN_ROOM

**Направление:** Client → Server  
**Destination:** `/app/room.requestJoin`

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `inviteToken` | string | Да | Токен из invite-ссылки (фрагмент `#invite_{token}` или `start_param`) |
| `passwordProof` | string (Base64) | Если у комнаты пароль | При комнате без пароля не передавать |
| `publicKey` | string (Base64) | Нет | Публичный ключ ECDH запрашивающего |

**Ошибки join** (на `/user/queue/room-join-result`): `INVALID_TOKEN`, `INVITE_EXPIRED`, `INVITE_EXHAUSTED`, `WRONG_PASSWORD`, `ALREADY_MEMBER`, `REQUEST_PENDING`, `USER_BANNED`.

**Lockout пароля (`ROOM_PASSWORD_FAIL`):** после 5 неудачных proof за 10 мин (ключ per `roomId`+`internalId`, yaml `rate-limit.room-password-fail.*`) дальнейшие попытки отклоняются. Wire-код на `/user/queue/room-join-result` сейчас **`INTERNAL_ERROR`** — `RoomHandler.mapJoinError` не мапит `RateLimitException` (surfacing отдельной ошибкой — вне этой спеки; см. IMP-FAUDIT2-F01 заметки / W5-4).

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
| `nameEncrypted` | string (Base64) | Нет* | Имя, пере-шифрованное под новую эпоху группового ключа |
| `nameIv` | string (Base64) | Нет* | 12-byte GCM IV для `nameEncrypted` |
| `bundles[].recipientInternalId` | string | Да | Получатель bundle |
| `bundles[].ephemeralPublicKey` | string | Да | Base64 |
| `bundles[].encryptedKey` | string | Да | Base64 |
| `bundles[].iv` | string | Да | Base64 |

\* `nameEncrypted` и `nameIv` передаются **оба** или **ни одного**; при наличии атомарно
обновляются в `room:{roomId}` вместе с ротацией ключей. На `/topic/room/{roomId}` рассылается
`ROOM_NAME_UPDATED` (см. SET_ROOM_NAME).

Каждый bundle доставляется на `/user/queue/key-bundle` соответствующему `recipientInternalId`.

---

### SET_ROOM_NAME (`/app/room.setName`)

**Направление:** Client → Server (owner-only)

**Запрос** (`SetRoomNameRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `nameEncrypted` | string (Base64) | Да | AES-GCM ciphertext имени (opaque, max 512 chars) |
| `nameIv` | string (Base64) | Да | 12-byte GCM IV (max 32 chars Base64) |

Сервер **не расшифровывает** имя; сохраняет оба поля в `room:{roomId}` и продлевает TTL.

**Fan-out:** `/topic/room/{roomId}` — `RoomNameUpdatedEvent`:

| Поле | Тип | Описание |
|------|-----|----------|
| `eventType` | string | `"ROOM_NAME_UPDATED"` |
| `roomId` | string | UUID комнаты |
| `nameEncrypted` | string | Base64 ciphertext |
| `nameIv` | string | Base64 IV |

Ошибки логируются на сервере (`NOT_OWNER`, `ROOM_NOT_FOUND`); отдельный user-queue ack
не предусмотрен (fire-and-forget, как у ранних room lifecycle endpoints).

---

### GET_MY_ROOMS (`/app/room.getMyRooms`)

**Запрос:** пустое тело или `{}`.

**Ответ:** `/user/queue/room-list` (`RoomListEvent`):

| Поле | Тип | Описание |
|------|-----|----------|
| `rooms[].roomId` | string | UUID |
| `rooms[].role` | enum | `owner` \| `admin` \| `member` |
| `rooms[].createdAt` | number | Unix ms |
| `rooms[].nameEncrypted` | string? | Зашифрованное имя (opaque) |
| `rooms[].nameIv` | string? | GCM IV для имени |

---

### Мультиплексированный топик `/topic/room/{roomId}` (таксономия событий)

`/topic/room/{roomId}` — **мультиплексированный** канал: на нём публикуются и
обычные зашифрованные сообщения, и служебные события комнаты (имя, TTL, роли,
передача владения, модерация, edit/delete, presence). Все они приходят в **одну**
STOMP-подписку, поэтому клиент обязан маршрутизировать payload по дискриминатору
`eventType` (см. контракт ниже). Сервер во всех случаях видит только opaque-данные
и метаданные — формат кодировки шифртекста/IV единый (стандартный Base64), см.
[DATA_MODELS.md → Формат кодировки шифртекста](./DATA_MODELS.md#формат-кодировки-шифртекста-encoding-contract).

**Полная таблица событий топика:**

| `eventType` | Источник (backend) | Frontend-обработчик | Ключевые поля payload |
|-------------|--------------------|---------------------|-----------------------|
| _(отсутствует)_ — сообщение | `RoomMessageHandler` → `NewRoomMessageEvent` | `handleNewMessage` → дешифровка | `messageId`, `encryptedContent`, `iv`, `senderInternalId`, опц. `type`/`fileId`/`thumbnailFileId`/`encryptedMeta`/`fileSize`, `replyToMessageId` |
| `ROOM_MESSAGE_DELETED` | `RoomMessageHandler` → `RoomMessageDeletedEvent` | `handleNewMessage` (ветка delete) | `messageId`, `deletedByInternalId`, `deletedByOwner` |
| `ROOM_MESSAGE_EDITED` | `RoomMessageHandler` → `RoomMessageEditedEvent` | `handleNewMessage` (ветка edit) → дешифровка нового текста | `messageId`, `encryptedContent`, `iv`, опц. медиа-поля |
| `ROOM_MODERATION` | `RoomHandler` → `RoomModerationEvent` | `handleNewMessage` → `onRoomModeration` | `readOnly`, `mutedAdded`, `mutedRemoved` |
| `ROOM_NAME_UPDATED` | `RoomHandler` → `RoomNameUpdatedEvent` | `useSetRoomName` listener | `nameEncrypted`, `nameIv` |
| `ROOM_TTL_UPDATED` | `RoomHandler` → `RoomTtlUpdatedEvent` | room-state listener | `autoBurnAt` |
| `ROOM_MESSAGE_TTL_UPDATED` | `RoomHandler` → `RoomMessageTtlUpdatedEvent` | room-state listener | `messageTtlSeconds` |
| `ROOM_ROLE_UPDATED` | `RoomHandler` → `RoomRoleUpdatedEvent` | room-roles listener | `targetInternalId`, `role` |
| `ROOM_OWNERSHIP_TRANSFERRED` | `RoomHandler` → `RoomOwnershipTransferredEvent` | room-roles listener | `newOwnerInternalId`, `previousOwnerInternalId` |
| _(отсутствует)_ — presence | `WebSocketEventListener` → `RoomPresenceEvent` | room-presence listener | `internalId`, `online`, `lastSeen` (нет `messageId`/`encryptedContent`) |

**Контракт обработчика сообщений (`handleNewMessage`, `frontend/src/hooks/useRoomMessages.ts`):**

- payload **без** `eventType`, с `messageId` и `encryptedContent`/`iv` (или файловыми
  полями) — единственный случай, который трактуется как сообщение и **дешифруется**
  групповым ключом комнаты;
- `ROOM_MESSAGE_DELETED` / `ROOM_MESSAGE_EDITED` / `ROOM_MODERATION` обрабатываются
  собственными ветками (удаление / правка / модерация);
- **любой иной `eventType`** (`ROOM_NAME_UPDATED`, `ROOM_TTL_UPDATED`,
  `ROOM_MESSAGE_TTL_UPDATED`, `ROOM_ROLE_UPDATED`, `ROOM_OWNERSHIP_TRANSFERRED`) и
  **любой неизвестный `eventType`** — безопасный дефолт: ранний `return`, payload
  **никогда** не попадает в путь дешифровки текста (фикс
  [IMP-RCDF-01](../archive/improvements/room-create-decryption-fix/cards/IMP-RCDF-01.md));
- payload **без** `eventType` и **без** `messageId` (например `RoomPresenceEvent`) не
  порождает ни сообщения, ни тоста: служебный listener обрабатывает его сам, а в
  `handleNewMessage` отсутствие `encryptedContent` приводит к типизированной ошибке
  (`INVALID_CIPHERTEXT_ENCODING`, [IMP-RCDF-02](../archive/improvements/room-create-decryption-fix/cards/IMP-RCDF-02.md))
  и graceful-degrade без плейсхолдера (нет `messageId`,
  [IMP-RCDF-03](../archive/improvements/room-create-decryption-fix/cards/IMP-RCDF-03.md)).

> **Зачем это зафиксировано.** Неявный контракт мультиплексора был корневой причиной
> бага дешифровки при создании комнаты (служебное `ROOM_NAME_UPDATED` проваливалось в
> путь дешифровки текста → `atob(undefined)`). Разбор:
> [room-create-decryption-fix/ANALYSIS.md](../archive/improvements/room-create-decryption-fix/ANALYSIS.md) §2, §4.

Ниже — детальные payload'ы каждого служебного события (`SET_ROOM_NAME`, `SET_ROOM_TTL`,
`ROOM_ROLE_UPDATED`, и т.д.).

---

### ROOM_MESSAGES (текст / медиа)

**Отправка:** `/app/room.message.send` (`SendRoomMessageRequest` — те же файловые поля, что у DM).

**Ack отправителю:** `/user/queue/room-message-sent` (`RoomMessageSentEvent`). При отказе модерации:
`error` = `MUTED` (отправитель в `room_muted:{roomId}`) или `ROOM_READ_ONLY` (комната в режиме read-only и отправитель не owner).
Сообщение **не** записывается в offline-очередь.

**Fan-out:** `/topic/room/{roomId}` — `NewRoomMessageEvent`:

**Subscribe guard (IMP-ROOM-22):** клиент **обязан** быть аутентифицирован (`AppPrincipal` на STOMP-сессии)
и членом комнаты (`room_members:{roomId}`) для `SUBSCRIBE /topic/room/{roomId}`. Иначе сервер
отклоняет подписку STOMP ERROR (не регистрирует subscription; WebSocket остаётся открытым):

- без principal — код `AUTH_ERROR` в теле/заголовке сообщения (IMP-ROOM-30);
- без membership — код `NOT_MEMBER` в теле/заголовке сообщения (IMP-ROOM-29).

Guard дополняет, но не заменяет обязательный rekey после kick/ban. Подписки на `/user/queue/*` не затрагиваются.

**Force-unsubscribe (IMP-ROOM-25):** после успешного `/app/room.kick`, `/app/room.ban` или `/app/room.leave` сервер
снимает **все** активные подписки удалённого участника на `/topic/room/{roomId}` через
`SubscriptionRegistry` (все STOMP-сессии пользователя). Это закрывает окно, когда подписка была
открыта до kick/leave и продолжала получать ciphertext до client disconnect. Re-subscribe по-прежнему
блокируется subscribe-guard (`NOT_MEMBER`).

| Поле | Тип | Описание |
|------|-----|----------|
| `senderInternalId` | string | **Primary** — canonical sender |
| `senderTgId` | number? | Deprecated; `null` для wallet-only |
| `senderName` | string? | Display name из каталога |
| `messageId`, `roomId`, `encryptedContent`, `iv` | — | Как у DM |
| `type`, `fileId`, … | — | Медиа-поля при `type != text` |

**Sync:** `/app/room.message.sync` → `/user/queue/room-sync-messages` (`SyncRoomMessagesEvent` с `senderInternalId`).

**Edit/delete:** события `RoomMessageEditedEvent`, `RoomMessageDeletedEvent` с `deletedByInternalId` (+ optional `deletedByTgId`).

Проверка членства: `roomMembersRepository.isMember(roomId, internalId)`.

---

### GET_ROOM_MEMBERS (`/app/room.getMembers`)

**Запрос:** Client → Server, body `{ "roomId": "string" }`. Только член комнаты.

**Ответ:** Server → Client, destination `/user/queue/room-members` (`RoomMembersListEvent`).

**Success:**

```json
{
  "success": true,
  "roomId": "uuid-v4",
  "members": [
    {
      "internalId": "uuid-or-tg-prefixed-id",
      "displayName": "Alice",
      "username": null,
      "role": "owner"
    },
    {
      "internalId": "another-internal-id",
      "displayName": "UQCD...xyz",
      "role": "member"
    }
  ]
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `members` | array | Обогащённые участники (breaking change: раньше `string[]` internalId) |
| `members[].internalId` | string | Стабильный internal id |
| `members[].displayName` | string? | Имя из каталога `user:{internalId}`; опущено для неизвестных |
| `members[].username` | string? | Telegram username (каталог пока не хранит — часто `null`) |
| `members[].role` | enum | `owner` если `internalId == room.ownerInternalId`; `admin` если overlay в `room_roles`; иначе `member` |
| `members[].joinedAt` | number? | Не заполняется (Redis Set не хранит время вступления) |

**Error:** `{ "success": false, "error": "NOT_MEMBER | ROOM_NOT_FOUND | INTERNAL_ERROR" }`

---

### GET_ROOM_PRESENCE (`/app/room.getPresence`)

**Запрос:** Client → Server, body `{ "roomId": "string" }`. Только член комнаты.

**Ответ:** Server → Client, destination `/user/queue/room-presence` (`RoomPresenceEvent.Snapshot`).

**Success:**

```json
{
  "success": true,
  "roomId": "uuid-v4",
  "members": [
    {
      "internalId": "uuid-or-tg-prefixed-id",
      "online": true,
      "lastSeen": 1710000000000
    }
  ]
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `members[].internalId` | string | Стабильный internal id |
| `members[].online` | boolean | Активное WS-соединение (глобальный heartbeat, 30s TTL) |
| `members[].lastSeen` | number? | Epoch ms, округление до минуты; опущено если presence ещё не наблюдался |

**Live updates:** Server → Client broadcast на `/topic/room/{roomId}` — `RoomPresenceEvent`
(`roomId`, `internalId`, `online`, `lastSeen`) при connect / subscribe / disconnect члена.

**Error:** `{ "success": false, "error": "NOT_MEMBER | ROOM_NOT_FOUND | INTERNAL_ERROR" }`

> **Metadata leak:** presence раскрывает, кто когда был активен в комнате. См. [SECURITY.md](./SECURITY.md#room-presence-metadata).

---

### KICK_MEMBER (`/app/room.kick`)

**Направление:** Client → Server (owner or admin; admin may kick members only)

**Запрос** (`KickMemberRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `targetInternalId` | string | Да | Internal ID участника для удаления |

**Ответ инициатору (IMP-ROOM-23):** `/user/queue/room-kick-result` (`RoomKickResultEvent`) — ровно одно
событие на каждый запрос kick (success или failure).

**Success:**
```json
{
  "success": true,
  "roomId": "uuid-v4",
  "targetInternalId": "internal-id"
}
```

**Failure:**
```json
{
  "success": false,
  "roomId": "uuid-v4",
  "targetInternalId": "internal-id",
  "error": "NOT_OWNER | CANNOT_KICK_SELF | CANNOT_KICK_OWNER | CANNOT_KICK_ADMIN | NOT_MEMBER | ROOM_NOT_FOUND | RATE_LIMITED | INTERNAL_ERROR"
}
```

**Серверный cleanup:** SREM `room_members` / `member_rooms`; HDEL `room_member_pubkey`; DEL `room_join_request:{roomId}:{target}`; HDEL bundle жертвы во **всех** эпохах `room_keys:{roomId}:{epoch}`; **force-unsubscribe** с `/topic/room/{roomId}` для всех STOMP-сессий жертвы (IMP-ROOM-25).

**События после успешного кика:**

| Событие | Destination | Получатель | Поля |
|---------|-------------|------------|------|
| `ROOM_KICKED` | `/user/queue/room-kicked` | Жертва | `roomId`, `byInternalId` |
| `ROOM_MEMBER_REMOVED` | `/user/queue/room-member-removed` | Каждый оставшийся член (включая owner) | `roomId`, `removedInternalId` |
| `ROOM_KICK_RESULT` | `/user/queue/room-kick-result` | Инициатор (owner) | `success`, `roomId`, `targetInternalId`, `error?` |

Владелец **обязан** выполнить rekey после `ROOM_MEMBER_REMOVED` (см. [SECURITY.md](./SECURITY.md) — forward secrecy при kick).

Rate-limit: `SESSION_ACTION` (10/min), как у ban/mute (`RoomHandler.enforceRateLimit`). У `room.acceptJoin` / `room.rejectJoin` отдельного `SESSION_ACTION` нет — они попадают в `GENERAL` через interceptor.

---

### BAN_MEMBER (`/app/room.ban`)

**Направление:** Client → Server (owner-only)

**Запрос** (`BanMemberRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `targetInternalId` | string | Да | Internal ID участника для бана |

Логически = kick (IMP-ROOM-03) **+** запись в `room_bans:{roomId}`. Жертва удаляется из membership
и получает те же события, что при kick (`ROOM_KICKED`, `ROOM_MEMBER_REMOVED` остальным); инициатору —
`ROOM_KICK_RESULT` на `/user/queue/room-kick-result`.

**Ошибки:** те же, что у `KICK_MEMBER` (`NOT_OWNER`, `CANNOT_KICK_SELF`, `CANNOT_KICK_OWNER`,
`NOT_MEMBER`, `ROOM_NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`).

**Серверный cleanup:** как у kick + `SADD room_bans:{roomId} {targetInternalId}`; force-unsubscribe
с `/topic/room/{roomId}` (IMP-ROOM-25).

Забаненный `internalId` не может повторно вступить (`requestJoin` / `acceptJoin`) → `USER_BANNED`.

Rate-limit: `SESSION_ACTION` (10/min).

---

### UNBAN_MEMBER (`/app/room.unban`)

**Направление:** Client → Server (owner-only)

**Запрос:** тот же payload, что у ban — `{ "roomId": "string", "targetInternalId": "string" }`
(`BanMemberRequest`).

**Сервер:** `SREM room_bans:{roomId} {targetInternalId}`. Отдельный user-queue ack не предусмотрен
(fire-and-forget); ошибки логируются (`NOT_OWNER`, `ROOM_NOT_FOUND`).

---

### GET_ROOM_BANS (`/app/room.getBans`)

**Направление:** Client → Server (owner-only)

**Запрос:** `{ "roomId": "string" }` (тот же shape, что у `GET_ROOM_MEMBERS`).

**Ответ:** `/user/queue/room-bans` (`RoomBanListEvent`):

```json
{
  "success": true,
  "roomId": "uuid-v4",
  "bans": ["internal-id-1", "internal-id-2"]
}
```

**Error:** `{ "success": false, "error": "NOT_OWNER | ROOM_NOT_FOUND | INTERNAL_ERROR" }`

---

### MUTE_MEMBER (`/app/room.mute`)

**Направление:** Client → Server (owner or admin; admin may mute members only)

**Запрос** (`MuteMemberRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `targetInternalId` | string | Да | Internal ID участника для mute |

Участник **остаётся** в `room_members`; сервер добавляет `internalId` в `room_muted:{roomId}`.
Rekey **не** требуется.

**Ошибки (лог):** `NOT_OWNER`, `CANNOT_KICK_SELF`, `CANNOT_KICK_OWNER`, `CANNOT_KICK_ADMIN`, `NOT_MEMBER`, `ROOM_NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`.

**Событие после успеха:** `ROOM_MODERATION` на `/topic/room/{roomId}` (`RoomModerationEvent` с `mutedAdded`).

Rate-limit: `SESSION_ACTION` (10/min).

---

### UNMUTE_MEMBER (`/app/room.unmute`)

**Направление:** Client → Server (owner or admin)

**Запрос:** тот же payload, что у mute — `{ "roomId": "string", "targetInternalId": "string" }`
(`MuteMemberRequest`).

**Сервер:** `SREM room_muted:{roomId} {targetInternalId}`. При успешном удалении — broadcast
`ROOM_MODERATION` с `mutedRemoved` на `/topic/room/{roomId}`.

---

### SET_READ_ONLY (`/app/room.setReadOnly`)

**Направление:** Client → Server (owner or admin)

**Запрос** (`SetReadOnlyRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `readOnly` | boolean | Да | `true` — постят owner и admin; member получает `ROOM_READ_ONLY` |

**Сервер:** `HSET room:{roomId} readOnly {true|false}`; broadcast `ROOM_MODERATION` с полем `readOnly`.

**Send enforce:** member при `readOnly=true` → `/user/queue/room-message-sent` с `error=ROOM_READ_ONLY`.
Owner и admin могут отправлять в read-only.

---

### SET_ROLE (`/app/room.setRole`)

**Направление:** Client → Server (owner-only)

**Запрос** (`SetRoleRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `targetInternalId` | string | Да | Internal ID члена |
| `role` | enum | Да | `admin` или `member` (снятие overlay) |

**Сервер:** owner-only; target ∈ `room_members`; нельзя менять роль owner; `admin` → `HSET room_roles`;
`member` → `HDEL room_roles`. Broadcast `ROOM_ROLE_UPDATED` на `/topic/room/{roomId}`.

**Ошибки (лог):** `NOT_OWNER`, `NOT_MEMBER`, `CANNOT_SET_ROLE_ON_OWNER`, `INVALID_ROLE`, `ROOM_NOT_FOUND`.

---

### ROOM_ROLE_UPDATED (topic event)

**Destination:** `/topic/room/{roomId}`

```json
{
  "eventType": "ROOM_ROLE_UPDATED",
  "roomId": "uuid-v4",
  "targetInternalId": "internal-id",
  "role": "admin"
}
```

---

---

### SET_ROOM_TTL (`/app/room.setTtl`)

**Направление:** Client → Server (owner-only)

**Запрос** (`SetRoomTtlRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `ttlSeconds` | number | Нет* | Относительный срок жизни в секундах от «сейчас» |
| `autoBurnAt` | number | Нет* | Абсолютный момент auto-burn (Unix epoch ms) |

\* Требуется **ровно одно** из `ttlSeconds` или `autoBurnAt`. Если заданы оба — используется `autoBurnAt`.

**Сервер:** owner-only; `HSET room:{roomId} autoBurnAt {value}`; `EXPIRE room:{roomId}` до дедлайна (cap);
`SET room:autoburn:{roomId}` с TTL до дедлайна (trigger, не продлевается активностью).

**Ошибки (лог):** `NOT_OWNER`, `ROOM_NOT_FOUND`, `TTL_OR_AUTOBURN_REQUIRED`, `INVALID_TTL`,
`AUTO_BURN_IN_PAST`, `INTERNAL_ERROR`.

**Событие после успеха:** `ROOM_TTL_UPDATED` на `/topic/room/{roomId}`.

---

### ROOM_TTL_UPDATED (topic event)

**Destination:** `/topic/room/{roomId}`

```json
{
  "eventType": "ROOM_TTL_UPDATED",
  "roomId": "uuid-v4",
  "autoBurnAt": 1706745600000
}
```

**Auto-burn:** по истечении `room:autoburn:{roomId}` сервер выполняет тот же каскад, что и
`/app/room.burn`, и рассылает `ROOM_BURNED` на `/user/queue/room-burned` каждому члену.

---

### SET_MESSAGE_TTL (`/app/room.setMessageTtl`)

**Направление:** Client → Server (owner-only)

**Запрос** (`SetMessageTtlRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `messageTtlSeconds` | number | Да | Таймер самоуничтожения сообщений в секундах; `0` = выкл |

**Сервер:** owner-only; `HSET room:{roomId} messageTtl {value}`; немедленный lazy prune
`messages:{roomId}`; broadcast события.

**Ошибки (лог):** `NOT_OWNER`, `ROOM_NOT_FOUND`, `INVALID_MESSAGE_TTL`, `INTERNAL_ERROR`.

**Событие после успеха:** `ROOM_MESSAGE_TTL_UPDATED` на `/topic/room/{roomId}`.

---

### ROOM_MESSAGE_TTL_UPDATED (topic event)

**Destination:** `/topic/room/{roomId}`

```json
{
  "eventType": "ROOM_MESSAGE_TTL_UPDATED",
  "roomId": "uuid-v4",
  "messageTtlSeconds": 3600
}
```

---

### TRANSFER_OWNERSHIP (`/app/room.transferOwnership`)

**Направление:** Client → Server (owner-only)

**Запрос** (`TransferOwnershipRequest`):

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | string | Да | UUID комнаты |
| `newOwnerInternalId` | string | Да | Internal ID действующего члена, который станет владельцем |

**Сервер:** проверка owner-only; `newOwnerInternalId` ∈ `room_members`; атомарно
`HSET room:{roomId} ownerInternalId {newOwnerInternalId}`; предыдущий владелец →
`HSET room_roles:{roomId} {previousOwner} admin`; `HDEL room_roles:{roomId} {newOwner}`.
**Rekey не требуется** — новый владелец уже член с групповым ключом.

**Ошибки (лог):** `NOT_OWNER`, `NOT_MEMBER`, `CANNOT_TRANSFER_TO_SELF`, `ROOM_NOT_FOUND`, `INTERNAL_ERROR`.

**Событие после успеха:** `ROOM_OWNERSHIP_TRANSFERRED` на `/topic/room/{roomId}`.

---

### ROOM_OWNERSHIP_TRANSFERRED (topic event)

**Destination:** `/topic/room/{roomId}`

```json
{
  "eventType": "ROOM_OWNERSHIP_TRANSFERRED",
  "roomId": "uuid-v4",
  "newOwnerInternalId": "internal-id-new-owner",
  "previousOwnerInternalId": "internal-id-previous-owner"
}
```

---

### ROOM_MODERATION (topic event)

**Destination:** `/topic/room/{roomId}`

```json
{
  "eventType": "ROOM_MODERATION",
  "roomId": "uuid-v4",
  "readOnly": false,
  "mutedAdded": "internal-id",
  "mutedRemoved": null
}
```

| Поле | Описание |
|------|----------|
| `readOnly` | Текущий флаг read-only после изменения |
| `mutedAdded` | При mute — internalId добавленного |
| `mutedRemoved` | При unmute — internalId удалённого |

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

**Error** (на `/user/queue/room-created` код эмитит только `INTERNAL_ERROR`):
```json
{
  "success": false,
  "error": "INTERNAL_ERROR"
}
```

Валидация запроса → `VALIDATION_ERROR` на `/user/queue/errors`; превышение STOMP rate-limit → `RATE_LIMIT_EXCEEDED` там же (см. Rate Limits выше). На `room-created` эти коды **не** приходят.

---

## Связанные документы

- [DATA_MODELS.md](./DATA_MODELS.md) — структуры данных в Redis
- [SECURITY.md](./SECURITY.md) — криптография
- [ARCHITECTURE.md](./ARCHITECTURE.md) — общая архитектура

