# Data Models

> Redis data models, Java DTOs, and TypeScript interfaces

## Redis Schema

### Key Overview

Complete inventory of **51** Redis key families (source of truth — code).
Detailed sections below cover the most frequently used patterns; the rest are
summarized in the table.

| Key / pattern | Type | TTL (default) | Purpose |
|----------------|-----|---------------|---------|
| `auth_tg:{telegramId}` | string | 90d | tgId → `internalId` |
| `auth_wallet:{walletAddress}` | string | 90d | wallet → `internalId` |
| `user:{internalId}` | hash | 90d | Canonical profile (`UserIdentityRepository`) |
| `user:{tgId}` | hash | **7d** | Legacy TG cache (`UserRepository`); see §below |
| `lang:pref:{userId}` | string | 90d | Language preferences |
| `session:{sessionId}` | hash | 24h | DM session metadata |
| `session_token:{token}` | string | 1h | One-time resume token → `internalId` |
| `request:{recipientInternalId}` | list | 5min | Incoming chat requests |
| `online:{internalId}` | string | 30s | Heartbeat presence |
| `messages:{recipientId}:{sessionId}` | list | 24h | DM offline queue (E2EE blobs) |
| `messages:count:{recipientId}` | string | ⚠️ expire when `count==1` | Pending DM counter |
| `dm-editable:{sessionId}:{messageId}` | string | **20min** | DM edit window meta |
| `message-senders:{sessionId}` | hash | 24h | Sender index for delete-for-everyone |
| `message-edits:{recipientId}:{sessionId}` | list | 1h | Edit tombstone queue (offline sync, per-recipient) |
| `message-deletions:{recipientId}:{sessionId}` | list | 1h | Deletion tombstone queue (offline sync, per-recipient) |
| `messages:{roomId}` | list | 24h | Room message queue |
| `ratelimit:{type}:{userId}` | string | type window | STOMP rate limit (`RateLimitService`) |
| `ratelimit:rest:{group}:{clientId}` | string | group window | REST rate limit |
| `filedownload:active:{internalId}` | string | 30min | Active download slot counter |
| `file_meta:{fileId}` | hash | max(24h, room messageTtl) capped by remaining room hash TTL | Encrypted blob metadata |
| `file_context:{contextId}` | set | 24h | `fileId` index by session/room |
| `pow:challenge:{challengeId}` | hash | 60s | PoW challenge (action + difficulty) |
| `pow:spent:{challengeId}` | string | 120s | One-time spent marker (SET NX) |
| `pow:abuse:global` | hash | 60s | Global adaptive difficulty counters |
| `auth_nonce:{nonce}` | string | 5min | TON proof nonce |
| `wallet_tg_link:{challengeId}` | string | 15min | Wallet↔Telegram link challenge |
| `room:{roomId}` | hash | 30d | Room metadata |
| `room:autoburn:{roomId}` | string | until `autoBurnAt` | Auto-burn trigger (no refresh) |
| `user:deadman:{internalId}` | string | `periodDays` | Dead man's switch trigger (refresh on connect) |
| `user:deadman:cfg:{internalId}` | string | **no TTL** | `{ periodDays, wipeIdentity }` — deleted on disable/expiry |
| `room_members:{roomId}` | set | 30d | Members (internalId) |
| `room_burn_inbox:{internalId}` | list | 7d | Offline burn facts (`roomId|burnedAt`), no names |
| `room_key_request_inbox:{ownerInternalId}` | hash | 7d | Offline key-request facts; field `{roomId}:{requesterInternalId}` → `requestedAt` ms; cap 100 |
| `member_rooms:{internalId}` | set | 30d | User room reverse index |
| `room_keys:{roomId}:{epoch}` | hash | **7d** | Wrapped group keys |
| `room_key_epoch:{roomId}` | string | 30d | Current rekey epoch |
| `room_member_pubkey:{roomId}` | hash | 30d | internalId → SPKI pubkey |
| `room_bans:{roomId}` | set | 30d | Room ban list |
| `room_muted:{roomId}` | set | 30d | Room mute list |
| `room_roles:{roomId}` | hash | 30d | internalId → `admin` \| `member` |
| `room_presence:{roomId}` | hash | 10min | lastSeenMs (not refreshed with room TTL) |
| `room_join_request:{roomId}:{sender}` | hash | 24h | BY_REQUEST join request |
| `room_join_requests:{roomId}` | set | 24h | senderInternalId index |
| `invite:{token}` | hash | until `expiresAt` | Room invite token |
| `dm_invite:{token}` | hash | until `expiresAt` | Personal DM invite token (default 10 min) |
| `dm_invites:{ownerInternalId}` | set | — | Owner reverse index of DM invite tokens |
| `ton:rpc:{addr}:{method}:{argsHash}` | string | 60s | TON RPC cache |
| `ton:jetton:balance:v1:{wc}:{hex}` | string | 30s | Jetton balance cache |
| `ton:jetton:info:v1:{wc}:{hex}` | string | 1h | Jetton master info |
| `ton:jetton:fees:v1:{wc}:{hex}` | string | 5min | Effective fee params |
| `ton:staking:profile\|lock\|tiercfg:v1:{wc}:{hex}` | string | 30s / 1h | Staking cache |
| `ton:governance:summary\|detail:v1:{id}` | string | 30s | Governance proposal cache |
| `health:test:{timestamp}` | string | 10s | Redis health probe |


