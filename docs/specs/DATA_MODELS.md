# Структуры данных

> Модели данных Redis, Java DTO и TypeScript интерфейсы

## 📋 Содержание

- [Redis Schema](#redis-schema)
- [Формат кодировки шифртекста (encoding contract)](#формат-кодировки-шифртекста-encoding-contract)
- [Java DTOs](#java-dtos)
- [TypeScript Interfaces](#typescript-interfaces)
- [Валидация данных](#валидация-данных)

---

## Redis Schema

### Обзор ключей

Полная инвентаризация **48 семейств** Redis-ключей (источник истины — код).
Детальные разделы ниже — для наиболее часто используемых паттернов; остальные
сводятся в таблицу.

| Ключ / паттерн | Тип | TTL (default) | Назначение |
|----------------|-----|---------------|------------|
| `auth_tg:{telegramId}` | string | 90d | tgId → `internalId` |
| `auth_wallet:{walletAddress}` | string | 90d | wallet → `internalId` |
| `user:{internalId}` | hash | 90d | Канонический профиль (`UserIdentityRepository`) |
| `user:{tgId}` | hash | **7d** | Legacy TG-кэш (`UserRepository`); см. §ниже |
| `lang:pref:{userId}` | string | 90d | Языковые предпочтения |
| `session:{sessionId}` | hash | 24h | Метаданные DM-сессии |
| `session_token:{token}` | string | 1h | Одноразовый resume-token → `internalId` |
| `request:{recipientInternalId}` | list | 5min | Входящие заявки на чат |
| `online:{internalId}` | string | 30s | Heartbeat presence |
| `messages:{recipientId}:{sessionId}` | list | 24h | Offline-очередь DM (E2EE blobs) |
| `messages:count:{recipientId}` | string | ⚠️ expire при `count==1` | Счётчик pending DM |
| `dm-editable:{sessionId}:{messageId}` | string | **20min** | Meta окна правки DM |
| `message-senders:{sessionId}` | hash | 24h | Индекс отправителя для delete-for-everyone |
| `message-edits:{recipientId}:{sessionId}` | list | 1h | Tombstone-очередь правок (offline sync, per-recipient) |
| `message-deletions:{recipientId}:{sessionId}` | list | 1h | Tombstone-очередь удалений (offline sync, per-recipient) |
| `messages:{roomId}` | list | 24h | Очередь сообщений комнаты |
| `ratelimit:{type}:{userId}` | string | окно типа | STOMP rate-limit (`RateLimitService`) |
| `ratelimit:rest:{group}:{clientId}` | string | окно группы | REST rate-limit |
| `filedownload:active:{internalId}` | string | 30min | Слот-счётчик активных скачиваний |
| `file_meta:{fileId}` | hash | 24h | Метаданные зашифрованного blob |
| `file_context:{contextId}` | set | 24h | Индекс `fileId` по session/room |
| `pow:challenge:{challengeId}` | hash | 60s | PoW challenge (action + difficulty) |
| `pow:spent:{challengeId}` | string | 120s | One-time spent marker (SET NX) |
| `pow:abuse:global` | hash | 60s | Глобальные счётчики adaptive difficulty |
| `auth_nonce:{nonce}` | string | 5min | TON proof nonce |
| `wallet_tg_link:{challengeId}` | string | 15min | Wallet↔Telegram link challenge |
| `room:{roomId}` | hash | 30d | Метаданные комнаты |
| `room:autoburn:{roomId}` | string | до `autoBurnAt` | Trigger auto-burn (не refresh) |
| `user:deadman:{internalId}` | string | `periodDays` | Dead man's switch trigger (refresh на connect) |
| `user:deadman:cfg:{internalId}` | string | **нет TTL** | `{ periodDays, wipeIdentity }` — удаляется при disable/expiry |
| `room_members:{roomId}` | set | 30d | Участники (internalId) |
| `member_rooms:{internalId}` | set | 30d | Reverse-index комнат пользователя |
| `room_keys:{roomId}:{epoch}` | hash | **7d** | Wrapped group keys |
| `room_key_epoch:{roomId}` | string | 30d | Текущий epoch rekey |
| `room_member_pubkey:{roomId}` | hash | 30d | internalId → SPKI pubkey |
| `room_bans:{roomId}` | set | 30d | Банлист комнаты |
| `room_muted:{roomId}` | set | 30d | Mute-лист комнаты |
| `room_roles:{roomId}` | hash | 30d | internalId → `admin` \| `member` |
| `room_presence:{roomId}` | hash | 10min | lastSeenMs (не refresh с room TTL) |
| `room_join_request:{roomId}:{sender}` | hash | 24h | Заявка BY_REQUEST |
| `room_join_requests:{roomId}` | set | 24h | Индекс senderInternalId |
| `invite:{token}` | hash | до `expiresAt` | Инвайт-токен |
| `room_invites:{roomId}` | set | ❌ **нет TTL** (баг F-1) | Reverse-index токенов |
| `ton:rpc:{addr}:{method}:{argsHash}` | string | 60s | Кэш TON RPC |
| `ton:jetton:balance:v1:{wc}:{hex}` | string | 30s | Jetton balance cache |
| `ton:jetton:info:v1:{wc}:{hex}` | string | 1h | Jetton master info |
| `ton:jetton:fees:v1:{wc}:{hex}` | string | 5min | Effective fee params |
| `ton:staking:profile\|lock\|tiercfg:v1:{wc}:{hex}` | string | 30s / 1h | Staking-кэш |
| `ton:governance:summary\|detail:v1:{id}` | string | 30s | Governance proposal-кэш |
| `health:test:{timestamp}` | string | 10s | Redis health probe |

> **Planned (не реализовано):** `blocked:{tgId}` — user-block list; в backend 0
> вхождений (DM-3). Не создавать ключ до появления карточки фичи.

---

### `session:{sessionId}`

Метаданные активной DM-сессии. Участники адресуются по **`internalId`** (UUID-строка).

```redis
HSET session:abc123
  id                      "abc123"
  initiatorInternalId     "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33"
  initiatorTelegramId     "111222333"
  responderInternalId     "f74f67a1-2b3c-4d5e-8f90-abcdef123456"
  responderTelegramId     ""
  status                  "active"
  createdAt               "1704067200000"
  lastActivityAt          "1704067300000"
  secretQuestion          "Как звали моего кота?"
  secretAnswerHash        "e3b0c44298fc1c149..."
  initiatorVerified       "true"
  responderVerified       "false"

EXPIRE session:abc123 86400
```

| Поле | Тип | Описание |
|------|-----|----------|
| `initiatorInternalId` | string | internalId создателя заявки |
| `initiatorTelegramId` | string? | Telegram ID создателя; пусто для wallet-only |
| `responderInternalId` | string | internalId получателя |
| `responderTelegramId` | string? | Telegram ID получателя; пусто для wallet-only |
| `status` | enum | `pending` \| `handshake` \| `active` \| `burned` \| `expired` |
| `secretAnswerHash` | string? | Base64(SHA-256) нормализованного ожидаемого ответа (`trim` → `toLowerCase`) |

Проверка участника: `session.isParticipant(internalId)`. Peer: `session.getPeerInternalId(myInternalId)`.

**TTL:** по умолчанию 24 часа (`session.active.ttl` в `application.yml`).

---

### Offline message queue (DM)

Очередь зашифрованных сообщений для получателя, если он офлайн в момент доставки.

| Ключ | Тип | Описание |
|------|-----|----------|
| `messages:{recipientInternalId}:{sessionId}` | List | JSON сериализованных `Message` (E2EE blob), порядок FIFO |
| `messages:count:{recipientInternalId}` | String | Суммарный счётчик не доставленных сообщений по всем сессиям пользователя |

**TTL `messages:count:*`:** EXPIRE выставляется только при переходе счётчика в `1`
(инициализация); при последующих INCR ключ может остаться без refresh (DM-15).

**TTL и cap:** задаются в `burnedchats.messages.offline-queue` (`ttl`, `max-size-per-session`). Значения не должны превышать TTL метаданных сессии (`session.active.ttl`). При переполнении список обрезается с головы (старые сообщения отбрасываются); сервер ведёт метрики Micrometer `burnedchats.offline_queue.*` (без идентификаторов пользователей в тегах).

#### `dm-editable:{sessionId}:{messageId}`

Краткоживущая meta для проверки владения DM-сообщением и окна правки после
выхода сообщения из offline-очереди (доставлено онлайн).

| Поле JSON | Тип | Описание |
|-----------|-----|----------|
| `senderInternalId` | String | Стабильный UUID отправителя (primary для wallet) |
| `senderId` | Long | Legacy Telegram id; фолбэк для старых записей |
| `serverTimestamp` | Instant | Якорь окна правки |
| `fileId` / `thumbnailFileId` | String | Опционально для file-сообщений (delete/burn) |

**TTL:** `burnedchats.messages.message-edits.editable-meta-ttl` — **20 мин**
(`MessagesProperties`, default; код — источник истины, DM-2).

#### `message-senders:{sessionId}`

Hash индекс отправителя для DM delete-for-everyone (доставленные/ранее queued сообщения).

| Поле hash | Значение JSON | Описание |
|-----------|---------------|----------|
| `{messageId}` | `MessageSenderIndexEntry` | Сериализованный JSON |

| Поле JSON | Тип | Описание |
|-----------|-----|----------|
| `senderInternalId` | String | Стабильный UUID отправителя (primary для wallet) |
| `senderId` | Long | Legacy Telegram id; только если `!= null && != 0` |

**Legacy read-path:** plain numeric string в hash value трактуется как `senderId` only;
строка `"null"` или невалидное значение → index считается пустым (fallback на
`dm-editable` meta).

**TTL:** `burnedchats.messages.sender-index-ttl` (по умолчанию 24 ч).

---

### `request:{recipientInternalId}`

Очередь входящих запросов на чат. Ключ — **`recipientInternalId`** (UUID получателя), не Telegram ID.

```redis
LPUSH request:f74f67a1-2b3c-4d5e-8f90-abcdef123456 '{
  "sessionId": "abc123",
  "senderInternalId": "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33",
  "senderTgId": 111222333,
  "senderUsername": "alice",
  "senderFirstName": "Alice",
  "recipientInternalId": "f74f67a1-2b3c-4d5e-8f90-abcdef123456",
  "hasQuestion": true,
  "question": "Как звали моего кота?",
  "createdAt": "2024-01-15T10:30:00Z"
}'

EXPIRE request:f74f67a1-2b3c-4d5e-8f90-abcdef123456 300
```

`ChatRequest.getRecipientKey()` всегда возвращает `recipientInternalId`. Legacy записи с ключом `request:{tgId}` не мигрируются (TTL 5 мин).

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

### `user:{internalId}` — канонический каталог (`UserIdentityRepository`)

Единый профиль пользователя под stable `internalId`. Заполняется при REST wallet-auth и STOMP CONNECT **любого** типа принципала.

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

Wallet-only пример (`authType: WALLET`, `telegramId` пуст):

```redis
HSET user:a1b2c3d4-e5f6-7890-abcd-ef1234567890
  internalId    "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  authType      "WALLET"
  displayName   "EQBx...7JfP"
  telegramId    ""
  walletAddress "EQBx7..."
```

**Legacy Telegram cache** (`UserRepository`): отдельный hash `user:{tgId}` для быстрого
поиска по `@username` / TG ID. Содержит optional поле `internalId` для обогащения
`UserResponse`. Wallet-only записи **не** дублируются в `user:{tgId}`.

**TTL:** канонический `user:{internalId}` — **90 дней** (обновляется при каждом входе);
legacy `user:{tgId}` — **7 дней** (`UserRepository.DEFAULT_TTL`, DM-6).

### `auth_tg:{telegramId}` / `auth_wallet:{walletAddress}`

Маппинги внешней аутентификации на единый `internalId`:

```redis
SET auth_tg:111222333 "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33"
SET auth_wallet:EQ... "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33"
EXPIRE auth_tg:111222333 7776000
EXPIRE auth_wallet:EQ... 7776000
```

#### Жизненный цикл при `burnAllForUser` (IMP-BURNALL-01)

| Ключ / паттерн | `wipeIdentity=false` | `wipeIdentity=true` | Примечание |
|----------------|----------------------|---------------------|------------|
| `session:{sessionId}` | `DEL` (все активные сессии пользователя) | то же | + `BurnSignalEvent` пирам |
| `messages:{internalId}:*`, `message-edits:*`, `message-deletions:*` | `DEL` очереди пользователя | то же | tombstone + offline |
| `request:{internalId}` | `DEL` | то же | pending chat requests |
| `file_context:{sessionId\|roomId}` | `DEL` (затронутые контексты) | то же | через `FileBurnService` |
| `room:{roomId}` + room-* (owned) | полный BURN_ROOM каскад | то же | `RoomBurnedEvent` участникам |
| `room_members:*` / pubkey / keys (member leave) | remove user из чужих комнат | то же | `room-member-left` → owner rekey |
| `member_rooms:{internalId}` | сохраняется | `DEL` | reverse index |
| `user:{internalId}` | сохраняется | `DEL` | профиль |
| `auth_tg:*` / `auth_wallet:*` | сохраняются | `DEL` привязок пользователя | |
| `lang:pref:{internalId}` | сохраняется | `DEL` | |
| `session_token:*` (значение = internalId) | сохраняются | `DEL` matching tokens | SCAN |
| `user:deadman:{internalId}` / `user:deadman:cfg:{internalId}` | не трогаются каскадом | не трогаются | listener идемпотентен; disable — через `/app/user.setDeadman` |
| `ratelimit:rest:burn_all:{internalId}` | INCR / TTL 60s | то же | 3 req/min |

Порядок: сначала сущности общения (1–4), identity — последним (5), ack клиенту после каскада.

---

### `ratelimit:{type}:{userId}`

Rate limiting counters (STOMP и shared identity). Префикс **`ratelimit:`**
(`RateLimitService.KEY_PREFIX`, DM-1).

```redis
INCR ratelimit:message:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33
EXPIRE ratelimit:message:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33 60
```

| Type (`RateLimitType`) | Окно | Max (default) | Примечание |
|------------------------|------|---------------|------------|
| `search` | 60s | 10 | |
| `session_create` | **60s** | **3** | DM-1: было 300s в старой спеке |
| `message` | 60s | **60** | override: `rate-limit.messages.per-minute` |
| `session_action` | 60s | 10 | accept/reject |
| `handshake` | 60s | 10 | key exchange |
| `file_upload` | 60s | 10 | |
| `general` | 60s | 100 | |
| `message_edit` | 60s | 10 | |
| `message_delete` | 60s | 30 | |
| `pow_challenge` | 60s | 10 | issuance flood guard |
| `room_read` | 60s | 30 | getMembers/getPresence/getBans |
| `room_password_fail` | 600s | 5 | override: `rate-limit.room-password-fail.*`; см. сноску ниже |

> **`room_password_fail` (составной ключ):** Redis-ключ —
> `ratelimit:room_password_fail:{roomId}:{internalId}`
> (`RoomJoinService.passwordFailKey` → `RateLimitService`). INCR выполняется
> **только при неудачном** password proof; успешный proof сбрасывает счётчик
> (`resetRateLimit`). Локаут снимается по TTL окна (600 с / override yaml).

Отдельный REST-префикс: `ratelimit:rest:{group}:{clientId}` (IP / identity).
Группа `burn_all` — `/app/user.burnAll`, 3 req/min per `internalId`.

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

### Phase 5: Staking (`StakingVerifier`)

| Шаблон ключа | TTL | Значение |
|--------------|-----|----------|
| `ton:staking:profile:v1:{workchain}:{hex}` | 30 с | JSON `UserStakingProfile` |
| `ton:staking:lock:v1:{workchain}:{hex}` | 1 ч | Адрес `StakingLock` для данного staking-master |
| `ton:staking:tiercfg:v1:{workchain}:{hex}` | 1 ч | Кэш tier config, прочитанного с lock-контракта |

---

## Phase 2: Комнаты (Redis)

> Ниже — целевые структуры ключей.

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
  nameEncrypted   "base64..."     # опционально; opaque ciphertext
  nameIv          "base64..."     # опционально; 12-byte GCM IV
  readOnly        "false"         # опционально; true = только owner постит
  autoBurnAt      "1706745600000" # опционально; epoch ms дедлайна auto-burn (IMP-ROOM-16)
  messageTtl      "3600"          # опционально; секунды автоуничтожения сообщений; 0 = выкл (IMP-ROOM-18)

EXPIRE room:uuid-room-1 2592000
```

| Поле | Тип | Описание |
|------|-----|----------|
| `ownerInternalId` | string | internalId владельца (UUID). При чтении из Redis: если поле пустое или содержит только цифры (legacy), нормализуется через `InternalIds.forTelegramId` там, где это безопасно согласовать с `ownerTgId` |
| `ownerTgId` | string | Telegram ID владельца (compat для текущих DTO) |
| `salt` | string | Salt для KDF (Base64). Пустая строка, если комната без пароля (BY_REQUEST) |
| `passwordProofHash` | string | Хеш proof. Пустая строка, если комната без пароля |
| `joinMode` | enum | `by_password` \| `by_request` |
| `createdAt` | number | Unix timestamp в мс |
| `nameEncrypted` | string | Зашифрованное имя комнаты (AES-GCM ciphertext, Base64). Пустая строка = не задано. Сервер не расшифровывает |
| `nameIv` | string | Base64 IV для `nameEncrypted` (12 bytes). Пустая строка = не задано |
| `readOnly` | boolean | Режим «только чтение»: при `true` отправлять сообщения может только владелец. По умолчанию `false` (отсутствие поля) |
| `autoBurnAt` | number | Опционально: абсолютный момент auto-burn (Unix ms). Задаётся owner через `/app/room.setTtl`. При наличии activity-продление TTL hash-ключа **капится** этим instant; детерминированный burn — по trigger key ниже |
| `messageTtl` | number | Опционально: таймер самоуничтожения сообщений комнаты в **секундах**; `0` или отсутствие поля = выкл (только глобальный TTL list `messages:{roomId}`). Задаётся owner через `/app/room.setMessageTtl` (IMP-ROOM-18) |

**TTL:** 30 дней (продлевается при активности, в т.ч. при `/app/room.setName`), но **не выше** `autoBurnAt`, если поле задано.

### `room:autoburn:{roomId}`

Dedicated trigger key (string value = `roomId`), TTL = `autoBurnAt - now`. **Не** продлевается активностью. При истечении Redis keyspace listener выполняет полный каскад BURN_ROOM и рассылает `ROOM_BURNED` (IMP-ROOM-16).

```redis
SET room:autoburn:uuid-room-1 uuid-room-1 EX 3600
```

| Операция | Описание |
|----------|----------|
| setTtl | `SET` + `EX`/`PX` до `autoBurnAt` |
| Manual burn / auto-burn cascade | `DEL` trigger key вместе с остальными ключами комнаты |
| Activity | trigger key **не** обновляется |

### `user:deadman:{internalId}` / `user:deadman:cfg:{internalId}`

Dead man's switch (IMP-BURNALL-04): если пользователь не подключался `periodDays` дней,
срабатывает полный каскад `burnAllForUser` с сохранённым `wipeIdentity`.

Паттерн — две связанные ключи (как `room:autoburn` + данные комнаты):

```redis
SET user:deadman:cfg:tg:111222333 '{"periodDays":30,"wipeIdentity":false}'
SET user:deadman:tg:111222333 tg:111222333 EX 2592000
```

| Ключ | TTL | Описание |
|------|-----|----------|
| `user:deadman:{internalId}` | `periodDays` × 86400s | Trigger; value = `internalId`. **Refresh** на каждый успешный STOMP CONNECT |
| `user:deadman:cfg:{internalId}` | **нет** (единственное «вечное» исключение в фиче) | JSON `{ periodDays: 7\|30\|90, wipeIdentity: boolean }`. `DEL` при disable или после срабатывания |

**Срабатывание:** Redis keyspace `expired` на trigger key → `DeadmanRedisKeyspaceConfig` →
`UserBurnService.burnAllForUser(internalId, wipeIdentity из cfg)` → `DEL cfg`.
Точность — «примерно в момент expiry» (зависит от `notify-keyspace-events` и нагрузки Redis);
для периодов в днях это приемлемо.

**Идемпотентность:** если пользователь уже сжёг данные вручную (`/app/user.burnAll`),
listener не падает — cfg может отсутствовать или каскад завершится с пустым результатом.

**Disable:** `/app/user.setDeadman { enabled: false }` → `DEL` обоих ключей.

### `room_members:{roomId}`

Участники комнаты (Set internalId).

```redis
SADD room_members:uuid-room-1 "d2f44f7b-..." "f74f67a1-..."
```

Удаляется при BURN_ROOM.

### `room_bans:{roomId}`

Банлист комнаты (Set internalId). Запрет повторного join для перечисленных identity (IMP-ROOM-09).

```redis
SADD room_bans:uuid-room-1 "f74f67a1-2b3c-4d5e-8f90-abcdef123456"
EXPIRE room_bans:uuid-room-1 2592000
```

| Операция | Описание |
|----------|----------|
| Ban | `SADD` после kick-cleanup (`/app/room.ban`) |
| Unban | `SREM` (`/app/room.unban`) |
| Join enforce | `SISMEMBER` в `requestJoin` / `acceptJoin` → `USER_BANNED` |
| TTL | 30 дней; продлевается при активности комнаты (вместе с `room:{roomId}`) |
| BURN_ROOM | `DEL room_bans:{roomId}` |

### `room_muted:{roomId}`

Список заглушённых участников (Set internalId). Mute **не** удаляет из membership и **не** требует rekey (IMP-ROOM-11).

```redis
SADD room_muted:uuid-room-1 "f74f67a1-2b3c-4d5e-8f90-abcdef123456"
EXPIRE room_muted:uuid-room-1 2592000
```

| Операция | Описание |
|----------|----------|
| Mute | `SADD` (`/app/room.mute`); участник остаётся членом |
| Unmute | `SREM` (`/app/room.unmute`) |
| Send enforce | `SISMEMBER` в `/app/room.message.send` → `MUTED` (без записи в очередь) |
| TTL | 30 дней; продлевается при мутациях |
| BURN_ROOM | `DEL room_muted:{roomId}` |

### `room_presence:{roomId}`

Эфемерный presence участников комнаты (Hash internalId → lastSeenMs). **Только метаданные соединения** — не затрагивает ciphertext сообщений или ключи (IMP-ROOM-20).

```redis
HSET room_presence:uuid-room-1 "f74f67a1-2b3c-4d5e-8f90-abcdef123456" "1710000000000"
EXPIRE room_presence:uuid-room-1 600
```

| Поле / операция | Описание |
|-----------------|----------|
| Значение hash | `lastSeenMs` — epoch millis, **округление вниз до минуты** (privacy) |
| TTL | **10 минут**; ключ не продлевается вместе с lifetime комнаты |
| Connect / subscribe | `HSET` + broadcast `RoomPresenceEvent{ online: true }` на `/topic/room/{roomId}` |
| Disconnect | `HSET` (финальный lastSeen) + broadcast `{ online: false }` |
| Snapshot | `/app/room.getPresence` → `/user/queue/room-presence` (только членам) |
| `online` в snapshot | Глобальный heartbeat (`online:{internalId}`, 30s TTL) ∧ членство |
| BURN_ROOM | `DEL room_presence:{roomId}` (manual burn в `RoomHandler`; auto-burn — TTL fallback) |

### `room_roles:{roomId}`

Overlay ролей участников (Hash internalId → `admin` | `member`). Роль **owner** не хранится в этом ключе — источник истины `room.ownerInternalId` (IMP-ROOM-13).

```redis
HSET room_roles:uuid-room-1 "f74f67a1-2b3c-4d5e-8f90-abcdef123456" "admin"
EXPIRE room_roles:uuid-room-1 2592000
```

| Операция | Описание |
|----------|----------|
| Transfer ownership | `HSET` предыдущему владельцу → `admin`; `HDEL` у нового владельца (owner из `room` hash) |
| Set role (IMP-ROOM-14) | `HSET` / `HDEL` для `admin` \| `member` |
| Role resolve | `roleOf`: owner ← `room.ownerInternalId`; admin ← hash; иначе member |
| TTL | 30 дней; продлевается при мутациях |
| BURN_ROOM | `DEL room_roles:{roomId}` |

Передача владения (`/app/room.transferOwnership`) **не** требует rekey — новый владелец уже член с групповым ключом.

### `invite:{token}`

Инвайт-токен для ссылки приглашения. Обратный индекс: `room_invites:{roomId}` (Set token strings).

```redis
HSET invite:abc123token
  token       "abc123token"
  roomId      "uuid-room-1"
  createdBy   "111222333"
  createdAt   "1704067200000"
  expiresAt   "1704153600000"
  maxUses     "10"
  usedCount   "3"

SADD room_invites:uuid-room-1 "abc123token"
EXPIRE invite:abc123token 604800
```

> **Известный баг (F-1 / DM-5):** `room_invites:{roomId}` пишется **без EXPIRE**
> (`InviteTokenRepository`). Индекс может пережить комнату; фикс — отдельная
> backend-карточка, не scope этой спеки.

| Поле | Тип | Описание |
|------|-----|----------|
| `token` | string | 64-char hex (32 random bytes) |
| `roomId` | string | UUID комнаты |
| `createdBy` | string | Telegram ID создателя; `""` для wallet-only владельца |
| `createdAt` | string (ms) | Unix ms создания токена |
| `expiresAt` | string (ms) | Unix ms истечения |
| `maxUses` | string | Лимит успешных join; пусто = безлимит |
| `usedCount` | string | Счётчик использований (HINCRBY при join) |

**Enforcement (IMP-ROOM-07):**
- При join: `usedCount++` (атомарно); если `usedCount >= maxUses` (и `maxUses > 0`) → токен удаляется (`DEL invite:{token}` + `SREM room_invites:{roomId}`), клиенту `INVITE_EXHAUSTED`.
- При `usedCount >= maxUses` до join → `INVITE_EXHAUSTED`, токен удаляется.
- При `expiresAt < now` → `INVITE_EXPIRED`, токен удаляется.
- Owner-only: `/app/room.revokeInvite`, `/app/room.getInvites`.
- `GET_INVITE_LINK` принимает опциональные `expiresInSeconds`, `maxUses` (0/отсутствует = безлимит).

**TTL:** `EXPIRE` = `expiresAt - now` (default 7 дней при создании без `expiresInSeconds`).

### `room_join_request:{roomId}:{senderInternalId}`

Заявка на вход в комнату (режим `by_request`). Hash на одного заявителя; индекс `room_join_requests:{roomId}` (Set of `senderInternalId`).

```redis
HSET room_join_request:uuid-room-1:f74f67a1-2b3c-4d5e-8f90-abcdef123456
  roomId             "uuid-room-1"
  senderInternalId   "f74f67a1-2b3c-4d5e-8f90-abcdef123456"
  senderTgId         ""
  username           ""
  firstName          "Wallet User"
  publicKey          "base64..."
  createdAt          "1704067200000"

EXPIRE room_join_request:uuid-room-1:f74f67a1-2b3c-4d5e-8f90-abcdef123456 86400
```

Legacy ключи `room_join_request:{roomId}` (list по `senderTgId`) не мигрируются — TTL 24 ч.

**TTL:** 24 часа

### `room_keys:{roomId}:{epoch}`

Зашифрованные копии группового ключа для участников (opaque blobs). Индекс получателя — `recipientInternalId` в `EncryptedKeyBundle`. Сервер не расшифровывает.

**TTL:** hash `room_keys:{roomId}:{epoch}` — **7 дней**; счётчик `room_key_epoch:{roomId}` — **30 дней** (DM-16).

### `messages:{roomId}`

Очередь зашифрованных сообщений комнаты. Формат — `RoomMessage` (E2EE):

| Поле | Описание |
|------|----------|
| `senderInternalId` | **Primary** — canonical sender (обязателен для новых записей) |
| `senderTgId` | Deprecated; best-effort для Telegram-отправителя |
| `encryptedContent`, `iv`, `messageId`, … | Opaque ciphertext |

`RoomMessage.getSenderKey()` резолвит identity для edit/delete и legacy JSON (только `senderTgId`). Переполнение: `max-size-per-room` (по умолчанию 500). **TTL ключа:** `burnedchats.messages.offline-queue.ttl` (24 ч).

**Per-room message TTL (IMP-ROOM-18):** когда в `room:{roomId}` задано `messageTtl > 0`, сервер при
`/app/room.message.send`, `/app/room.message.sync` и `/app/room.setMessageTtl` выполняет **lazy prune**:
удаляет из list элементы с `serverTimestamp` (fallback `clientTimestamp`) старше `now - messageTtl`.
Сервер не расшифровывает ciphertext — только метаданные времени. `messageTtl = 0` — prune отключён,
действует только TTL всего list-ключа.

---

## Phase 4: Files (Redis)

> Реализация: `FileMetadataRepository`, `FileMetadata`.

### `file_meta:{fileId}`

Hash с метаданными **одного** загруженного зашифрованного blob'а (основной файл или thumbnail). `fileId` — UUID, совпадает с именем файла на диске без расширения (`{fileId}.enc`).

```redis
HSET file_meta:550e8400-e29b-41d4-a716-446655440000
  uploaderInternalId "tg:123456789"
  uploaderTgId       "123456789"
  contextType        "session"
  contextId          "session-uuid-or-room-uuid"
  size               "1048576"
  createdAt          "1705312200000"

EXPIRE file_meta:550e8400-e29b-41d4-a716-446655440000 86400
```

| Поле | Тип | Описание |
|------|-----|----------|
| `uploaderInternalId` | string | Канонический `internalId` загрузчика (Telegram и wallet) |
| `uploaderTgId` | string | Опционально: Telegram ID загрузчика (legacy / best-effort) |
| `contextType` | string | `session` или `room` |
| `contextId` | string | ID сессии или комнаты |
| `size` | long (строка) | Размер сохранённого **зашифрованного** blob'а в байтах |
| `createdAt` | long (строка) | Unix time (мс) |

**TTL:** по умолчанию 24 часа (`FileStorageProperties.metadataTtl`), синхронизирован с очисткой и burn cascade.

### `file_context:{contextId}`

**Set** из `fileId`, привязанных к одной сессии или комнате. Используется для каскадного удаления файлов при burn сессии/комнаты (`FileBurnService`): по списку `fileId` удаляются записи в `file_meta:*`, объекты на filesystem и члены множества.

**TTL:** продлевается при каждом добавлении файла (как у `file_meta`), чтобы индекс не переживал метаданные.

---

## Формат кодировки шифртекста (encoding contract)

Все криптографические blob'ы на стыке **frontend ↔ backend ↔ Redis** кодируются
**стандартным Base64** (RFC 4648 §4, алфавит `A–Z a–z 0–9 + /` с `=`-padding) —
**не** base64url (`-`/`_`). Контракт единый для всех полей:

| Поле | Назначение | Где |
|------|------------|-----|
| `encryptedContent` | AES-GCM ciphertext сообщения / медиа-подписи | room messages, DM, edit-события |
| `iv` | 12-byte GCM IV для `encryptedContent` | те же |
| `encryptedMeta` | ciphertext метаданных файла (`{ fileName, mimeType }`) | медиа-сообщения |
| `nameEncrypted` | ciphertext имени комнаты | `room:{roomId}`, `CREATE_ROOM` (optional), `ROOM_NAME_UPDATED`, room-list |
| `nameIv` | 12-byte GCM IV для `nameEncrypted` | те же |
| key-bundle: `ephemeralPublicKey`, `encryptedKey`, `iv` | wrapped group key (ECDH + AES-GCM) | `KEY_BUNDLE`, `room_keys:{roomId}:{epoch}` |
| `salt`, `passwordProof`, `*PublicKey` | KDF salt / PoW-proof / ECDH pubkeys | CREATE_ROOM, JOIN |

**Реализация (источник истины):**

- **Frontend** — `frontend/src/crypto/aes.ts`: `arrayBufferToBase64` использует `btoa`,
  `base64ToArrayBuffer` — `atob` (стандартный Base64). Эти же helpers применяются для
  `encryptRoomName` (`crypto/groupKey.ts`) → `{ nameEncrypted, nameIv }`.
- **Backend** — Base64 на wire проверяется через `@Pattern(regexp = "^[A-Za-z0-9+/]+=*$")`
  на DTO-полях и/или ручной `java.util.Base64.getDecoder()` (стандартный, **не**
  `getUrlDecoder()`) в сервисах/хендлерах (например `HandshakeHandler.isValidBase64Key`,
  `PasswordProofService`). Отдельного `@Base64` / `Base64Validator` в коде нет.

**Zero-knowledge инвариант.** Сервер хранит и ретранслирует эти поля как **opaque-строки**
и **никогда** не декодирует/расшифровывает содержимое — только метаданные (длина для
валидации, временные метки для prune). Ключей шифрования сервер не видит.

> **Зачем зафиксировано.** Аудит кода ↔ спека выявил, что формат кодировки был описан
> разрозненно. Несоответствий base64 vs base64url **не обнаружено** — контракт един.

---

## Java DTOs

### Session Entity

```java
// model/Session.java — участники по internalId
public class Session {
    private String id;
    private String initiatorInternalId;
    private Long initiatorTelegramId;    // null for wallet-only
    private String responderInternalId;
    private Long responderTelegramId;    // null for wallet-only
    private SessionStatus status;        // PENDING, HANDSHAKE, ACTIVE, BURNED, EXPIRED
    private Instant createdAt;
    private Instant lastActivityAt;
    private String secretQuestion;
    private String secretAnswerHash;
    private boolean initiatorVerified;
    private boolean responderVerified;

    public boolean isParticipant(String internalId) { ... }
    public String getPeerInternalId(String myInternalId) { ... }
}
```

### Chat Request

```java
// model/ChatRequest.java — Redis request:{recipientInternalId}
public class ChatRequest {
    private String sessionId;
    private String senderInternalId;
    private Long senderTgId;              // null for wallet-only
    private String senderUsername;
    private String senderFirstName;
    private String recipientInternalId;
    @Deprecated private Long recipientTgId;
    private boolean hasQuestion;
    private String question;
    private Instant createdAt;

    public String getRecipientKey();  // always recipientInternalId
    public String getSenderKey();
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
    private String uploaderInternalId;  // canonical internalId (both auth modes)
    private String uploaderTgId;        // optional Telegram ID (legacy / best-effort)
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
    private String senderInternalId;   // primary for wallet routing
    private Long recipientId;
    private String recipientInternalId;
    private String encryptedContent;
    private String iv;
    private Long clientTimestamp;
    private Instant serverTimestamp;
    @Builder.Default
    private String type = "text";
    private String fileId;
    private String thumbnailFileId;
    private String encryptedMeta;
    private Long fileSize;
    private String replyToMessageId;   // plaintext relay metadata
    private Instant editedAt;          // set after successful edit
}
```

**Тип сообщения:** `text` \| `image` \| `video` \| `file`. Для не-text поле `fileId` обязательно (валидация `FileMessageValidator`).

### Telegram User (Redis cache)

```java
// model/TelegramUser.java — кэш в user:{tgId}, не wire-DTO Bot API
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TelegramUser implements Serializable {
    private Long id;
    private String username;
    private String firstName;
    private String lastName;
    private String languageCode;
    private String photoUrl;
    @Builder.Default
    private boolean isPremium = false;
    @Builder.Default
    private Instant cachedAt = Instant.now();  // DM-17: не Jackson @JsonProperty
}
```

---

### Request DTOs

```java
// dto/request/SearchRequest.java
@Data
public class SearchRequest {
    @NotBlank
    @Size(min = 1, max = 64)
    private String query;
}

// dto/request/CreateSessionRequest.java
@Data
public class CreateSessionRequest {
    @Size(min = 36, max = 36)
    private String recipientInternalId;   // primary

    @Deprecated
    @Positive
    private Long recipientId;           // legacy Telegram ID

    @Size(max = 256)
    private String secretQuestion;

    @Size(max = 256)
    private String secretExpectedAnswer;

    private PowSolution pow;            // required when pow.enabled=true
}

// dto/response/UserResponse.java
@Data
public class UserResponse {
    private String internalId;   // always set
    private Long id;             // Telegram ID; null for wallet-only
    private String username;
    private String displayName;
    private String photoUrl;
    private boolean online;
    private boolean premium;
}

// dto/request/AcceptSessionRequest.java
@Data
public class AcceptSessionRequest {
    @NotBlank
    private String sessionId;
    
    @Size(max = 256)
    private String secretAnswer;
}

// dto/request/PublicKeyRequest.java
@Data
public class PublicKeyRequest {
    @NotBlank
    private String sessionId;
    
    @NotBlank
    @Size(min = 44, max = 256)
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
    @Size(max = 64) private String replyToMessageId;
}

// dto/request/BurnSessionRequest.java
@Data
public class BurnSessionRequest {
    @NotBlank
    private String sessionId;
}

// dto/request/VerificationRequest.java — STOMP /app/verification.confirm
@Data
public class VerificationRequest {
    @NotBlank
    private String sessionId;
    
    @NotNull
    private Boolean confirmed;
}
```

---

### Response/Event DTOs

События STOMP несут **`UserResponse`** (не фантомный `PeerInfo`, DM-7). Ошибки —
**string-коды** в поле `error` (отдельного enum `ErrorCode` нет, DM-8).

```java
// dto/response/UserResponse.java — peer/sender/recipient во всех событиях
@Data
public class UserResponse {
    private String internalId;
    private Long id;             // Telegram ID; null for wallet-only
    private String username;
    private String displayName;
    private String photoUrl;
    private boolean online;
    private boolean premium;
}

// dto/event/SearchResultEvent.java
@Data
@AllArgsConstructor
public class SearchResultEvent {
    private boolean found;
    private UserResponse user;   // not PeerInfo
    private String error;        // e.g. SELF_SEARCH, RATE_LIMITED
}

// dto/event/SessionCreatedEvent.java
@Data
@AllArgsConstructor
public class SessionCreatedEvent {
    private boolean success;
    private String sessionId;
    private UserResponse recipient;
    private boolean hasSecretQuestion;
    private Instant createdAt;
    private Instant expiresAt;
    private String error;
}

// dto/event/SessionAcceptedEvent.java — replaces legacy SessionStartedEvent
@Data
@AllArgsConstructor
public class SessionAcceptedEvent {
    private boolean success;
    private String sessionId;
    private UserResponse peer;
    private Instant acceptedAt;
    private Instant expiresAt;
    private String error;
}

// dto/event/IncomingRequestEvent.java
@Data
@AllArgsConstructor
public class IncomingRequestEvent {
    private String sessionId;
    private UserResponse sender;
    private String fromInternalId;
    private boolean hasSecretQuestion;
    private String secretQuestion;
    private Instant createdAt;
    private Instant expiresAt;
}

// dto/event/PeerPublicKeyEvent.java
@Data
@AllArgsConstructor
public class PeerPublicKeyEvent {
    private boolean success;
    private String sessionId;
    private Long peerId;
    private String publicKey;
    private Instant timestamp;
    private String error;
}

// dto/event/NewMessageEvent.java — flat DTO, no EncryptedMessage wrapper (DM-9)
@Data
@AllArgsConstructor
public class NewMessageEvent {
    private boolean success;
    private String sessionId;
    private String messageId;
    private Long senderId;
    private String senderInternalId;
    private String encryptedContent;
    private String iv;
    private Long clientTimestamp;
    private Instant serverTimestamp;
    private String type;
    private String fileId;
    private String thumbnailFileId;
    private String encryptedMeta;
    private Long fileSize;
    private String replyToMessageId;
    private String error;
}

// dto/event/MessageSentEvent.java
@Data
@AllArgsConstructor
public class MessageSentEvent {
    private boolean success;
    private String sessionId;
    private String messageId;
    private Instant serverTimestamp;
    private boolean delivered;
    private boolean queued;
    private String error;
}

// dto/event/BurnSignalEvent.java — /user/queue/burn-signal
@Data
@AllArgsConstructor
public class BurnSignalEvent {
    private String sessionId;
    private Long burnedBy;
    private Instant burnedAt;
    private boolean success;
    private String error;
}

// dto/event/VerificationEvent.java — replaces VerificationStatusEvent (DM-8)
@Data
@AllArgsConstructor
public class VerificationEvent {
    private boolean success;
    private String sessionId;
    private Boolean verified;
    private Boolean peerVerified;
    private Boolean bothVerified;
    private Instant verifiedAt;
    private String error;
}
```

**WebSocket errors:** `WebSocketExceptionHandler.baseError` шлёт `Map<String,Object>`
на `/user/queue/errors` с полями `success=false`, **`error`** (код ошибки),
`message`, `timestamp` (ISO-8601); опционально `retryAfter` (RATE_LIMIT_EXCEEDED)
и `field` (VALIDATION_ERROR). Отдельного `ErrorEvent` DTO нет. Фронт читает
`data.error` (`useSession.ts`).

---

## TypeScript Interfaces

Источник истины для доменных типов (`UserInfo`, `Session`, `Message`, …):
`frontend/src/types/index.ts` (DM-11, DM-12).

### Frontend Types

```typescript
// === USER (maps UserResponse on wire) ===

export interface UserInfo {
  internalId: string;       // primary routing key
  id?: number;              // Telegram ID when available
  username?: string;
  displayName: string;
  walletAddress?: string;
  photoUrl?: string;
  online: boolean;
  premium: boolean;
}

// === MESSAGES ===

export type MessageType = 'text' | 'image' | 'video' | 'file';

export type MessageStatus =
  | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  id: string;
  sessionId: string;
  fromUserId?: number;           // wire may omit for wallet senders (DM-11)
  encryptedContent: string;
  iv: string;
  timestamp: number;
  status: MessageStatus;
  type: MessageType;
  replyToMessageId?: string;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
}

// === SESSION ===

export type SessionStatus =
  | 'pending'       // request sent, awaiting response
  | 'handshaking'   // key exchange in progress
  | 'active'
  | 'expired'
  | 'burned';       // DM-12: not waiting/connecting

export interface Session {
  id: string;
  peerInternalId: string;
  /** @deprecated Prefer peerInternalId */
  peerId?: number;
  peerUsername?: string;
  peerName: string;
  status: SessionStatus;
  createdAt: number;
  expiresAt?: number;
  hasUnread?: boolean;
}

export interface ChatRequest {
  id: string;
  fromInternalId: string;
  fromUserId?: number;
  fromUsername?: string;
  fromName: string;
  secretQuestion?: string;
  createdAt: number;
  expiresAt: number;
}

// === STOMP events (illustrative wire-shapes; full list — API.md) ===
// Not exported from index.ts — shapes mirror backend event DTOs / handlers.

interface SearchResultEvent {
  found: boolean;
  user?: UserInfo;
  error?: string;
}

interface SessionCreatedEvent {
  success: boolean;
  sessionId?: string;
  recipient?: UserInfo;
  hasSecretQuestion: boolean;
  createdAt?: string;
  expiresAt?: string;
  error?: string;
}

interface SessionAcceptedEvent {
  success: boolean;
  sessionId?: string;
  peer?: UserInfo;
  acceptedAt?: string;
  expiresAt?: string;
  error?: string;
}

interface IncomingRequestEvent {
  sessionId: string;
  sender: UserInfo;
  fromInternalId: string;
  hasSecretQuestion: boolean;
  secretQuestion?: string;
  createdAt: string;
  expiresAt: string;
}

interface NewMessageEvent {
  success: boolean;
  sessionId: string;
  messageId: string;
  senderId?: number;
  senderInternalId?: string;
  encryptedContent: string;
  iv: string;
  clientTimestamp: number;
  serverTimestamp?: string;
  type?: MessageType;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
  replyToMessageId?: string;
  error?: string;
}

interface MessageSentEvent {
  success: boolean;
  sessionId: string;
  messageId: string;
  serverTimestamp?: string;
  delivered: boolean;
  queued: boolean;
  error?: string;
}

interface BurnSignalEvent {
  sessionId: string;
  burnedBy?: number;
  burnedAt?: string;
  success: boolean;
  error?: string;
}

interface VerificationEvent {
  success: boolean;
  sessionId: string;
  verified?: boolean;
  peerVerified?: boolean;
  bothVerified?: boolean;
  verifiedAt?: string;
  error?: string;
}

interface StompErrorPayload {
  success: false;
  error: string;           // error code (POW_INVALID, RATE_LIMIT_EXCEEDED, …)
  message: string;
  timestamp: string;       // ISO-8601
  retryAfter?: number;     // RATE_LIMIT_EXCEEDED
  field?: string;          // VALIDATION_ERROR
}
```

---

## Валидация данных

### Java Bean Validation

Фактический класс: `util/ValidationConstants.java` (не `validation/`).

```java
// util/ValidationConstants.java
public final class ValidationConstants {

    /** Максимальный размер принимаемого зашифрованного blob'а (байты).
     *  Plaintext до ~25 MB + заголовок AES-GCM/chunked → потолок 26 MB. */
    public static final long MAX_ENCRYPTED_FILE_SIZE = 26 * 1024 * 1024;

    /** Лимит POST /api/files/upload на пользователя (см. RateLimitService.RateLimitType.FILE_UPLOAD). */
    public static final int FILE_UPLOAD_RATE_LIMIT = 10;

    /** Valid context types for file uploads. */
    public static final String CONTEXT_TYPE_SESSION = "session";
    public static final String CONTEXT_TYPE_ROOM = "room";

    private ValidationConstants() {}
}
```

### Base64 validation (no custom `@Base64`)

Отдельного `Base64Validator` / аннотации `@Base64` в репозитории нет. На DTO
используется `@Pattern(regexp = "^[A-Za-z0-9+/]+=*$")`; дополнительная проверка
длины/декодирования — ручной `Base64.getDecoder()` в хендлерах и сервисах
(например `HandshakeHandler.isValidBase64Key`, `PasswordProofService`).

### Crypto / message size reference (descriptive)

Эти величины **не** объявлены в `ValidationConstants`; они задаются
`@Size` / `@Pattern` на DTO и клиентским crypto-кодом.

| Величина | Значение | Где задано |
|----------|----------|------------|
| AES-GCM IV | 12 bytes (Base64 wire ≈ 16–24 chars) | `SendMessageRequest.iv` `@Size(min=16,max=24)` |
| GCM auth tag | 16 bytes (входит в ciphertext Web Crypto) | клиент / SECURITY.md |
| P-256 SPKI public key (Base64) | `@Size(min=44, max=256)` | `PublicKeyRequest.publicKey` |
| Текст сообщения (продуктовый ориентир) | ≤ 4096 chars plaintext | клиент UX; на wire — encrypted blob ≤ 64 KB |
| `fileName` (в encryptedMeta) | ≤ 255 chars | клиент + `encryptFileMetadata` |

### Limits Summary

| Поле / правило | Лимит | Причина |
|----------------|-------|---------|
| `text` (plaintext UX) | 4096 chars | Оптимально для чата |
| Зашифрованный blob upload | ≤ `MAX_ENCRYPTED_FILE_SIZE` (26 MB) | Потолок на сервере; plaintext и MIME — ориентиры продукта (см. SECURITY.md) |
| `POST /api/files/upload` | `FILE_UPLOAD_RATE_LIMIT` (10) / 1 min | Redis rate limit per user |
| `fileName` | 255 chars | Клиент + `encryptFileMetadata` |
| `sessionId` | UUID v4 | Collision resistance |
| `IV` | 12 bytes | AES-GCM standard |
| GCM `tag` | 16 bytes | Входит в ciphertext Web Crypto output |
| `SearchRequest.query` | 1–64 chars | `SearchRequest` `@Size` |
| `AcceptSessionRequest.secretAnswer` | ≤ 256 chars | `AcceptSessionRequest` `@Size` |
| `PublicKeyRequest.publicKey` | 44–256 chars Base64 | `PublicKeyRequest` `@Size` |

---

## Redis Repository Examples

Упрощённые фрагменты **фактических** репозиториев (DM-10). Не использовать
legacy-поля `participant1/2` или ключ `messages:{sessionId}`.

### Session Repository

```java
@Repository
public class SessionRepository {

    private static final String KEY_PREFIX = "session:";
    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final Duration sessionTtl;  // session.active.ttl, default 24h

    public Mono<Session> findById(String sessionId) {
        return redisTemplate.opsForHash()
            .entries(keyFor(sessionId))
            .collectMap(e -> e.getKey().toString(), e -> e.getValue().toString())
            .filter(map -> !map.isEmpty())
            .map(this::mapToSession);
    }

    public Mono<Boolean> save(Session session) {
        return redisTemplate.opsForHash()
            .putAll(keyFor(session.getId()), sessionToMap(session))
            .then(redisTemplate.expire(keyFor(session.getId()), sessionTtl));
    }

    public Mono<Boolean> updateVerification(String sessionId, String role, boolean verified) {
        String field = "initiator".equals(role) ? "initiatorVerified" : "responderVerified";
        return redisTemplate.opsForHash().put(keyFor(sessionId), field, String.valueOf(verified));
    }

    private String keyFor(String sessionId) {
        return KEY_PREFIX + sessionId;
    }

    // mapToSession reads initiatorInternalId, responderInternalId, status, ...
}
```

### Message Repository (offline queue)

```java
@Repository
public class MessageRepository {

    private static final String KEY_PREFIX = "messages:";
    private static final String COUNT_PREFIX = "messages:count:";

    public Mono<Long> enqueue(String recipientInternalId, String sessionId, Message message) {
        String key = KEY_PREFIX + recipientInternalId + ":" + sessionId;
        return Mono.fromCallable(() -> objectMapper.writeValueAsString(message))
            .flatMap(json -> redisTemplate.opsForList().rightPush(key, json))
            .flatMap(size -> redisTemplate.expire(key, offlineQueueTtl).thenReturn(size));
    }

    public Flux<Message> drainQueue(String recipientInternalId, String sessionId) {
        String key = KEY_PREFIX + recipientInternalId + ":" + sessionId;
        return redisTemplate.opsForList().range(key, 0, -1)
            .map(json -> objectMapper.readValue(json, Message.class));
    }

    public Mono<Long> deleteQueue(String recipientInternalId, String sessionId) {
        return redisTemplate.delete(KEY_PREFIX + recipientInternalId + ":" + sessionId);
    }
}
```

---

## Связанные документы

- [API.md](./API.md) — WebSocket события
- [SECURITY.md](./SECURITY.md) — криптографические примитивы
- [ARCHITECTURE.md](./ARCHITECTURE.md) — общая архитектура