---

### `session:{sessionId}`

Metadata for an active DM session. Participants are addressed by **`internalId`** (UUID string).

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

| Field | Type | Description |
|------|-----|----------|
| `initiatorInternalId` | string | internalId of the request creator |
| `initiatorTelegramId` | string? | Creator's Telegram ID; empty for wallet-only |
| `responderInternalId` | string | Recipient's internalId |
| `responderTelegramId` | string? | Recipient's Telegram ID; empty for wallet-only |
| `status` | enum | `pending` \| `handshake` \| `active` \| `burned` \| `expired` |
| `secretAnswerHash` | string? | Base64(SHA-256) of the normalized expected answer (`trim` → `toLowerCase`) |

Participant check: `session.isParticipant(internalId)`. Peer: `session.getPeerInternalId(myInternalId)`.

**TTL:** 24 hours by default (`session.active.ttl` in `application.yml`).

---

### Offline message queue (DM)

Queue of encrypted messages for the recipient when they are offline at delivery time.

| Key | Type | Description |
|------|-----|----------|
| `messages:{recipientInternalId}:{sessionId}` | List | JSON-serialized `Message` (E2EE blob), FIFO order |
| `messages:count:{recipientInternalId}` | String | Aggregate count of undelivered messages across all user sessions |

**TTL `messages:count:*`:** EXPIRE is set only when the counter transitions to `1`

**TTL and cap:** configured in `burnedchats.messages.offline-queue` (`ttl`, `max-size-per-session`). Values must not exceed session metadata TTL (`session.active.ttl`). On overflow the list is trimmed from the head (oldest messages dropped); the server records Micrometer metrics `burnedchats.offline_queue.*` (no user identifiers in tags).

#### `dm-editable:{sessionId}:{messageId}`

Short-lived meta for DM message ownership verification and the edit window after
the message leaves the offline queue (delivered online).

| JSON field | Type | Description |
|-----------|-----|----------|
| `senderInternalId` | String | Stable sender UUID (primary for wallet) |
| `senderId` | Long | Legacy Telegram id; fallback for old records |
| `serverTimestamp` | Instant | Edit window anchor |
| `fileId` / `thumbnailFileId` | String | Optional for file messages (delete/burn) |

**TTL:** `burnedchats.messages.message-edits.editable-meta-ttl` — **20 min**

#### `message-senders:{sessionId}`

Hash sender index for DM delete-for-everyone (delivered / previously queued messages).

| Hash field | JSON value | Description |
|-----------|---------------|----------|
| `{messageId}` | `MessageSenderIndexEntry` | Serialized JSON |

| JSON field | Type | Description |
|-----------|-----|----------|
| `senderInternalId` | String | Stable sender UUID (primary for wallet) |
| `senderId` | Long | Legacy Telegram id; only if `!= null && != 0` |

**Legacy read-path:** plain numeric string in hash value is treated as `senderId` only;
string `"null"` or invalid value → index is considered empty (fallback to
`dm-editable` meta).

**TTL:** `burnedchats.messages.sender-index-ttl` (default 24 h).

---

### `request:{recipientInternalId}`

Queue of incoming chat requests. Key is **`recipientInternalId`** (recipient UUID), not Telegram ID.

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

`ChatRequest.getRecipientKey()` always returns `recipientInternalId`. Legacy entries with key `request:{tgId}` are not migrated (TTL 5 min).

**TTL:** 5 minutes (request expires)

---

### `online:{internalId}`

Online status (heartbeat).

```redis
SET online:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33 "1704067200000"
EXPIRE online:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33 30
```

Client sends heartbeat every 20 seconds; TTL 30 seconds.

---

### `user:{internalId}` — canonical catalog (`UserIdentityRepository`)

Unified user profile under stable `internalId`. Populated on REST wallet-auth and STOMP CONNECT for **any** principal type.

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

Wallet-only example (`authType: WALLET`, `telegramId` empty):

```redis
HSET user:a1b2c3d4-e5f6-7890-abcd-ef1234567890
  internalId    "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  authType      "WALLET"
  displayName   "EQBx...7JfP"
  telegramId    ""
  walletAddress "0:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
```

**Legacy Telegram cache** (`UserRepository`): separate hash `user:{tgId}` for fast
lookup by `@username` / TG ID. Contains optional `internalId` field for enriching
`UserResponse`. Wallet-only records are **not** duplicated in `user:{tgId}`.

**TTL:** canonical `user:{internalId}` — **90 days** (refreshed on each login);

### `auth_tg:{telegramId}` / `auth_wallet:{walletAddress}`

External authentication mappings to unified `internalId`:

```redis
SET auth_tg:111222333 "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33"
SET auth_wallet:0:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33"
EXPIRE auth_tg:111222333 7776000
EXPIRE auth_wallet:0:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef 7776000
```

After `link-wallet` / `switch-wallet` the stored suffix is **canonical raw**
(`workchain:hex` from `TonProofVerifier` / `VerifiedTonProof.walletAddress`), not
a friendly `EQ…` / `UQ…` string. `POST /api/auth/switch-wallet` rotates in one
Lua eval: `HGET` current → abort **409** if `GET auth_wallet:{newRaw}` is another
`internalId` (no `DEL`) → `DEL auth_wallet:{currentFromHash}` (hash value, not a
client-supplied old address) → `SET` + `HSET` + `EXPIRE` 90d.
`auth_tg:` is not touched. Search by the previous address no longer resolves
this `internalId`. Friendly 48-char lookup against raw keys is a known follow-up
(not this card).

#### Lifecycle on `burnAllForUser`

| Key / pattern | `wipeIdentity=false` | `wipeIdentity=true` | Note |
|----------------|----------------------|---------------------|------------|
| `session:{sessionId}` | `DEL` (all active user sessions) | same | + `BurnSignalEvent` to peers |
| `messages:{internalId}:*`, `message-edits:*`, `message-deletions:*` | `DEL` user queues | same | tombstone + offline |
| `request:{internalId}` | `DEL` | same | pending chat requests |
| `file_context:{sessionId\|roomId}` | `DEL` (affected contexts) | same | via `FileBurnService` |
| `room:{roomId}` + room-* (owned) | full BURN_ROOM cascade | same | `RoomBurnedEvent` to members |
| `room_members:*` / pubkey / keys (member leave) | remove user from others' rooms | same | `room-member-left` → owner rekey |
| `member_rooms:{internalId}` | preserved | `DEL` | reverse index |
| `user:{internalId}` | preserved | `DEL` | profile |
| `auth_tg:*` / `auth_wallet:*` | preserved | `DEL` user bindings | |
| `lang:pref:{internalId}` | preserved | `DEL` | |
| `session_token:*` (value = internalId) | preserved | `DEL` matching tokens | SCAN |
| `user:deadman:{internalId}` / `user:deadman:cfg:{internalId}` | not touched by cascade | not touched | listener is idempotent; disable via `/app/user.setDeadman` |
| `ratelimit:rest:burn_all:{internalId}` | INCR / TTL 60s | same | 3 req/min |

Order: communication entities first (1–4), identity last (5), client ack after cascade.

---

### `ratelimit:{type}:{userId}`

Rate limiting counters (STOMP and shared identity). Prefix **`ratelimit:`**

```redis
INCR ratelimit:message:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33
EXPIRE ratelimit:message:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33 60
```

| Type (`RateLimitType`) | Window | Max (default) | Note |
|------------------------|------|---------------|------------|
| `search` | 60s | 10 | |
| `message` | 60s | **60** | override: `rate-limit.messages.per-minute` |
| `session_action` | 60s | 10 | accept/reject |
| `handshake` | 60s | 10 | key exchange |
| `file_upload` | 60s | 10 | |
| `general` | 60s | 100 | |
| `message_edit` | 60s | 10 | |
| `message_delete` | 60s | 30 | |
| `pow_challenge` | 60s | 10 | issuance flood guard |
| `room_read` | 60s | 30 | getMembers/getPresence/getBans |
| `room_password_fail` | 600s | 5 | override: `rate-limit.room-password-fail.*`; see footnote below |

> **`room_password_fail` (composite key):** Redis key —
> `ratelimit:room_password_fail:{roomId}:{internalId}`
> (`RoomJoinService.passwordFailKey` → `RateLimitService`). INCR runs
> **only on failed** password proof; successful proof resets the counter
> (`resetRateLimit`). Lockout clears when the window TTL expires (600 s / yaml override).

Separate REST prefix: `ratelimit:rest:{group}:{clientId}` (IP / identity).
Group `burn_all` — `/app/user.burnAll`, 3 req/min per `internalId`.

---

### TON RPC cache (`TonService`)

Stable `runGetMethod` / `getAddressInformation` responses are cached in Redis with keys:

| Key pattern | TTL | Purpose |
|--------------|-----|------------|
| `ton:rpc:{address}:{method}:{argsHash}` | `app.ton.cache.ttl-seconds` | Normalized address, get-method name, SHA-256 of stack args JSON |

### Jetton (`JettonService`)

| Key pattern | TTL | Value |
|--------------|-----|----------|
| `ton:jetton:balance:v1:{workchain}:{hex}` | 30 s | `BigInteger` BURN nano balance |
| `ton:jetton:info:v1:{workchain}:{hex}` | 1 h | JSON `JettonInfo` master (`app.ton.addresses.jetton-master`) |
| `ton:jetton:fees:v1:{workchain}:{hex}` | 5 min | JSON `EffectiveFeeParams` (`get_effective_fee_params`) |

Address in the key suffix is normalized as `workchain:hex` (see `TonAddressBoc.normalizeKey`).

### Staking (`StakingVerifier`)

| Key pattern | TTL | Value |
|--------------|-----|----------|
| `ton:staking:profile:v1:{workchain}:{hex}` | 30 s | JSON `UserStakingProfile` |
| `ton:staking:lock:v1:{workchain}:{hex}` | 1 h | `StakingLock` address for the given staking-master |
| `ton:staking:tiercfg:v1:{workchain}:{hex}` | 1 h | Tier config cache read from lock contract |

---

## Rooms (Redis)

> Below — target key structures.

### `room:{roomId}`

Room metadata (owner, derived password, join mode).

```redis
HSET room:uuid-room-1
  ownerInternalId "d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33"
  ownerTgId       "111222333"
  salt            "base64..."     # empty string if room has no password (BY_REQUEST)
  passwordProofHash "base64..."   # empty string if room has no password
  joinMode        "by_password"   # or "by_request"
  createdAt       "1704067200000"
  nameEncrypted   "base64..."     # optional; opaque ciphertext
  nameIv          "base64..."     # optional; 12-byte GCM IV
  readOnly        "false"         # optional; true = only owner can post
  autoBurnAt      "1706745600000" # optional; epoch ms auto-burn deadline
  messageTtl      "3600"          # optional; message self-destruct seconds; 0 = off

EXPIRE room:uuid-room-1 2592000
```

| Field | Type | Description |
|------|-----|----------|
| `ownerInternalId` | string | Owner internalId (UUID). On Redis read: if field is empty or digits-only (legacy), normalized via `InternalIds.forTelegramId` where safely reconcilable with `ownerTgId` |
| `ownerTgId` | string | Owner Telegram ID (compat for current DTOs) |
| `salt` | string | KDF salt (Base64). Empty string if room has no password (BY_REQUEST) |
| `passwordProofHash` | string | Proof hash. Empty string if room has no password |
| `joinMode` | enum | `by_password` \| `by_request` |
| `createdAt` | number | Unix timestamp in ms |
| `nameEncrypted` | string | Encrypted room name (AES-GCM ciphertext, Base64). Empty string = not set. Server does not decrypt |
| `nameIv` | string | Base64 IV for `nameEncrypted` (12 bytes). Empty string = not set |
| `readOnly` | boolean | Read-only mode: when `true` only the owner can send messages. Default `false` (missing field) |
| `autoBurnAt` | number | Optional: absolute auto-burn instant (Unix ms). Set by owner via `/app/room.setTtl`. When present, activity TTL extension of the hash key is **capped** by this instant; deterministic burn via trigger key below |
| `messageTtl` | number | Optional: room message self-destruct timer in **seconds**; `0` or missing field = off (only global list TTL `messages:{roomId}`). Set by owner via `/app/room.setMessageTtl` |

**TTL:** 30 days (extended on activity, including `/app/room.setName`), but **not above** `autoBurnAt` when the field is set.

### `room:autoburn:{roomId}`

Dedicated trigger key (string value = `roomId`), TTL = `autoBurnAt - now`. **Not** extended by activity. On expiry the Redis keyspace listener runs full BURN_ROOM cascade and broadcasts `ROOM_BURNED`.

```redis
SET room:autoburn:uuid-room-1 uuid-room-1 EX 3600
```

| Operation | Description |
|----------|----------|
| setTtl | `SET` + `EX`/`PX` until `autoBurnAt` |
| Manual burn / auto-burn cascade | `DEL` trigger key along with other room keys |
| Activity | trigger key **not** updated |

### `user:deadman:{internalId}` / `user:deadman:cfg:{internalId}`

Dead man's switch: if the user has not connected for `periodDays` days,
full `burnAllForUser` cascade fires with stored `wipeIdentity`.

Pattern — two linked keys (like `room:autoburn` + room data):

```redis
SET user:deadman:cfg:tg:111222333 '{"periodDays":30,"wipeIdentity":false}'
SET user:deadman:tg:111222333 tg:111222333 EX 2592000
```

| Key | TTL | Description |
|------|-----|----------|
| `user:deadman:{internalId}` | `periodDays` × 86400s | Trigger; value = `internalId`. **Refresh** on every successful STOMP CONNECT |
| `user:deadman:cfg:{internalId}` | **none** (only "eternal" exception in the feature) | JSON `{ periodDays: 7\|30\|90, wipeIdentity: boolean }`. `DEL` on disable or after trigger |

**Trigger:** Redis keyspace `expired` on trigger key → `DeadmanRedisKeyspaceConfig` →
`UserBurnService.burnAllForUser(internalId, wipeIdentity from cfg)` → `DEL cfg`.
Precision — "approximately at expiry" (depends on `notify-keyspace-events` and Redis load);
acceptable for day-scale periods. Docker Compose (`docker-compose.yml`,
`docker-compose.prod.yml`, `docker-compose.ssl.yml`) starts Redis with
`--notify-keyspace-events Ex` so expired-key listeners (room auto-burn, deadman) fire.

**Idempotency:** if the user already burned data manually (`/app/user.burnAll`),
listener does not fail — cfg may be missing or cascade completes with empty result.

**Disable:** `/app/user.setDeadman { enabled: false }` → `DEL` both keys.

### `room_members:{roomId}`

Room members (Set of internalId).

```redis
SADD room_members:uuid-room-1 "d2f44f7b-..." "f74f67a1-..."
```

Deleted on BURN_ROOM.

### `room_key_request_inbox:{ownerInternalId}`

Offline inbox of group-key wrap requests for a room owner (IMP-RCATCH-03 / T2.3).
HASH (not LIST) so a 12s client retry of the same `(roomId, requesterInternalId)` pair
overwrites one field without reading the collection.

Zero-knowledge: **identifiers and timestamp only**. No ciphertext, ECDH pubkey, or
display names. On owner connect the server drains the HASH, checks membership/ban,
then reads a fresh pubkey from `room_member_pubkey:{roomId}`.

```redis
HSET room_key_request_inbox:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33
  "uuid-room-1:f74f67a1-2b3c-4d5e-8f90-abcdef123456"  "1724000000000"

EXPIRE room_key_request_inbox:d2f44f7b-5e67-3c70-8d91-d5f8f4f62a33 604800
```

| Rule | Value |
|------|-------|
| Type | HASH |
| Field | `{roomId}:{requesterInternalId}` |
| Value | `requestedAt` epoch millis (string) |
| TTL | 7 days (refreshed on each `HSET`) |
| Cap | 100 fields; overflow evicts the oldest `requestedAt`, not the newest |
| Dedup | same pair → overwrite timestamp; HASH length does not grow |
| Write | notify-owner branch of `/app/room.requestKeyBundle` only (not the serve-bundle branch) |
| Drain | owner STOMP CONNECT → `HGETALL` + `DEL`, then `RoomJoinRequestEvent.autoApproved` |

### `room_bans:{roomId}`

Room ban list (Set of internalId). Blocks re-join for listed identities.

```redis
SADD room_bans:uuid-room-1 "f74f67a1-2b3c-4d5e-8f90-abcdef123456"
EXPIRE room_bans:uuid-room-1 2592000
```

| Operation | Description |
|----------|----------|
| Ban | `SADD` after kick cleanup (`/app/room.ban`) |
| Unban | `SREM` (`/app/room.unban`) |
| Join enforce | `SISMEMBER` in `requestJoin` / `acceptJoin` → `USER_BANNED` |
| TTL | 30 days; extended on room activity (together with `room:{roomId}`) |
| BURN_ROOM | `DEL room_bans:{roomId}` |

### `room_muted:{roomId}`

Muted members list (Set of internalId). Mute **does not** remove membership and **does not** require rekey.

```redis
SADD room_muted:uuid-room-1 "f74f67a1-2b3c-4d5e-8f90-abcdef123456"
EXPIRE room_muted:uuid-room-1 2592000
```

| Operation | Description |
|----------|----------|
| Mute | `SADD` (`/app/room.mute`); member stays in room |
| Unmute | `SREM` (`/app/room.unmute`) |
| Send enforce | `SISMEMBER` in `/app/room.message.send` → `MUTED` (no queue write) |
| TTL | 30 days; extended on mutations |
| BURN_ROOM | `DEL room_muted:{roomId}` |

### `room_presence:{roomId}`

Ephemeral room member presence (Hash internalId → lastSeenMs). **Connection metadata only** — does not affect message ciphertext or keys.

```redis
HSET room_presence:uuid-room-1 "f74f67a1-2b3c-4d5e-8f90-abcdef123456" "1710000000000"
EXPIRE room_presence:uuid-room-1 600
```

| Field / operation | Description |
|-----------------|----------|
| Hash value | `lastSeenMs` — epoch millis, **rounded down to minute** (privacy) |
| TTL | **10 minutes**; key not extended with room lifetime |
| Connect / subscribe | `HSET` + broadcast `RoomPresenceEvent{ online: true }` on `/topic/room/{roomId}` |
| Disconnect | `HSET` (final lastSeen) + broadcast `{ online: false }` |
| Snapshot | `/app/room.getPresence` → `/user/queue/room-presence` (members only) |
| `online` in snapshot | Global heartbeat (`online:{internalId}`, 30s TTL) ∧ membership |
| BURN_ROOM | `DEL room_presence:{roomId}` (manual burn in `RoomHandler`; auto-burn — TTL fallback) |

### `room_roles:{roomId}`

Member role overlay (Hash internalId → `admin` | `member`). **Owner** role is not stored in this key — source of truth is `room.ownerInternalId`.

```redis
HSET room_roles:uuid-room-1 "f74f67a1-2b3c-4d5e-8f90-abcdef123456" "admin"
EXPIRE room_roles:uuid-room-1 2592000
```

| Operation | Description |
|----------|----------|
| Transfer ownership | `HSET` previous owner → `admin`; `HDEL` for new owner (owner from `room` hash) |
| Set role | `HSET` / `HDEL` for `admin` \| `member` |
| Role resolve | `roleOf`: owner ← `room.ownerInternalId`; admin ← hash; else member |
| TTL | 30 days; extended on mutations |
| BURN_ROOM | `DEL room_roles:{roomId}` |

Ownership transfer (`/app/room.transferOwnership`) **does not** require rekey — new owner is already a member with the group key.

### `invite:{token}`

Invite token for invitation links. Reverse index: `room_invites:{roomId}` (Set of token strings).

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

> (`InviteTokenRepository`). Index may outlive the room; fix is a separate
> backend task, not in scope of this spec.

| Field | Type | Description |
|------|-----|----------|
| `token` | string | 64-char hex (32 random bytes) |
| `roomId` | string | Room UUID |
| `createdBy` | string | Creator Telegram ID; `""` for wallet-only owner |
| `createdAt` | string (ms) | Unix ms token creation |
| `expiresAt` | string (ms) | Unix ms expiry |
| `maxUses` | string | Successful join limit; empty = unlimited |
| `usedCount` | string | Usage counter (HINCRBY on join) |

**Enforcement:**
- On join: `usedCount++` (atomic); if `usedCount >= maxUses` (and `maxUses > 0`) → token deleted (`DEL invite:{token}` + `SREM room_invites:{roomId}`), client gets `INVITE_EXHAUSTED`.
- If `usedCount >= maxUses` before join → `INVITE_EXHAUSTED`, token deleted.
- If `expiresAt < now` → `INVITE_EXPIRED`, token deleted.
- Owner-only: `/app/room.revokeInvite`, `/app/room.getInvites`.
- `GET_INVITE_LINK` accepts optional `expiresInSeconds`, `maxUses` (0/missing = unlimited).

**TTL:** `EXPIRE` = `expiresAt - now` (default 7 days when created without `expiresInSeconds`).

### `dm_invite:{token}`

Opaque **personal DM** invite (IMP-DMINVITE-01). Separate from room `invite:{token}`.
Reverse index: `dm_invites:{ownerInternalId}` (Set of token strings). Scanner redeems →
normal `ChatRequest` (redeemer = initiator, owner = recipient).

```redis
HSET dm_invite:abc123token
  token            "abc123token"
  ownerInternalId  "550e8400-e29b-41d4-a716-446655440000"
  expiresAt        "1704067800000"
  maxUses          "1"
  usedCount        "0"

SADD dm_invites:550e8400-e29b-41d4-a716-446655440000 "abc123token"
EXPIRE dm_invite:abc123token 600
```

| Field | Type | Description |
|------|-----|----------|
| `token` | string | 64-char hex (32 random bytes) |
| `ownerInternalId` | string | Invite owner (ChatRequest recipient) |
| `expiresAt` | string (ms) | Unix ms expiry |
| `maxUses` | string | Redemption cap (v1 default **1**) |
| `usedCount` | string | Counter (HINCRBY before `createSession`) |

**Enforcement:**
- Mint: PoW `dm_invite` + rate limit `DM_INVITE_MINT` (3/min), after PoW.
- Redeem: no heavy PoW; `DM_INVITE_REDEEM` (10/min); consume use **before** session create.
- Errors: `DM_INVITE_NOT_FOUND`, `DM_INVITE_EXPIRED`, `DM_INVITE_EXHAUSTED`, `SELF_REDEEM`.
- Multiple active tokens per owner allowed.

**TTL:** `EXPIRE` = `expiresAt - now` (default **10 minutes**).

**Deep link:** `{mini-app.url}/join#dm_invite_{token}` or `startapp=dm_invite_{token}` (see TELEGRAM.md).

### `room_join_request:{roomId}:{senderInternalId}`

Room join request (`by_request` mode). Hash per applicant; index `room_join_requests:{roomId}` (Set of `senderInternalId`).

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

Legacy keys `room_join_request:{roomId}` (list by `senderTgId`) are not migrated — TTL 24 h.

**TTL:** 24 hours

### `room_keys:{roomId}:{epoch}`

Encrypted copies of the group key for members (opaque blobs). Recipient index is `recipientInternalId` in `EncryptedKeyBundle`. Server does not decrypt.


### `messages:{roomId}`

Room encrypted message queue. Format — `RoomMessage` (E2EE):

| Field | Description |
|------|----------|
| `senderInternalId` | **Primary** — canonical sender (required for new records) |
| `senderTgId` | Deprecated; best-effort for Telegram sender |
| `encryptedContent`, `iv`, `messageId`, … | Opaque ciphertext |

`RoomMessage.getSenderKey()` resolves identity for edit/delete and legacy JSON (`senderTgId` only). Overflow: `max-size-per-room` (default 500). **Key TTL:** `burnedchats.messages.offline-queue.ttl` (24 h).

**Per-room message TTL:** when `room:{roomId}` has `messageTtl > 0`, server on
`/app/room.message.send`, `/app/room.message.sync`, and `/app/room.setMessageTtl` performs **lazy prune**:
removes list elements with `serverTimestamp` (fallback `clientTimestamp`) older than `now - messageTtl`.
Server does not decrypt ciphertext — only time metadata. `messageTtl = 0` — prune disabled,
only the list key TTL applies.

---

## Files (Redis)

> Implementation: `FileMetadataRepository`, `FileMetadata`.

### `file_meta:{fileId}`

Hash with metadata for **one** uploaded encrypted blob (main file or thumbnail). `fileId` — UUID, matches on-disk filename without extension (`{fileId}.enc`).

```redis
HSET file_meta:550e8400-e29b-41d4-a716-446655440000
  uploaderInternalId "tg:123456789"
  uploaderTgId       "123456789"
  contextType        "session"
  contextId          "session-uuid-or-room-uuid"
  size               "1048576"
  createdAt          "1705312200000"

EXPIRE file_meta:550e8400-e29b-41d4-a716-446655440000 86400
# TTL = max(default 24h, room.messageTtl) capped by remaining room:{id} TTL (IMP-FILEUX-01)
```

| Field | Type | Description |
|------|-----|----------|
| `uploaderInternalId` | string | Canonical uploader `internalId` (Telegram and wallet) |
| `uploaderTgId` | string | Optional: uploader Telegram ID (legacy / best-effort) |
| `contextType` | string | `session` or `room` |
| `contextId` | string | Session or room ID |
| `size` | long (string) | Size of stored **encrypted** blob in bytes |
| `createdAt` | long (string) | Unix time (ms) |

**TTL:** 24 hours by default (`FileStorageProperties.metadataTtl`), synchronized with cleanup and burn cascade.

### `file_context:{contextId}`

**Set** of `fileId` bound to one session or room. Used for cascading file deletion on session/room burn (`FileBurnService`): for each `fileId` in the list, `file_meta:*` records, filesystem objects, and set members are removed.

**TTL:** extended on each file add (like `file_meta`) so the index does not outlive metadata.

---

## Ciphertext Encoding Format (encoding contract)

All cryptographic blobs at the **frontend ↔ backend ↔ Redis** boundary are encoded as
**standard Base64** (RFC 4648 §4, alphabet `A–Z a–z 0–9 + /` with `=`-padding) —
**not** base64url (`-`/`_`). The contract is uniform for all fields:

| Field | Purpose | Where |
|------|------------|-----|
| `encryptedContent` | AES-GCM ciphertext of message / media payload | room messages, DM, edit events |
| `iv` | 12-byte GCM IV for `encryptedContent` | same |
| `encryptedMeta` | file metadata ciphertext (`{ fileName, mimeType }`) | media messages |
| `nameEncrypted` | room name ciphertext | `room:{roomId}`, `CREATE_ROOM` (optional), `ROOM_NAME_UPDATED`, room-list |
| `nameIv` | 12-byte GCM IV for `nameEncrypted` | same |
| key-bundle: `ephemeralPublicKey`, `encryptedKey`, `iv` | wrapped group key (ECDH + AES-GCM) | `KEY_BUNDLE`, `room_keys:{roomId}:{epoch}` |
| `salt`, `passwordProof`, `*PublicKey` | KDF salt / PoW proof / ECDH pubkeys | CREATE_ROOM, JOIN |

**Implementation (source of truth):**

- **Frontend** — `frontend/src/crypto/aes.ts`: `arrayBufferToBase64` uses `btoa`,
  `base64ToArrayBuffer` — `atob` (standard Base64). Same helpers apply to
  `encryptRoomName` (`crypto/groupKey.ts`) → `{ nameEncrypted, nameIv }`.
- **Backend** — Base64 on wire is validated via `@Pattern(regexp = "^[A-Za-z0-9+/]+=*$")`
  on DTO fields and/or manual `java.util.Base64.getDecoder()` (standard, **not**
  `getUrlDecoder()`) in services/handlers (e.g. `HandshakeHandler.isValidBase64Key`,
  `PasswordProofService`). No separate `@Base64` / `Base64Validator` in code.

**Zero-knowledge invariant.** Server stores and relays these fields as **opaque strings**
and **never** decodes/decrypts content — only metadata (length for
validation, timestamps for prune). Server does not see encryption keys.

> inconsistently. No base64 vs base64url mismatches **were found** — contract is unified.

---

## Java DTOs

### Session Entity

```java
// model/Session.java — participants by internalId
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
// model/FileMetadata.java — see FileMetadataRepository (Redis Hash file_meta:{fileId})
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

### Message (1-to-1, queue + STOMP)

Offline queue and new-message event use **`Message`** model with file fields for `image`, `video`, `file` types:

```java
// model/Message.java (fragment)
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

**Message type:** `text` \| `image` \| `video` \| `file`. For non-text, `fileId` is required (`FileMessageValidator` validation).

### Telegram User (Redis cache)

```java
// model/TelegramUser.java — cache in user:{tgId}, not wire DTO Bot API
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


// dto/request/SendMessageRequest.java — STOMP /app/message.send (see API.md)
// For type ∈ { image, video, file }, fileId is required (@ValidFileMessage)
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


```java
// dto/response/UserResponse.java — peer/sender/recipient in all events
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

**WebSocket errors:** `WebSocketExceptionHandler.baseError` sends `Map<String,Object>`
to `/user/queue/errors` with fields `success=false`, **`error`** (error code),
`message`, `timestamp` (ISO-8601); optional `retryAfter` (RATE_LIMIT_EXCEEDED)
and `field` (VALIDATION_ERROR). No separate `ErrorEvent` DTO. Frontend reads
`data.error` (`useSession.ts`).

---

## TypeScript types

Source of truth: `frontend/src/types/index.ts`.

## Data Validation

### Java Bean Validation

Actual class: `util/ValidationConstants.java` (not `validation/`).

```java
// util/ValidationConstants.java
public final class ValidationConstants {

    /** Maximum accepted encrypted blob size (bytes).
     *  Plaintext up to ~25 MB + AES-GCM/chunked header → ceiling 26 MB. */
    public static final long MAX_ENCRYPTED_FILE_SIZE = 26 * 1024 * 1024;

    /** POST /api/files/upload per-user limit (see RateLimitService.RateLimitType.FILE_UPLOAD). */
    public static final int FILE_UPLOAD_RATE_LIMIT = 10;

    /** Valid context types for file uploads. */
    public static final String CONTEXT_TYPE_SESSION = "session";
    public static final String CONTEXT_TYPE_ROOM = "room";

    private ValidationConstants() {}
}
```

### Base64 validation (no custom `@Base64`)

No separate `Base64Validator` / `@Base64` annotation in the repository. DTOs use
`@Pattern(regexp = "^[A-Za-z0-9+/]+=*$")`; additional length/decode checks use
manual `Base64.getDecoder()` in handlers and services
(e.g. `HandshakeHandler.isValidBase64Key`, `PasswordProofService`).

### Crypto / message size reference (descriptive)

These values are **not** declared in `ValidationConstants`; they are set by
`@Size` / `@Pattern` on DTOs and client crypto code.

| Quantity | Value | Where set |
|----------|----------|------------|
| AES-GCM IV | 12 bytes (Base64 wire ≈ 16–24 chars) | `SendMessageRequest.iv` `@Size(min=16,max=24)` |
| GCM auth tag | 16 bytes (included in Web Crypto ciphertext) | client / SECURITY.md |
| P-256 SPKI public key (Base64) | `@Size(min=44, max=256)` | `PublicKeyRequest.publicKey` |
| Text message (product guideline) | ≤ 4096 chars plaintext | client UX; on wire — encrypted blob ≤ 64 KB |
| `fileName` (in encryptedMeta) | ≤ 255 chars | client + `encryptFileMetadata` |

### Limits Summary

| Field / rule | Limit | Reason |
|----------------|-------|---------|
| `text` (plaintext UX) | 4096 chars | Optimal for chat |
| Encrypted blob upload | ≤ `MAX_ENCRYPTED_FILE_SIZE` (26 MB) | Server ceiling; plaintext and MIME are product guidelines (see SECURITY.md) |
| `POST /api/files/upload` | `FILE_UPLOAD_RATE_LIMIT` (10) / 1 min | Redis rate limit per user |
| `fileName` | 255 chars | Client + `encryptFileMetadata` |
| `sessionId` | UUID v4 | Collision resistance |
| `IV` | 12 bytes | AES-GCM standard |
| GCM `tag` | 16 bytes | Included in Web Crypto ciphertext output |
| `SearchRequest.query` | 1–64 chars | `SearchRequest` `@Size` |
| `AcceptSessionRequest.secretAnswer` | ≤ 256 chars | `AcceptSessionRequest` `@Size` |
| `PublicKeyRequest.publicKey` | 44–256 chars Base64 | `PublicKeyRequest` `@Size` |

---

## Related Documents

- [API.md](./API.md) — WebSocket events
- [SECURITY.md](./SECURITY.md) — cryptographic primitives
- [ARCHITECTURE.md](./ARCHITECTURE.md) — overall architecture
