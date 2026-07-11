# API Specification

> WebSocket (STOMP) events and REST endpoints (Java Backend)

## 📋 Table of Contents

- [General Information](#general-information)
- [REST API](#rest-api)
- [WebSocket API (STOMP)](#websocket-api-stomp)
- [Data Types](#data-types)
- [Error Codes](#error-codes)

---

## General Information

### Base URL

```
Production: https://api.burnedchats.com
Development: http://localhost:8080
```

### Authentication

**Auth happens on the HTTP WebSocket handshake** (`StompHandshakeAuthInterceptor` +
`StompIdentityAuthService`), not in STOMP `CONNECT`. The client passes credentials in
handshake headers (and duplicates them in query parameters for SockJS). STOMP `CONNECT`
only confirms that the principal is already set (`StompAuthInterceptor`);
there is no repeated Redis authentication on `CONNECT`.

Modes:

- `telegram` (default when `X-Auth-Type` is absent): `X-Telegram-Init-Data`
- `wallet`: `X-Auth-Type: wallet` + `X-Auth-Token` (opaque session token from `POST /api/auth/wallet`)

```typescript
// Frontend — auth on HTTP handshake (SockJS / raw WS), not CONNECT-only
const client = new Client({
  webSocketFactory: () => new SockJS(
    // query parameters required for SockJS (custom handshake headers unavailable)
    `https://api.burnedchats.com/ws?X-Auth-Type=telegram&X-Telegram-Init-Data=${encodeURIComponent(initData)}`
  ),
  // connectHeaders optional for raw WebSocket; for SockJS credentials are already in the URL
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

Handshake without credentials is allowed (connection comes up unauthenticated);
invalid credentials → handshake **rejected**. `Principal#getName()` =
`UnifiedUser.internalId()` (UUID), not Telegram numeric ID.

Compatibility: backend also accepts legacy header/query names `auth-type` / `auth-token`.

### Rate Limits

| Endpoint/event | Limit | Window | Notes |
|------------------|-------|------|------------|
| REST `/api/auth/**` | 20 req | 1 min | `RestRateLimitInterceptor` (by IP / token) |
| REST `/api/wallet/**`, `/api/governance/**` | 60 req | 1 min | same interceptor |
| REST `/api/files/**` | — | — | **outside** REST interceptor; upload — separate bucket |
| `POST /api/files/upload` | 10 req | 1 min | `FILE_UPLOAD` (`FileValidationService`) |
| `SEARCH_USER` (`/app/search`) | 10 req | 1 min | `SEARCH` |
| `SEND_MESSAGE` (`/app/message.send`, `/app/message.sync`) | 60 msg | 1 min | `MESSAGE` (`RateLimitService`; yaml `rate-limit.messages.per-minute`) |
| `CREATE_SESSION` (`/app/session.create`) | 3 req | 1 min | `SESSION_CREATE` (after PoW) |
| `session.accept` / `session.reject` / `verification.confirm`; `room.kick` / `room.ban` / `room.mute` | 10 req | 1 min | `SESSION_ACTION` (accept/reject — in `RateLimitInterceptor`; kick/ban/mute — `enforceRateLimit` in `RoomHandler`) |
| `handshake.key` (`/app/handshake.key`) | 10 req | 1 min | `HANDSHAKE` |
| `message.edit` / `room.message.edit` | 10 req | 1 min | `MESSAGE_EDIT` |
| `message.delete` / `room.message.delete` | 30 req | 1 min | `MESSAGE_DELETE` |
| `room.getMembers` / `room.getPresence` / `room.getBans` | 30 req | 1 min | `ROOM_READ` |
| `pow.challenge` (`/app/pow.challenge`) | 10 req | 1 min | `POW_CHALLENGE` (`PowHandler`, not interceptor) |
| Failed room password proof (`room.requestJoin`) | 5 fails | 10 min | `ROOM_PASSWORD_FAIL` — key `ratelimit:room_password_fail:{roomId}:{internalId}`; yaml `rate-limit.room-password-fail.*`; atomic INCR per attempt, reset on success |
| Other unmapped `/app/*` | 100 req | 1 min | `GENERAL` fallback in `RateLimitInterceptor` |
| `/app/heartbeat` | exempt | — | presence heartbeat |

When a STOMP limit is exceeded, the SEND frame is dropped; the client receives
`RATE_LIMIT_EXCEEDED` on `/user/queue/errors` (connection stays open).

### REST (files): authentication

File endpoints support the same two modes as the WebSocket handshake:

| Mode | Headers |
|-------|-----------|
| `telegram` (default) | `X-Auth-Type: telegram` (optional) + `X-Telegram-Init-Data` |
| `wallet` | `X-Auth-Type: wallet` + `X-Auth-Token` (opaque session token from `POST /api/auth/wallet`) |

```http
# Telegram (legacy — without X-Auth-Type, initData only)
X-Telegram-Init-Data: <query string from Telegram.WebApp.initData>

# Wallet
X-Auth-Type: wallet
X-Auth-Token: <session-token>
```

Missing or invalid credentials → **401**. Context membership is verified by `internalId`
in both modes.

---

## REST API

### Health Check

Custom endpoints (`HealthController`, prefix `/api`):

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
(Redis via `RedisHealthService`).

Spring Actuator is also available: `GET /actuator/health`, `GET /actuator/info`
(see `application.yml` management endpoints).

### Application Info

```http
GET /api/info
```

**Response** (`HealthController` — version is **hardcoded**):
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

> Actuator `/actuator/info` may return `info.app.version` from Maven
> (`@project.version@`) — that is a **separate** endpoint; the canonical version for clients is
> `/api/info` → `0.1.0-SNAPSHOT`.

### Wallet auth (Phase 3): nonce for Ton Connect

#### `GET /api/auth/nonce`

Issues a short-lived opaque string for the Ton Connect `tonProof` field in the connect request (`ConnectAdditionalRequest.tonProof`). The wallet returns a signed `ton_proof`; the backend verifies the signature against this nonce (replay protection).

**Response `200 OK`:**

```json
{
  "nonce": "<opaque server-generated string>"
}
```

The client also accepts the `payload` field as a synonym for `nonce` for backward compatibility.

**Notes:**

- Request authorization requirements (public endpoint vs session binding) are defined by the backend implementation; rate limiting is recommended.
- Base URL is the same as in [Base URL](#base-url); in frontend dev without `VITE_API_URL`, the relative path `/api/auth/nonce` is used (Vite proxy).

#### `POST /api/auth/wallet`

Verifies TON `walletProof` (format: serialized `ton_proof` JSON from Ton Connect) and issues an opaque session token for STOMP.

**Request body:**

```json
{
  "walletAddress": "EQBx7...",
  "walletProof": "{\"address\":\"EQBx7...\",\"proof\":{\"timestamp\":1679312400,\"domain\":{\"value\":\"burnedchats.net\",\"lengthBytes\":16},\"signature\":\"base64...\",\"payload\":\"nonce\"}}",
  "walletPublicKey": "0a1b2c3...",
  "walletStateInit": "te6cckEC..."
}
```

`walletPublicKey` (hex, 32 bytes) and `walletStateInit` (base64 BoC) are **optional**, but must be sent **as a pair**.
If both are present, the backend verifies `publicKey ↔ stateInit ↔ address` locally (no RPC to toncenter).
If absent — legacy fallback via toncenter is used (see `BURNEDCHATS_TON_API_KEY`).

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

**Errors:**

Error body (JSON):

```json
{
  "error": "Unauthorized",
  "code": "DOMAIN_MISMATCH",
  "message": "TON proof domain mismatch (expected: burnedchats.net, got: www.burnedchats.net)"
}
```

The `code` field is a machine-readable reason (`WalletProofException.Reason.name()`). The `error` field is kept for backward compatibility.

| HTTP | `code` (examples) | When |
|------|------------------|-------|
| `400` | `INVALID_REQUEST`, `ADDRESS_INVALID` | Empty/corrupt body, invalid address or JSON proof |
| `401` | `PROOF_EXPIRED`, `DOMAIN_MISMATCH`, `NONCE_UNKNOWN`, `SIGNATURE_INVALID`, … | Client proof error (see full list in backend `WalletProofException.Reason`) |
| `502` | `PUBLIC_KEY_UNAVAILABLE` | toncenter unavailable / did not return `public_key` (transient; retry makes sense) |
| `500` | `INTERNAL` | Unexpected backend error |

Full `code` → HTTP mapping:

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

- `500 Internal Server Error` — internal error when issuing token (`INTERNAL` or unhandled exception).

#### `POST /api/auth/dev-login` (dev profile only)

> **Not present in production.** The controller exists only under the Spring profile
> `dev` AND when `DEV_AUTH_ENABLED=true` (default `false`). Production runs on
> `prod,testnet` — the endpoint returns 404. Purpose: local development and automated UI testing
> (dev profile only).

Issues a regular opaque session token for synthetic identity `dev-{label}`
without verifying `ton_proof`. Response contract is identical to `POST /api/auth/wallet`.

**Request body:** `{ "label": "agent-a" }` — `label` must match `[a-z0-9-]{1,32}`.

**Response `200 OK`:** `{ "token": "<opaque>", "user": { "internalId": "<uuid>", "displayName": "dev-...nt-a" } }`

**Errors:** `400` — invalid `label`; `404` — disabled by flag or prod profile; `500` — Redis error.

---

### Account linking (Phase 3): Telegram ↔ TON wallet

All endpoints below **do not** require a Spring Security cookie: trust is built on valid `initData` (Telegram) and/or verified `walletProof` / opaque `sessionToken`.

#### `POST /api/auth/link-wallet`

Link a wallet to a user signed in via Mini App.

**Request body:**

```json
{
  "initData": "...",
  "walletAddress": "EQBx7...",
  "walletProof": "{... Ton Connect ton_proof JSON ...}"
}
```

**Response `200 OK`:** object in the "linked accounts" shape (see `POST /api/auth/linked-accounts`).

**Errors:** `400` — invalid body; `401` — initData / proof; `409` — wallet or another wallet already linked to another account / unlink first; `500` — internal error.

**Failure body (example):**

```json
{
  "error": "Unauthorized",
  "code": "SIGNATURE_INVALID",
  "message": "TON proof signature verification failed"
}
```

| `code` | HTTP | Description |
|--------|------|----------|
| `SIGNATURE_INVALID`, `PROOF_EXPIRED`, `NONCE_UNKNOWN`, … | 401 | Rejected `ton_proof` (same codes as `POST /api/auth/wallet`) |
| `CONFLICT` | 409 | Wallet already linked to another account or user has a different wallet |
| `INTERNAL` | 500 | Unhandled server / Redis error |

#### `POST /api/auth/link-telegram/challenge`

For a **wallet-only** session (opaque token after `POST /api/auth/wallet`): creates a one-time challenge in Redis (TTL ~15 min).

**Request body:** `{ "sessionToken": "<opaque>" }`

**Response `200 OK`:** `{ "ok": true, "challengeId": "<32 hex>", "telegramLink": "https://t.me/<bot>?startapp=lt_<challengeId>" }`  
The `telegramLink` field may be absent if `telegram.bot.username` is not set in config.

#### `POST /api/auth/link-telegram/complete`

Complete Telegram linking from Mini App: `start_param` has the form `lt_<challengeId>`.

**Request body:** `{ "challengeId": "<32 hex>", "initData": "..." }`

**Response `200 OK`:** same as `linked-accounts`.

**Errors:** `401` — expired challenge / invalid initData; `409` — Telegram already linked to another internalId.

#### `POST /api/auth/linked-accounts`

Snapshot of links for the current user. Exactly one of:

```json
{ "initData": "...", "sessionToken": null }
```

or

```json
{ "initData": null, "sessionToken": "..." }
```

**Response `200 OK` (example):**

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

Body: `{ "initData": "..." }`. Unlinks the wallet if Telegram remains linked (`400` if it is the only sign-in method).

#### `POST /api/auth/unlink-telegram`

Body: `{ "sessionToken": "..." }`. Unlinks Telegram if a wallet remains.

---

### REST API: Files (Phase 4)

Upload and download of **client-encrypted** blobs. Request/response body is a raw binary stream (`application/octet-stream`), not JSON.

#### `POST /api/files/upload`

Stores one encrypted file (main media file or thumbnail) and creates metadata in Redis (`file_meta:{fileId}`, TTL 24 h).

**Headers:**

| Header | Required | Description |
|-----------|-------------|----------|
| `X-Auth-Type` | No | `telegram` \| `wallet`; default `telegram` |
| `X-Telegram-Init-Data` | Yes* | Valid initData (`telegram` mode) |
| `X-Auth-Token` | Yes* | Opaque session token (`wallet` mode) |
| `X-Context-Type` | Yes | `session` \| `room` |
| `X-Context-Id` | Yes | Session or room UUID |
| `Content-Type` | Yes | `application/octet-stream` |
| `Content-Length` | Yes | Size of the uploaded **encrypted** blob in bytes (≥ 1) |

\* One auth mode is required: for `telegram` — `X-Telegram-Init-Data`, for `wallet` — `X-Auth-Token`.

**Body:** stream of encrypted data bytes (see [SECURITY.md](./SECURITY.md) — client blob format).

**Response `200 OK`:**

```json
{
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "size": 1048576
}
```

`size` — size of the **encrypted** blob stored on the server (ciphertext bytes), not the original plaintext file. For STOMP `fileSize`, the client passes plaintext size separately (see below).

**Errors (JSON body, except 429 where noted):**

| HTTP | `error` field | When |
|------|--------------|--------|
| 401 | `AUTH_ERROR` / code from `AuthenticationException` | Missing, invalid, or expired auth credentials (initData or session token) |
| 400 | `INVALID_CONTEXT_TYPE` | `X-Context-Type` is neither `session` nor `room` |
| 400 | `FILE_SIZE_INVALID` | On-disk size does not match `Content-Length` after upload |
| 403 | `ACCESS_DENIED` | User is not a session participant / room member |
| 404 | `CONTEXT_NOT_FOUND` | Session not found (for `session`) |
| 413 | `FILE_TOO_LARGE` | Size outside allowed range (see `ValidationConstants.MAX_ENCRYPTED_FILE_SIZE`) |
| 429 | `RATE_LIMIT_EXCEEDED` | Upload limit exceeded; `Retry-After` header and `retryAfter` field in JSON may be present |

Example body for 429:

```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "...",
  "retryAfter": 45
}
```

#### `GET /api/files/{fileId}`

Returns the **same** encrypted blob if the caller is a member of the context (session/room) the file is bound to.

**Headers:**

| Header | Required | Description |
|-----------|-------------|----------|
| `X-Auth-Type` | No | `telegram` \| `wallet`; default `telegram` |
| `X-Telegram-Init-Data` | Yes* | Valid initData (`telegram` mode) |
| `X-Auth-Token` | Yes* | Opaque session token (`wallet` mode) |

\* One auth mode is required (see upload).

**Response `200 OK`:**

- `Content-Type: application/octet-stream`
- `Cache-Control: no-store`
- Body: encrypted file bytes

**Errors (JSON):**

| HTTP | `error` field | When |
|------|--------------|--------|
| 401 | `AUTH_ERROR` | Missing, invalid, or expired auth credentials |
| 403 | `ACCESS_DENIED` | No access to file context |
| 404 | `FILE_NOT_FOUND` | No metadata, TTL expired, or file missing on disk |

> The semantics "no file access" in discussions is sometimes labeled `FILE_ACCESS_DENIED`; REST JSON responses use code **`ACCESS_DENIED`**.

---

### Telegram Webhook

```http
POST /api/telegram/webhook
```

Handles incoming updates from the Telegram Bot API.
Controller: `TelegramWebhookController` (`@RequestMapping("/api/telegram")` +
`@PostMapping("/webhook")`). Enabled when `telegram.bot.webhook.enabled=true`.

**Headers:**
```http
X-Telegram-Bot-Api-Secret-Token: <webhook_secret>
Content-Type: application/json
```

**Body:** Telegram Update object

**Bot commands (when processed by `BurnedChatsWebhookBot` / `BurnedChatsBot`):**

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + Mini App launch button |
| `/help` | Help text |
| `/burn` | Remote burn-all: inline keyboard with **Burn all data** (`wipeIdentity=false`), **Burn account** (`wipeIdentity=true`), and **Cancel**. Callback `callback_data`: `burnall:{nonce}:{data\|account\|cancel}`. Nonce stored at Redis `bot:burn:nonce:{nonce}` → `internalId`, TTL **60s**, one-time (`GETDEL`). Resolves `tgId` via `UserIdentityRepository.findByTelegramId`. Unknown `tgId` → polite «no data» reply (no error, no leak). On confirm: `UserBurnService.burnAllForUser` + STOMP `/user/queue/burn-all-complete` to active sessions; bot sends HTML summary message. |

Invalid secret → **401**. Nginx prod proxies the same path
(`/api/telegram/webhook`).

---

### Phase 5: BURN jetton / staking / governance (backend read services)

Public **read-only** GET for governance Mini App (cache + TON RPC via `GovernanceVerifier`):

| Method | Path | Description |
|-------|------|----------|
| `GET` | `/api/governance/active-proposals` | `Flux<ProposalSummary>` — proposals in `ACTIVE` state |
| `GET` | `/api/governance/recent-proposals?limit=` | Last N proposals by id (descending) |
| `GET` | `/api/governance/proposals/{id}` | `ProposalDetail` (summary + decoded payload + quorum / threshold bps) |
| `GET` | `/api/governance/proposals/{proposalId}/vote?address=` | `UserVote` or **404** if the user has not voted |
| `GET` | `/api/governance/voting-power?address=` | `{ "votingPower": "<bigint string>" }` — VP via `StakingVerifier` |

Bodies match `dev.burnedchats.ton.dto.*` (`ProposalSummary`, `ProposalDetail`, `UserVote`). Jackson serializes enums as strings (`PARAMETER_CHANGE`, …).

**Voting window and `ACTIVE` state**

- `GET /api/governance/active-proposals` and `ProposalSummary.state == ACTIVE` include the **pre-vote window** `CANCEL_LAG` (**3600 s**): on-chain proposal in `PS_ACTIVE`, but voting is **not yet open** (proposer can cancel the proposal; see the relevant spec section).
- `startTime = creationTime + CANCEL_LAG` (`governor.tact`); voting is available only when **`now >= startTime`** and `now <= endTime`.
- Voting before `startTime` is rejected on-chain: `Proposal.ProposalVoteRelay` → `require(t >= self.startTime, "Not started")` → **exit code `54220`** (bounce; vote not counted).
- The client must block `CastVote` while `now < startTime`, even if the backend returns `ACTIVE`.

**On-chain vote relay flow and gas budget**

| Step | From → To | Message | Value (TON) | Notes |
|-----|--------|-----------|-------------|------------|
| 1 | Wallet → **Governor** | `CastVote` (`0x5a040102`) | attach **≥ `GasVoteAttach` = 0.18** | `require(context().value >= GasVoteAttach, "Need TON for vote")` |
| 2 | Governor → **StakingMaster** | `GovernorVoteRelay` (`0x5a040019`) | **`value: 0`** | `SendRemainingValue`; VP relay |
| 3 | StakingMaster → **Proposal** | `ProposalVoteRelay` (`0x5a040011`) | **`value: 0`** | `SendRemainingValue`; VP cap from on-chain staking |

- Successful vote: relay remainder is returned to the **voter** from Proposal (`SendRemainingValue | SendIgnoreErrors`).
- Bounce (rejection at Governor/StakingMaster): value is **consumed** at the hop without `cashback` — voter does not get a refund from truncated bounce body (RC-2 / AD-1).
- Source of constants: `contracts/governance/governor.tact`; mirror — `contracts/wrappers/Governor.ts` (`GOVERNOR_VOTE_ATTACH_NANO`), `frontend/src/ton/transactionBuilder.ts` (`VOTE_ATTACHED_TON`).

Public **read-only** GET for on-chain wallet data (cache + TON RPC via **`JettonService`**):

| Method | Path | Description |
|-------|------|----------|
| `GET` | `/api/wallet/burn-balance?address=` | BURN jetton balance in nano; no auth |
| `GET` | `/api/wallet/jetton-wallet?address=` | Owner's BURN jetton wallet address; no auth |
| `GET` | `/api/wallet/staking-profile?address=` | Wallet staking profile (stakes, voting power); no auth |

**`GET /api/wallet/burn-balance`**

- Query `address` (required): friendly (`EQ…` / `0Q…`) or raw TON address.
- **200 OK:** `{ "balanceNano": "<decimal string>", "address": "<trimmed query address>" }` — `balanceNano` from `BigInteger`, not a JSON number.
- **400:** `{ "message": "…" }` — missing/empty `address` or invalid format.
- **502:** `{ "message": "…" }` — Ton Center / contract read failure (`TonRpcException`).

Frontend (`burnToken.ts`) accepts `balanceNano`, `nano`, or `balance` fields in the body; on `404`/`501` falls back to Ton Center RPC from the browser.

**`GET /api/wallet/jetton-wallet`**

- Query `address` (required): friendly (`EQ…` / `0Q…`) or raw TON address of the owner.
- **200 OK:** `{ "jettonWalletAddress": "<friendly|null>", "ownerAddress": "<trimmed query address>" }` — `jettonWalletAddress` is `null` if the jetton wallet is absent or the address could not be computed (non-zero contract exit / zero address); this is **not** an HTTP error.
- **400:** `{ "message": "…" }` — missing/empty `address` or invalid format.
- **502:** `{ "message": "…" }` — Ton Center / transport failure (`TonRpcException`).

Frontend (`burnToken.ts`) calls this endpoint first; on `404`/`501`, `502` (after one retry), or `jettonWalletAddress: null` falls back to Ton Center RPC from the browser (`jettonWalletResolve.ts`).

**`GET /api/wallet/staking-profile`**

- Query `address` (required): friendly (`EQ…` / `0Q…`) or raw TON address of the owner.
- **200 OK:** `UserStakingProfile` — `{ "address", "highestTier", "totalStakedNano", "votingPowerNano", "stakes": [ … ] }`.
  - `highestTier`: `"FLEXIBLE"` | `"SILVER"` | `"GOLD"` | `"DIAMOND"` | `null` (no active stakes).
  - `totalStakedNano`, `votingPowerNano`, `stakes[].amount`, `stakes[].pendingRewards` — decimal string or JSON number (parsed by frontend via `bigIntFromJsonField`).
  - Each `stakes[]` element: `{ "tier", "amount", "startTime", "unlockTime", "lastClaimTime", "pendingRewards" }` — format read by `mapBackendStake` in `staking.ts`.
- **400:** `{ "message": "…" }` — missing/empty `address` or invalid format.
- **502:** `{ "message": "…" }` — Ton Center / contract read failure (`TonRpcException`).

Implementation: `WalletController` → `StakingVerifier.getStakingProfile` (Redis profile cache, TTL 30 s). Frontend (`staking.ts` → `tryBackendStakes`) on `200` uses `stakes`; on `404`/`501` falls back to Ton Center RPC from the browser.

---

## WebSocket API (STOMP)

### User destinations and recipient identifier (backend)

Subscriptions of the form `/user/queue/...` are routed by Spring using the **principal name** of the STOMP session. After the identity migration, this name is **`UnifiedUser.internalId()`** (UUID string), the same value returned by `Principal#getName()` for `TelegramPrincipal` / `WalletPrincipal`. **Do not** pass a numeric Telegram ID or `String.valueOf(telegramId)` as the first argument to `SimpMessagingTemplate#convertAndSendToUser` — the message will not reach the client. Server-side delivery to personal queues must use **`internalId`** (including via the `StompUserMessenger` component).

### Unified identity (`internalId`)

> **The canonical wire address identifier is `internalId` (UUID string).** Numeric Telegram ID (`Long`) remains an optional field for Telegram-linked users and is **not used** for STOMP routing.

| Principal | STOMP auth | `Principal#getName()` | `telegramId` |
|-----------|------------|----------------------|--------------|
| `TelegramPrincipal` | `X-Auth-Type: telegram` + initData | `internalId` | present |
| `WalletPrincipal` | `X-Auth-Type: wallet` + session token | `internalId` (random UUID) | **absent** |

**Contract rules (additive vs break):**

| Area | Policy | Notes |
|---------|----------|------------|
| Search, DM sessions, join flow | **Additive** — new `*InternalId` + optional deprecated `*TgId` / `recipientId` | Legacy Telegram clients keep working until frontend migration |
| Group keys (KEY_BUNDLE, REKEY) | **Break** — `recipientInternalId` only | Wallet-only members have no TG ID |
| Room messages | **Additive** — `senderInternalId` primary, `senderTgId` optional | Legacy Redis records read via `getSenderKey()` |

**Telegram-only degradation (best-effort, no client error):**

- Bot notifications for offline DM / chat request — only when `telegramId != null`.
- File upload in rooms — ownership validation by `uploaderInternalId` (canonical `internalId`); legacy fallback by `uploaderTgId` for old metadata.

Handlers use `AppPrincipal` / `internalId`; casting to `(TelegramPrincipal)` in business logic is **forbidden**.

### Connection

```typescript
// Frontend - STOMP Client (auth on HTTP handshake; see Authentication)
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
    // Personal queues — current names from code
    client.subscribe('/user/queue/new-message', handleMessage);
    client.subscribe('/user/queue/errors', handleError);
    client.subscribe('/user/queue/sync-messages', handleSync);
  }
});

client.activate();

// Presence heartbeat (separate from STOMP broker heartbeat): every ~20s
setInterval(() => {
  client.publish({ destination: '/app/heartbeat', body: '{}' });
}, 20000);
```

### Connection Lifecycle

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
│    │  (confirms principal)               │                    │
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

## Client Events (Client → Server)

### `SEARCH_USER` (`/app/search`)

Search for a user to start a DM. Available to **any** authenticated STOMP principal (`TelegramPrincipal` or `WalletPrincipal`).

**Request** (`SearchRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `query` | string (1–64) | Yes | Search string — see formats below |

**Supported `query` formats (exact match):**

| Format | Example | Resolve |
|--------|--------|--------|
| `@username` | `@alice` | `UserRepository` (Telegram cache) |
| `username` | `alice` | same (without `@`) |
| Numeric TG ID | `123456789` | `UserRepository` + `auth_tg:` → `internalId` |
| `internalId` (UUID) | `550e8400-e29b-41d4-a716-446655440000` | `UserIdentityRepository.findById` |
| Wallet address | `EQBx7...` / `UQ...` | `auth_wallet:` → `internalId` (normalized lowercase) |

Non-matching string → `INVALID_QUERY`. Partial UUID / wallet prefix → **not** enumeration (see [SECURITY.md](./SECURITY.md)).

**Response** — `/user/queue/search-result` (`SearchResultEvent`):

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

| Field `user` | Type | Description |
|-------------|-----|----------|
| `internalId` | string | **Primary** — passed to `session.create` as `recipientInternalId` |
| `id` | number \| null | Telegram numeric ID; `null` for wallet-only |
| `username` | string? | Telegram username (without `@`) |
| `displayName` | string | Display name for UI |
| `photoUrl` | string? | Avatar |
| `online` | boolean | Heartbeat status |
| `premium` | boolean | Telegram Premium |

**Responses on `/user/queue/search-result`:**

| Condition | Payload |
|---------|---------|
| Found | `{ found: true, user: UserResponse }` |
| Not found / repository error | `{ found: false }` (`error` = `null`) — **not** a separate `NOT_FOUND` code |
| Invalid format | `{ found: false, error: "INVALID_QUERY" }` |
| Self-search | `{ found: false, error: "SELF_SEARCH" }` |

**Rate-limit** (`SEARCH` 10/min): SEND is dropped; client receives
`RATE_LIMIT_EXCEEDED` on `/user/queue/errors` (not on `search-result`).

**Backend:** `SearchHandler` — `@MessageMapping("/search")`, delivery via `StompUserMessenger` by search initiator's `internalId`.

---

### `POW_CHALLENGE` (`/app/pow.challenge`)

Request a PoW challenge before a gated action. The route **does not** require PoW (otherwise chicken-and-egg). **Issuance rate-limit:** `RateLimitService.POW_CHALLENGE` — **10 requests / min / `internalId`**; on exceed → `/user/queue/errors` with `RATE_LIMIT_EXCEEDED` and `retryAfter` (seconds).

**Implemented scope (2026-06-16):** backend **verifies** PoW only on `/app/session.create`; frontend solves PoW only for `session_create` (`useSession` / `ChatRequestDialog`). Wire-format `action` also accepts `search`, `room_create`, `invite` for challenge issuance — enforcement on those routes is **not yet wired** (future extension).

**Request** (`PowHandler.PowChallengeRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `action` | string | Yes | Wire-format: `session_create`, `search`, `room_create`, `invite` (`PowAction`) |

```typescript
client.publish({
  destination: '/app/pow.challenge',
  body: JSON.stringify({ action: 'session_create' })
});
```

Unknown or empty `action` → server **silently ignores** the request (debug log, no error event).

**Response** — `/user/queue/pow-challenge` (`PowChallengeEvent`):

| Field | Type | Description |
|------|-----|----------|
| `challengeId` | string | 16 random bytes, hex (32 chars) |
| `action` | string | Action the challenge is bound to |
| `difficulty` | number | Target number of leading zero **bits** (SHA-256 Hashcash) |
| `ttlMs` | number | Challenge TTL in milliseconds (from `pow.challenge-ttl`, default ~60000) |

The `issuedAt` field is stored **only in Redis** (`pow:challenge:{id}`), not in the STOMP event.

Difficulty is adaptive (global abuse signal `pow:abuse:global`, DESIGN §5). Server stores authoritative `action`/`difficulty` only in Redis; client values are not trusted. Issued difficulty is capped by `pow.ceiling` (default 26).

**Backend:** `PowHandler` — `@MessageMapping("/pow.challenge")`. Delivery via `StompUserMessenger.convertAndSendToUser` → `/user/queue/pow-challenge`.

**`pow.enabled`:**

| Profile | Value | Behavior |
|---------|----------|-----------|
| default / `prod` / `prod,testnet` | `true` (`${POW_ENABLED:true}`) | Challenge with real difficulty; verify required on gated routes |
| `dev`, `test` | `false` | Challenge with `difficulty: 0`; `PowVerificationService.verify` — no-op |

Prod/testnet **do not** override `pow.enabled` in `application-prod.yml` / `application-testnet.yml`.

---

### `CREATE_SESSION` (`/app/session.create`)

Create a new chat and send a request to the peer.

**Secret answer normalization** (initiator and recipient must match semantically): `trim` → `toLowerCase()` on the string → UTF-8 → SHA-256 → Base64 (see `SecretAnswerHasher` on the server).

**Request** (`CreateSessionRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `recipientInternalId` | string (UUID) | Yes* | Primary address key from search `UserResponse.internalId` |
| `recipientId` | number | No (deprecated) | Legacy Telegram ID; resolved to `internalId` via `auth_tg:` |
| `secretQuestion` | string (≤256) | No | Secret question |
| `secretExpectedAnswer` | string (≤256) | If question set | Expected answer; do not log |
| `pow` | object | If `pow.enabled=true` on gated route | PoW solution: `{ challengeId, nonce }` (`PowSolution`) |

\* One of `recipientInternalId` or `recipientId` (legacy) is required. New clients send only `recipientInternalId`.

**Server order (DESIGN §6.2):** PoW verify → rate-limit `SESSION_CREATE` (3/min) → business logic.

```typescript
client.publish({
  destination: '/app/session.create',
  body: JSON.stringify({
    recipientInternalId: '550e8400-e29b-41d4-a716-446655440000',
    secretQuestion: 'What was my cat\'s name?',
    secretExpectedAnswer: 'Barsik',
    pow: { challengeId: '00112233445566778899aabbccddeeff', nonce: '1373' }
  })
});
```

**Response to initiator** — `/user/queue/session-created` (`SessionCreatedEvent`).

**Notification to recipient** — `/user/queue/incoming-request` (`IncomingRequestEvent`):

| Field | Type | Description |
|------|-----|----------|
| `sessionId` | string | Session UUID |
| `sender` | `UserResponse` | Sender profile (incl. `sender.internalId`) |
| `fromInternalId` | string | Duplicates `sender.internalId` for explicit access |
| `hasSecretQuestion` | boolean | Whether a secret question exists |
| `secretQuestion` | string? | Question text |
| `createdAt`, `expiresAt` | ISO-8601 | Request TTL (5 min) |

Pending queue: Redis `request:{recipientInternalId}` (see [DATA_MODELS.md](./DATA_MODELS.md)).

**Error codes** (`success: false` on `/user/queue/session-created`):
`SELF_REQUEST`, `INVALID_RECIPIENT`, `EXPECTED_ANSWER_REQUIRED`,
`EXPECTED_ANSWER_TOO_LONG`, `ALREADY_HAS_SESSION`, `RECIPIENT_HAS_SESSION`,
`PENDING_REQUEST_EXISTS`, `INTERNAL_ERROR`.

> Codes `USER_NOT_FOUND` / `SELF_CHAT` / `USER_BLOCKED` / `RATE_LIMITED` on
> `session-created` are **not used**. Rate-limit and PoW go to
> `/user/queue/errors` (see below).

**PoW / rate-limit errors** (on `/user/queue/errors`, `WebSocketExceptionHandler`):

Body format (`Map`):

| Field | Type | PoW / rate-limit |
|------|-----|------------------|
| `success` | boolean | always `false` |
| `error` | string | error code |
| `message` | string | Human-readable message |
| `timestamp` | string | ISO-8601 instant |
| `retryAfter` | number | only for `RATE_LIMIT_EXCEEDED` (seconds) |

| Code | When |
|-----|-------|
| `POW_REQUIRED` | Missing/empty `pow`, challenge expired or absent in Redis |
| `POW_INVALID` | Invalid nonce, action mismatch, replay (`pow:spent` already consumed) |
| `RATE_LIMIT_EXCEEDED` | Per-identity cap exceeded **after** valid PoW |

**Backend:** `SessionHandler` — `@MessageMapping("/session.create")`. Delivery via `StompUserMessenger.convertAndSendToInternalId`. Telegram bot offline — best-effort when recipient has `telegramId`.

---

### `ACCEPT_REQUEST` (`/app/session.accept`)

Accept an incoming chat request.

**Frontend:**
```typescript
client.publish({
  destination: '/app/session.accept',
  body: JSON.stringify({
    sessionId: 'abc123',
    secretAnswer: 'Barsik' // if there was a secret question; same normalization as on create
  })
});

// Both participants receive success on `/user/queue/session-accepted`
client.subscribe('/user/queue/session-accepted', (message) => {
  const data = JSON.parse(message.body);
  // success, sessionId, peer, acceptedAt, expiresAt | error
});

// Accept errors (recipient only), incl. WRONG_ANSWER — answer did not match expected hash
```

**Backend:** `SessionHandler` — `@MessageMapping("/session.accept")`, event `SessionAcceptedEvent`.

---

### `REJECT_REQUEST` (`/app/session.reject`)

Reject a chat request.

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
Delivery to initiator via `StompUserMessenger` by **`internalId`**
(not Telegram ID). Principal name = `UnifiedUser.internalId()`.

---

### `SEND_PUBLIC_KEY` (`/app/handshake.key`)

Send ECDH public key for handshake.

**Key format:** SPKI/ASN.1, Base64 (`exportKey('spki', …)` on the client — see `ecdh.ts`).

**Resend semantics:** while the peer has **not** sent their key (`!areBothKeysReady()`),
a repeat request from the same participant **overwrites** their pending key in
`session:{sessionId}` (client retry / reconnect with new ECDH pair after
`burn()`). When both keys are already buffered — repeat is silently ignored (relay in progress).
After successful relay keys are cleared, session → `ACTIVE`; for key refresh on `ACTIVE`
the same overwrite-until-peer-responds principle applies + `KEY_REFRESH_NEEDED` to peer.

**Frontend:**
```typescript
client.publish({
  destination: '/app/handshake.key',
  body: JSON.stringify({
    sessionId: 'abc123',
    publicKey: 'Base64EncodedSpkiKey...'
  })
});

// Peer receives
client.subscribe('/user/queue/peer-key', (message) => {
  const data = JSON.parse(message.body);
  // PeerPublicKeyEvent: sessionId, publicKey, …
});
```

**Backend:** `HandshakeHandler` — `@MessageMapping("/handshake.key")`.
Peer delivery: `StompUserMessenger` → `/user/queue/peer-key` by `internalId`.
`/user/queue/handshake-refresh` also exists on handshake refresh.
Rate-limit: `HANDSHAKE` — 10 req/min (see table above).

---

### `SEND_MESSAGE` (`/app/message.send`)

Send an encrypted message (text or file: image, video, document).

**Text message (Frontend):**
```typescript
client.publish({
  destination: '/app/message.send',
  body: JSON.stringify({
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    messageId: 'client-generated-id',
    encryptedContent: 'base64...', // AES-GCM ciphertext (text)
    iv: 'base64...',
    timestamp: Date.now(),
    type: 'text',
    replyToMessageId: 'optional-parent-message-id' // optional
  })
});
```

**File message** — after `POST /api/files/upload` for the main blob and optionally for thumbnail, the client passes `fileId` and optional `thumbnailFileId`, plus encrypted metadata and **original** file size:

```typescript
// type: "image" | "video" | "file"
client.publish({
  destination: '/app/message.send',
  body: JSON.stringify({
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    messageId: 'client-generated-id',
    encryptedContent: 'base64...', // optional media caption; may be empty placeholder
    iv: 'base64...',
    timestamp: Date.now(),
    type: 'image',
    fileId: 'uuid-of-main-upload',
    thumbnailFileId: 'uuid-of-thumb-upload', // optional
    encryptedMeta: 'base64...', // see encryptFileMetadata: { fileName, mimeType }
    fileSize: 1048576,
    replyToMessageId: 'optional-parent-message-id' // optional
  })
});
```

Before relay, the server verifies that `fileId` (and `thumbnailFileId`, if present) exist in `file_meta:*`, were uploaded by the sender (ownership by `uploaderInternalId` == `sender.internalId()`; legacy fallback by `uploaderTgId` only for old metadata without `uploaderInternalId` and when `sender.telegramId != null`) and are bound to the same `sessionId`. Validation errors may use: `FILE_NOT_FOUND`, `FILE_NOT_OWNED`, `FILE_CONTEXT_MISMATCH`.

**Events:**

- Recipient: `/user/queue/new-message` — body as `NewMessageEvent` (incl. `senderInternalId`, `replyToMessageId?`, `type`, `fileId`, `thumbnailFileId`, `encryptedMeta`, `fileSize` for media).
- Sender: `/user/queue/message-sent` — delivery acknowledgment.

```typescript
client.subscribe('/user/queue/new-message', (message) => {
  const data = JSON.parse(message.body);
  // success, sessionId, messageId, senderId, senderInternalId, encryptedContent, iv,
  // clientTimestamp, serverTimestamp, type, replyToMessageId?,
  // fileId?, thumbnailFileId?, encryptedMeta?, fileSize?
});
```

**Backend:** `MessageHandler` — `@MessageMapping("/message.send")`, see `SendMessageRequest`, `NewMessageEvent`.

> For **rooms**, a separate handler and `SendRoomMessageRequest` with the same file fields are used; see destination in code (`RoomMessageHandler`).

---

### `CONFIRM_VERIFICATION` (`/app/verification.confirm`)

Confirm Visual Fingerprint.

**Frontend:**
```typescript
client.publish({
  destination: '/app/verification.confirm',
  body: JSON.stringify({
    sessionId: 'abc123',
    confirmed: true
  })
});

// Both receive status
client.subscribe('/user/queue/verification', (message) => {
  const data = JSON.parse(message.body);
  // VerificationEvent: success, sessionId, verified, peerVerified, bothVerified, verifiedAt?, error?
});
```

**Backend:** `VerificationHandler` — `@MessageMapping("/verification.confirm")`.
Delivery via `StompUserMessenger` → `/user/queue/verification` by `internalId`.

---

### `BURN_SESSION` (`/app/session.burn`)

Destroy the session.

**Frontend:**
```typescript
client.publish({
  destination: '/app/session.burn',
  body: JSON.stringify({
    sessionId: 'abc123'
  })
});

// Both receive
client.subscribe('/user/queue/burn-signal', (message) => {
  const data = JSON.parse(message.body);
  // BurnSignalEvent: sessionId, burnedBy?, burnedAt, success
});
```

**Backend:** `BurnHandler` — `@MessageMapping("/session.burn")`.
Delivery via `StompUserMessenger` → `/user/queue/burn-signal` by `internalId`
of both participants. After burn the client must destroy keys and clear history.

---

### `BURN_ALL` (`/app/user.burnAll`)

Global server destruction of all user data in one cascade.
Requires a live STOMP connection.

**Frontend:**
```typescript
client.publish({
  destination: '/app/user.burnAll',
  body: JSON.stringify({
    wipeIdentity: false  // true = also delete user:{internalId}, auth_*, lang:pref, member_rooms, session_token:*
  })
});

client.subscribe('/user/queue/burn-all-complete', (message) => {
  const data = JSON.parse(message.body);
  // BurnAllCompleteEvent: wipeIdentity, burnedSessions, burnedRooms, leftRooms, timestamp
});
```

**Backend:** `UserBurnHandler` — `@MessageMapping("/user.burnAll")`.
Cascade `UserBurnService.burnAllForUser(internalId, wipeIdentity)`:

1. All active DM sessions → burn like `/app/session.burn` + `BurnSignalEvent` to peers.
2. Owned rooms → `RoomService.burnRoomAsOwner` + `RoomBurnedEvent` to members.
3. Other people's rooms → leave cascade + `room-member-left` to remaining (rekey by owner).
4. Tail cleanup: `request:*`, user offline/tombstone queues, `file_context` via `FileBurnService`.
5. When `wipeIdentity=true` — `user:{internalId}`, `auth_tg`, `auth_wallet`, `lang:pref`, `member_rooms`, `session_token:*`.
6. Ack to initiator → `/user/queue/burn-all-complete` **before** connection tear-down (client disconnect).

**Rate-limit:** `RateLimitService.checkRestRateLimit("burn_all", internalId, 3, 1 min)` —
without PoW. Repeat call is idempotent (cleans up leftovers).

**Peer events (not to initiator):**

| Queue | Event | When |
|---------|---------|-------|
| `/user/queue/burn-signal` | `BurnSignalEvent` | Each burned DM session |
| `/user/queue/room-burned` | `RoomBurnedEvent` | Each burned owned room |
| `/user/queue/room-member-left` | `RoomMemberLeftEvent` | Each leave from someone else's room |

---

### `SET_DEADMAN` (`/app/user.setDeadman`)

Dead man's switch: auto-burn after N days of inactivity.

**Frontend:**
```typescript
client.publish({
  destination: '/app/user.setDeadman',
  body: JSON.stringify({
    enabled: true,
    periodDays: 30,      // 7 | 30 | 90 when enabled
    wipeIdentity: false  // true = burn-all with identity deletion
  })
});

client.subscribe('/user/queue/deadman-updated', (message) => {
  const data = JSON.parse(message.body);
  // DeadmanUpdatedEvent: enabled, periodDays, wipeIdentity, expiresAt
});
```

**Backend:** `UserBurnHandler` — `@MessageMapping("/user.setDeadman")`.
`enabled=false` deletes trigger + cfg keys. `enabled=true` writes cfg (no TTL) and trigger
with TTL = `periodDays`. Ack → `/user/queue/deadman-updated`.

**Activity refresh:** on each STOMP CONNECT (`WebSocketEventListener`) trigger TTL
is reset to full `periodDays` if switch is enabled. If enabled,
server also pushes `DeadmanUpdatedEvent` to `/user/queue/deadman-updated`
with current `expiresAt` (cold start / reconnect sync for frontend).

**Expiry:** keyspace listener on `user:deadman:*` → `UserBurnService.burnAllForUser`
with `wipeIdentity` from cfg → delete cfg key.

---

### `SYNC_MESSAGES` (`/app/message.sync`)

Request missed DM messages from Redis queue (reconnect, cold start, server push; see offline sync). Body: `SyncMessagesRequest` with `sessionId`.

**Frontend:**
```typescript
client.publish({
  destination: '/app/message.sync',
  body: JSON.stringify({
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
  })
});

// Result: SyncMessagesEvent
client.subscribe('/user/queue/sync-messages', (message) => {
  const data = JSON.parse(message.body);
  // success, sessionId, error?, messages
});
```

**Backend:** `MessageHandler` — `@MessageMapping("/message.sync")`, `SyncMessagesRequest`, `SyncMessagesEvent` on `/user/queue/sync-messages`, after send — delete key `messages:{userId}:{sessionId}`. List params: `burnedchats.messages.offline-queue` (see `DATA_MODELS.md`).

---

### `TYPING_START` / `TYPING_STOP` — **planned (not implemented)**

> **Status:** destinations `/app/typing/start`, `/app/typing/stop` and queue
> `/user/queue/peer-typing` **are absent from code** (no `@MessageMapping`, no
> publications). Do not subscribe or publish — client gets silence.
> Reserved for future; typing indicator is not supported until implemented.

---

### Additional DM / session destinations (code)

The following routes are implemented in `SessionHandler` / `MessageHandler` /
`HeartbeatHandler` / `UserPreferenceHandler` and were not previously summarized in one table:

| Destination | Handler | Response / queue | Description |
|-------------|---------|-----------------|----------|
| `/app/session.pending` | `SessionHandler` | (see handler) | List / fetch pending requests |
| `/app/session.status` | `SessionHandler` | `/user/queue/session-status` | Session status (`SessionStatusEvent`) |
| `/app/peer.disconnect` | `SessionHandler` | `/user/queue/peer-disconnected` | Notify peer of disconnect |
| `/app/session.active.list` | `SessionHandler` | `/user/queue/active-sessions` | List of active sessions |
| `/app/session.resume` | `SessionHandler` | `/user/queue/session-resumed` | Resume after reconnect |
| `/app/message.edit` | `MessageHandler` | `/user/queue/message-edited` | Edit DM |
| `/app/message.delete` | `MessageHandler` | `/user/queue/message-deleted` | Delete DM |
| `/app/heartbeat` | `HeartbeatHandler` | — (updates `online:*`) | Presence; rate-limit **exempt**; client ~20s |
| `/app/user.setLanguage` | `UserPreferenceHandler` | — (fire-and-forget) | Save language preference |

---

## Server Events (Server → Client)

All server events are sent to user personal queues
(`/user/queue/*`) via `StompUserMessenger` by **`internalId`**.

### DM / session / system

| Queue | Event / DTO | Description |
|---------|---------------|----------|
| `/user/queue/search-result` | `SearchResultEvent` | Search result |
| `/user/queue/pow-challenge` | `PowChallengeEvent` | Issued PoW challenge |
| `/user/queue/session-created` | `SessionCreatedEvent` | Response to `session.create` |
| `/user/queue/session-accepted` | `SessionAcceptedEvent` | Request accepted |
| `/user/queue/session-rejected` | `SessionRejectedEvent` | Request rejected |
| `/user/queue/session-status` | `SessionStatusEvent` | Session status |
| `/user/queue/incoming-request` | `IncomingRequestEvent` | Incoming chat request |
| `/user/queue/peer-disconnected` | `PeerDisconnectedEvent` | Peer disconnected |
| `/user/queue/active-sessions` | `ActiveSessionsListEvent` | List of active sessions |
| `/user/queue/session-resumed` | `SessionResumedEvent` | Resume after reconnect |
| `/user/queue/peer-key` | `PeerPublicKeyEvent` | Peer public key |
| `/user/queue/handshake-refresh` | handshake refresh | Handshake refresh |
| `/user/queue/new-message` | `NewMessageEvent` | New DM message |
| `/user/queue/message-sent` | `MessageSentEvent` | DM send ack / errors |
| `/user/queue/sync-messages` | `SyncMessagesEvent` | Offline sync DM |
| `/user/queue/message-edited` | `MessageEditedEvent` | DM edited |
| `/user/queue/message-deleted` | `MessageDeletedEvent` | DM deleted |
| `/user/queue/verification` | `VerificationEvent` | Fingerprint status |
| `/user/queue/burn-signal` | `BurnSignalEvent` | Session burned |
| `/user/queue/burn-all-complete` | `BurnAllCompleteEvent` | Global burn-all ack |
| `/user/queue/errors` | error map | Global STOMP errors (rate-limit, PoW, validation) |

> **Not implemented (not emitted):** `/user/queue/session-started`,
> `peer-joined`, `peer-left`, `peer-typing`. Do not subscribe.
> Legacy names from old specs (`messages`, `sync-result`, `error`,
> `peer-public-key`, `session-burned`, `verification-status`) are **replaced**
> by table rows above.

### Room user queues

| Queue | Description |
|---------|----------|
| `/user/queue/room-created` | Room created |
| `/user/queue/invite-link` | Invite link |
| `/user/queue/room-invites` | Invite list |
| `/user/queue/room-invite-info` | Token info |
| `/user/queue/room-join-requests` | Join requests |
| `/user/queue/room-join-result` | Join result (approve/reject) |
| `/user/queue/key-bundle` | Key bundle |
| `/user/queue/room-rekey` | Rekey |
| `/user/queue/member-pubkeys` | Member pubkeys |
| `/user/queue/room-list` | User's room list |
| `/user/queue/room-members` | Member list |
| `/user/queue/room-presence` | Presence snapshot |
| `/user/queue/room-burned` | Room burned |
| `/user/queue/room-left` | You left |
| `/user/queue/room-member-left` | Member left |
| `/user/queue/room-kicked` | You were kicked |
| `/user/queue/room-kick-result` | Kick result |
| `/user/queue/room-member-removed` | Member removed |
| `/user/queue/room-bans` | Ban list |
| `/user/queue/room-message-sent` | Room send ack / errors |
| `/user/queue/room-sync-messages` | Offline sync room |
| `/user/queue/room-message-edited` | Room edit ack/error |
| `/user/queue/room-message-deleted` | Room delete ack/error |

> Constant `/queue/room-message-error` is **defined but unused** in code —
> room-send errors go to `/user/queue/room-message-sent`.

Topic: `/topic/room/{roomId}` (multiplexed by event type; subscribe only for members).

### Additional room destinations (client → server)

| Destination | Description |
|-------------|----------|
| `/app/room.leave` | Leave room → `/user/queue/room-left` (+ peer `room-member-left`) |
| `/app/room.requestKeyBundle` | Request key bundle |
| `/app/room.getMemberPubkeys` | Member pubkeys → `/user/queue/member-pubkeys` |
| `/app/room.message.edit` | Edit room message |
| `/app/room.message.delete` | Delete room message |
| `/app/room.burn` | Burn room → `/user/queue/room-burned` |
| `/app/user.burnAll` | Global burn-all cascade → `/user/queue/burn-all-complete` (+ peer events) |
| `/app/user.setDeadman` | Dead man's switch on/off → `/user/queue/deadman-updated` |

---

## Data Types

### Message payload (STOMP / offline queue)

The protocol uses **`SendMessageRequest`** (client → server) and **`Message`** / **`NewMessageEvent`** (server → client), not a separate class with `ciphertext`/`tag` fields.

Common fields:

| Field | Description |
|------|----------|
| `type` | `text` \| `image` \| `video` \| `file` |
| `encryptedContent`, `iv` | Encrypted text or media caption (opaque Base64) |
| `messageId`, `timestamp` / `clientTimestamp` | Idempotency and ordering |
| `replyToMessageId` | Optional — ID of the message this replies to (plaintext metadata; in `SendMessageRequest` and `NewMessageEvent`) |
| `senderInternalId` | Only in `NewMessageEvent` — sender primary identity (wallet-safe); `senderId` (TG) may be `null` |

For `image` / `video` / `file` additionally:

| Field | Description |
|------|----------|
| `fileId` | Main file ID after `POST /api/files/upload` |
| `thumbnailFileId` | Encrypted thumbnail ID (optional) |
| `encryptedMeta` | Base64: encrypted JSON `{ fileName, mimeType }` |
| `fileSize` | **Original** file size in bytes (plaintext size) |

### UserResponse (search, incoming-request, session events)

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

Participants are addressed by **`initiatorInternalId` / `responderInternalId`**. Optional `initiatorTelegramId` / `responderTelegramId` — for display and Telegram-only branches.

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

DM peer event delivery (handshake, message, verify, burn): `StompUserMessenger.convertAndSendToInternalId(peerInternalId, ...)`. Numeric `senderId` / `peerId` in events — best-effort when `telegramId` is present.

### PeerInfo / frontend peer display

Current clients use `internalId` as primary peer key. Legacy `PeerInfo.tgId` / `fromUserId: number` deprecated on frontend.

---

## Error Codes

### General errors

| Code | HTTP / channel | Description |
|-----|--------------|----------|
| `UNAUTHORIZED` | 401 | Invalid initData / session token |
| `FORBIDDEN` | 403 | No access to resource |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMIT_EXCEEDED` | 429 / STOMP `/user/queue/errors` | Request limit exceeded (REST and STOMP) |
| `POW_REQUIRED` | STOMP `/user/queue/errors` | Missing/expired PoW challenge on gated action |
| `POW_INVALID` | STOMP `/user/queue/errors` | Invalid PoW solution, action mismatch, or replay |
| `INTERNAL_ERROR` | 500 / STOMP | Internal server error |

> Legacy code `RATE_LIMITED` in REST/STOMP global errors is **not used**
> (`RateLimitException` → `RATE_LIMIT_EXCEEDED`). Some room-event DTOs
> may still write string `RATE_LIMITED` in local ack `error` field —
> that is a separate room-handlers wire contract, not global `/user/queue/errors`.

### Session errors

| Code | Description |
|-----|----------|
| `SESSION_NOT_FOUND` | Session does not exist or expired |
| `SESSION_FULL` | Session already has 2 participants |
| `SESSION_EXPIRED` | Wait time expired |
| `SESSION_BURNED` | Session was destroyed |
| `NOT_PARTICIPANT` | You are not a participant of this session |
| `SELF_REQUEST` | Cannot create chat with yourself (`session.create`) |
| `INVALID_RECIPIENT` | Recipient does not resolve |
| `ALREADY_HAS_SESSION` | Initiator already has an active session |
| `RECIPIENT_HAS_SESSION` | Recipient already has an active session |
| `PENDING_REQUEST_EXISTS` | Duplicate pending request |

### User errors

| Code | Description |
|-----|----------|
| `INVALID_QUERY` | Invalid search query format |
| `SELF_SEARCH` | Searching for yourself |

> Codes `USER_NOT_FOUND`, `USER_BLOCKED`, `SELF_CHAT` are **not emitted** by code
> (user blocking not implemented; search not-found = `{found:false}`).

### Message and file errors

| Code | Description |
|-----|----------|
| `MESSAGE_TOO_LARGE` | Size limit exceeded |
| `INVALID_FORMAT` | Invalid data format |
| `FILE_TOO_LARGE` | Encrypted blob exceeds server ceiling (`MAX_ENCRYPTED_FILE_SIZE`) |
| `FILE_NOT_FOUND` | File not found in Redis or TTL expired (REST download / relay validation) |
| `ACCESS_DENIED` | No access to file or context (REST); in docs also: "file access denied" |
| `FILE_NOT_OWNED` | Sender does not match uploader (`uploaderInternalId` or legacy `uploaderTgId`) |
| `FILE_CONTEXT_MISMATCH` | File bound to different session/room than message |
| `CONTEXT_NOT_FOUND` | Session for upload not found |
| `FILE_SIZE_INVALID` | Size after upload did not match `Content-Length` |
| `INVALID_CONTEXT_TYPE` | Invalid `X-Context-Type` |

### STOMP Exception Handler

`WebSocketExceptionHandler` catches exceptions on STOMP routes and sends
payload to `/user/queue/errors` via `StompUserMessenger` by principal **`internalId`**
(not Telegram ID). Typical codes: `RATE_LIMIT_EXCEEDED`,
`POW_REQUIRED`, `POW_INVALID`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.
Body — `Map` with fields `success`, `error`, `message`, `timestamp`
(+ `retryAfter` for rate-limit).

---

## WebSocket Reconnection

### Reconnection Strategy (Frontend)

```typescript
const client = new Client({
  webSocketFactory: () => new SockJS(
    `/ws?X-Auth-Type=telegram&X-Telegram-Init-Data=${encodeURIComponent(WebApp.initData)}`
  ),
  reconnectDelay: 5000,
  // STOMP broker heartbeat — 10s (matches WebSocketConfig)
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

## Full Flow Example

```typescript
// 1. Connect (auth on HTTP handshake / SockJS query)
const client = new Client({
  webSocketFactory: () => new SockJS(
    `/ws?X-Auth-Type=telegram&X-Telegram-Init-Data=${encodeURIComponent(initData)}`
  ),
  heartbeatIncoming: 10000,
  heartbeatOutgoing: 10000
});

client.onConnect = () => {
  // 2. Subscribe to current queues
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

  // 3. Search user
  client.publish({
    destination: '/app/search',
    body: JSON.stringify({ query: '@alice' })
  });
};

// 4. Handle search result
function handleSearchResult(message) {
  const { found, user } = JSON.parse(message.body);
  if (found) {
    // 5. Create session (primary: recipientInternalId)
    client.publish({
      destination: '/app/session.create',
      body: JSON.stringify({
        recipientInternalId: user.internalId,
        pow: { challengeId: '...', nonce: '...' } // if pow.enabled
      })
    });
  }
}

// 6. After session-accepted / handshake — key exchange
async function startHandshake(sessionId: string) {
  const keyPair = await generateKeyPair();
  const publicKey = await exportPublicKey(keyPair.publicKey);

  client.publish({
    destination: '/app/handshake.key',
    body: JSON.stringify({ sessionId, publicKey })
  });
}

// 7. Receive peer key
async function handlePeerPublicKey(message) {
  const { publicKey, sessionId } = JSON.parse(message.body);
  const peerKey = await importPublicKey(publicKey);
  const sharedKey = await deriveKey(keyPair.privateKey, peerKey);

  const fingerprint = await generateFingerprint(sharedKey);
  showVerificationUI(fingerprint);
}

// 8. Send messages
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

// 9. Receive messages (flat NewMessageEvent)
async function handleNewMessage(message) {
  const data = JSON.parse(message.body);
  const decrypted = await decrypt(
    { ciphertext: data.encryptedContent, iv: data.iv },
    sharedKey
  );
  displayMessage(decrypted);
}

// 10. Burn
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

## Rooms (Phase 2 — P2-1)

### CREATE_ROOM

**Direction:** Client → Server  
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

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `salt` | string (Base64, 16–48 bytes) | For BY_PASSWORD | KDF salt, client-generated. For BY_REQUEST without password — omit |
| `passwordProof` | string (Base64, 32 bytes) | For BY_PASSWORD | PBKDF2 proof. For BY_REQUEST without password — omit |
| `joinMode` | enum | Yes | `BY_PASSWORD` — immediate join; `BY_REQUEST` — on approval (password optional) |
| `ownerPublicKey` | string (Base64) | No | Owner public key (ECDH) |
| `roomId` | string (UUID v4) | When `nameEncrypted`* | Client-proposed room UUID; server uses it if no collision. Without name — server generates UUID |
| `nameEncrypted` | string (Base64) | No* | AES-GCM ciphertext of name (opaque, max 512 chars) |
| `nameIv` | string (Base64) | No* | 12-byte GCM IV for `nameEncrypted` (max 32 chars Base64) |

\* `nameEncrypted` and `nameIv` are sent **both** or **neither**; when present **client**
`roomId` is required (AES-GCM AAD = `roomId`).
When creating with a name, separate `SET_ROOM_NAME` is **not** required — name is saved in Redis
atomically with create; `ROOM_NAME_UPDATED` is **not** published on create.

**Response:** `/user/queue/room-created` — `RoomCreatedEvent` with `roomId` and optional `inviteUrl` (default token, 7d TTL, unlimited uses).

**`inviteUrl` / `invites[].url` format:** canonical web URL
`{telegram.mini-app.url}/join#invite_{token}` — token in **fragment** (`#`), not path/query.
Fallback when `telegram.mini-app.url` is empty: `https://t.me/{bot}/app?startapp=invite_{token}`.
Legacy t.me links remain valid on the client via `start_param`.

---

### GET_INVITE_LINK (`/app/room.getInviteLink`)

**Direction:** Client → Server (owner or admin)

**Request** (`GetInviteLinkRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `expiresInSeconds` | number | No | TTL from now (60 s … 30 d); default 7 days |
| `maxUses` | number | No | Successful join limit; `0`/absent = unlimited |

**Response:** `/user/queue/invite-link` — `InviteLinkEvent` with `inviteUrl`.

Errors: `ROOM_NOT_FOUND`, `NOT_OWNER`, `INTERNAL_ERROR`.

---

### REVOKE_INVITE (`/app/room.revokeInvite`)

**Direction:** Client → Server (owner or admin)

**Request** (`RevokeInviteRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `token` | string | Yes | Token string (not URL) |

Deletes `invite:{token}` and removes token from `room_invites:{roomId}`. No separate ack (fire-and-forget); errors logged (`NOT_OWNER`, `INVALID_TOKEN`, `ROOM_NOT_FOUND`).

---

### GET_INVITES (`/app/room.getInvites`)

**Direction:** Client → Server (owner or admin)

**Request:** `{ "roomId": "uuid" }` (same DTO as `getInviteLink`, without optional fields).

**Response:** `/user/queue/room-invites` — `RoomInvitesEvent`:

| Field | Type | Description |
|------|-----|----------|
| `success` | boolean | |
| `roomId` | string | Room UUID |
| `invites[]` | array | Active tokens from `room_invites:{roomId}` |
| `invites[].token` | string | Token string |
| `invites[].url` | string | Web invite URL (`/join#invite_{token}`) or fallback t.me deep link |
| `invites[].createdAt` | number | Unix ms |
| `invites[].expiresAt` | number | Unix ms |
| `invites[].maxUses` | number? | `null`/0 = unlimited |
| `invites[].usedCount` | number | Current counter |
| `error` | string | When `success=false`: `NOT_OWNER`, `ROOM_NOT_FOUND`, `INTERNAL_ERROR` |

---

### GET_INVITE_INFO / room-invite-info

**Request:** Client → Server, destination `/app/room.getInviteInfo`, body `{ "inviteToken": "string" }`.

**Response:** Server → Client, destination `/user/queue/room-invite-info`.

On success the client receives `salt`, `joinMode`, and **`hasPassword`** (boolean). If `hasPassword === false`, the room has no password (BY_REQUEST): on the "Join via link" screen do not show password field, only "Send request" button.

Errors (without revealing room data): `INVALID_TOKEN`, `INVITE_EXPIRED`, `INVITE_EXHAUSTED`.

---

### REQUEST_JOIN_ROOM

**Direction:** Client → Server  
**Destination:** `/app/room.requestJoin`

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `inviteToken` | string | Yes | Token from invite link (fragment `#invite_{token}` or `start_param`) |
| `passwordProof` | string (Base64) | If room has password | Omit when room has no password |
| `publicKey` | string (Base64) | No | Requester's ECDH public key |

**Join errors** (on `/user/queue/room-join-result`): `INVALID_TOKEN`, `INVITE_EXPIRED`, `INVITE_EXHAUSTED`, `WRONG_PASSWORD`, `ALREADY_MEMBER`, `REQUEST_PENDING`, `USER_BANNED`.

**Password lockout (`ROOM_PASSWORD_FAIL`):** after 5 failed proofs in 10 min (key per `roomId`+`internalId`, yaml `rate-limit.room-password-fail.*`) further attempts are rejected. Wire code on `/user/queue/room-join-result` is currently **`INTERNAL_ERROR`** — `RoomHandler.mapJoinError` does not map `RateLimitException` (surfacing as separate error — outside this spec; see relevant spec notes / W5-4).

**Event to owner** — `/user/queue/room-join-requests` (`RoomJoinRequestEvent`):

| Field | Type | Description |
|------|-----|----------|
| `roomId` | string | Room UUID |
| `senderInternalId` | string | **Primary** — requester identifier |
| `senderTgId` | number? | Deprecated; `null` for wallet-only |
| `senderDisplayName` | string | Name from `user:{internalId}` catalog |
| `senderUsername` | string? | Telegram username, if present |
| `senderPublicKey` | string? | Base64 ECDH pubkey for KEY_BUNDLE |
| `requestedAt` | number | Unix ms |
| `autoApproved` | boolean | `true` on BY_PASSWORD without waiting |

Redis: `room_join_request:{roomId}:{senderInternalId}` (see [DATA_MODELS.md](./DATA_MODELS.md)).

---

### ACCEPT_ROOM_JOIN / REJECT_ROOM_JOIN

**Destinations:** `/app/room.acceptJoin`, `/app/room.rejectJoin`  
**Request** (`RoomJoinDecisionRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `senderInternalId` | string | Yes* | Requester from `RoomJoinRequestEvent` |
| `senderTgId` | number | No (deprecated) | Legacy; resolved to `senderInternalId` |

\* Owner only (`ownerInternalId`). After accept owner sends KEY_BUNDLE.

---

### SEND_KEY_BUNDLE (`/app/room.sendKeyBundle`)

Owner delivers encrypted group key to new member.

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `recipientInternalId` | string | Yes | **Break** — internalId only (not TG ID) |
| `epoch` | number | Yes | Current key epoch (0 for new room) |
| `ephemeralPublicKey` | string (Base64) | Yes | Ephemeral ECDH P-256 |
| `encryptedKey` | string (Base64) | Yes | AES-GCM ciphertext wrapped group key |
| `iv` | string (Base64) | Yes | 12-byte GCM IV |

**Delivery** — `/user/queue/key-bundle` to recipient by `recipientInternalId`.

---

### REKEY (`/app/room.rekey`)

Owner rotates group key after member leaves.

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `newEpoch` | number | Yes | `currentEpoch + 1` |
| `bundles` | array | Yes | One bundle per remaining member |
| `nameEncrypted` | string (Base64) | No* | Name re-encrypted under new group key epoch |
| `nameIv` | string (Base64) | No* | 12-byte GCM IV for `nameEncrypted` |
| `bundles[].recipientInternalId` | string | Yes | Bundle recipient |
| `bundles[].ephemeralPublicKey` | string | Yes | Base64 |
| `bundles[].encryptedKey` | string | Yes | Base64 |
| `bundles[].iv` | string | Yes | Base64 |

\* `nameEncrypted` and `nameIv` are sent **both** or **neither**; when present they are atomically
updated in `room:{roomId}` with key rotation. `/topic/room/{roomId}` broadcasts
`ROOM_NAME_UPDATED` (see SET_ROOM_NAME).

Each bundle is delivered to `/user/queue/key-bundle` for the corresponding `recipientInternalId`.

---

### SET_ROOM_NAME (`/app/room.setName`)

**Direction:** Client → Server (owner-only)

**Request** (`SetRoomNameRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `nameEncrypted` | string (Base64) | Yes | AES-GCM ciphertext of name (opaque, max 512 chars) |
| `nameIv` | string (Base64) | Yes | 12-byte GCM IV (max 32 chars Base64) |

Server **does not decrypt** the name; stores both fields in `room:{roomId}` and extends TTL.

**Fan-out:** `/topic/room/{roomId}` — `RoomNameUpdatedEvent`:

| Field | Type | Description |
|------|-----|----------|
| `eventType` | string | `"ROOM_NAME_UPDATED"` |
| `roomId` | string | Room UUID |
| `nameEncrypted` | string | Base64 ciphertext |
| `nameIv` | string | Base64 IV |

Errors logged on server (`NOT_OWNER`, `ROOM_NOT_FOUND`); no separate user-queue ack
(fire-and-forget, like early room lifecycle endpoints).

---

### GET_MY_ROOMS (`/app/room.getMyRooms`)

**Request:** empty body or `{}`.

**Response:** `/user/queue/room-list` (`RoomListEvent`):

| Field | Type | Description |
|------|-----|----------|
| `rooms[].roomId` | string | UUID |
| `rooms[].role` | enum | `owner` \| `admin` \| `member` |
| `rooms[].createdAt` | number | Unix ms |
| `rooms[].nameEncrypted` | string? | Encrypted name (opaque) |
| `rooms[].nameIv` | string? | GCM IV for name |

---

### Multiplexed topic `/topic/room/{roomId}` (event taxonomy)

`/topic/room/{roomId}` is a **multiplexed** channel: it publishes both
regular encrypted messages and room service events (name, TTL, roles,
ownership transfer, moderation, edit/delete, presence). All arrive on **one**
STOMP subscription, so the client must route payload by discriminator
`eventType` (see contract below). The server always sees only opaque data
and metadata — ciphertext/IV encoding format is uniform (standard Base64), see
[DATA_MODELS.md → Ciphertext encoding format](./DATA_MODELS.md#ciphertext-encoding-format-encoding-contract).

**Full topic event table:**

| `eventType` | Source (backend) | Frontend handler | Key payload fields |
|-------------|--------------------|---------------------|-----------------------|
| _(absent)_ — message | `RoomMessageHandler` → `NewRoomMessageEvent` | `handleNewMessage` → decrypt | `messageId`, `encryptedContent`, `iv`, `senderInternalId`, opt. `type`/`fileId`/`thumbnailFileId`/`encryptedMeta`/`fileSize`, `replyToMessageId` |
| `ROOM_MESSAGE_DELETED` | `RoomMessageHandler` → `RoomMessageDeletedEvent` | `handleNewMessage` (delete branch) | `messageId`, `deletedByInternalId`, `deletedByOwner` |
| `ROOM_MESSAGE_EDITED` | `RoomMessageHandler` → `RoomMessageEditedEvent` | `handleNewMessage` (edit branch) → decrypt new text | `messageId`, `encryptedContent`, `iv`, opt. media fields |
| `ROOM_MODERATION` | `RoomHandler` → `RoomModerationEvent` | `handleNewMessage` → `onRoomModeration` | `readOnly`, `mutedAdded`, `mutedRemoved` |
| `ROOM_NAME_UPDATED` | `RoomHandler` → `RoomNameUpdatedEvent` | `useSetRoomName` listener | `nameEncrypted`, `nameIv` |
| `ROOM_TTL_UPDATED` | `RoomHandler` → `RoomTtlUpdatedEvent` | room-state listener | `autoBurnAt` |
| `ROOM_MESSAGE_TTL_UPDATED` | `RoomHandler` → `RoomMessageTtlUpdatedEvent` | room-state listener | `messageTtlSeconds` |
| `ROOM_ROLE_UPDATED` | `RoomHandler` → `RoomRoleUpdatedEvent` | room-roles listener | `targetInternalId`, `role` |
| `ROOM_OWNERSHIP_TRANSFERRED` | `RoomHandler` → `RoomOwnershipTransferredEvent` | room-roles listener | `newOwnerInternalId`, `previousOwnerInternalId` |
| _(absent)_ — presence | `WebSocketEventListener` → `RoomPresenceEvent` | room-presence listener | `internalId`, `online`, `lastSeen` (no `messageId`/`encryptedContent`) |

**Message handler contract (`handleNewMessage`, `frontend/src/hooks/useRoomMessages.ts`):**

- payload **without** `eventType`, with `messageId` and `encryptedContent`/`iv` (or file
  fields) — the only case treated as a message and **decrypted**
  with the room group key;
- `ROOM_MESSAGE_DELETED` / `ROOM_MESSAGE_EDITED` / `ROOM_MODERATION` handled
  by dedicated branches (delete / edit / moderation);
- **any other `eventType`** (`ROOM_NAME_UPDATED`, `ROOM_TTL_UPDATED`,
  `ROOM_MESSAGE_TTL_UPDATED`, `ROOM_ROLE_UPDATED`, `ROOM_OWNERSHIP_TRANSFERRED`) and
  **any unknown `eventType`** — safe default: early `return`, payload
  **never** enters text decryption path;
- payload **without** `eventType` and **without** `messageId` (e.g. `RoomPresenceEvent`) does
  not create a message or toast: service listener handles it; in
  `handleNewMessage` missing `encryptedContent` yields typed error
  (`INVALID_CIPHERTEXT_ENCODING`)
  and graceful degrade without placeholder (no `messageId`).

> **Why this is documented.** Implicit multiplexer contract was the root cause of
> decrypt bug on room create (service `ROOM_NAME_UPDATED` fell into
> text decryption path → `atob(undefined)`).

Below — detailed payloads for each service event (`SET_ROOM_NAME`, `SET_ROOM_TTL`,
`ROOM_ROLE_UPDATED`, etc.).

---

### ROOM_MESSAGES (text / media)

**Send:** `/app/room.message.send` (`SendRoomMessageRequest` — same file fields as DM).

**Ack to sender:** `/user/queue/room-message-sent` (`RoomMessageSentEvent`). On moderation reject:
`error` = `MUTED` (sender in `room_muted:{roomId}`) or `ROOM_READ_ONLY` (room read-only and sender not owner).
Message is **not** written to offline queue.

**Fan-out:** `/topic/room/{roomId}` — `NewRoomMessageEvent`:

**Subscribe guard:** client **must** be authenticated (`AppPrincipal` on STOMP session)
and room member (`room_members:{roomId}`) for `SUBSCRIBE /topic/room/{roomId}`. Otherwise server
rejects subscription with STOMP ERROR (does not register subscription; WebSocket stays open):

- no principal — code `AUTH_ERROR` in message body/header;
- no membership — code `NOT_MEMBER` in message body/header.

Guard supplements but does not replace mandatory rekey after kick/ban. `/user/queue/*` subscriptions are unaffected.

**Force-unsubscribe:** after successful `/app/room.kick`, `/app/room.ban`, or `/app/room.leave` server
removes **all** active subscriptions of removed participant on `/topic/room/{roomId}` via
`SubscriptionRegistry` (all user STOMP sessions). Closes window where subscription was
open before kick/leave and kept receiving ciphertext until client disconnect. Re-subscribe still
blocked by subscribe-guard (`NOT_MEMBER`).

| Field | Type | Description |
|------|-----|----------|
| `senderInternalId` | string | **Primary** — canonical sender |
| `senderTgId` | number? | Deprecated; `null` for wallet-only |
| `senderName` | string? | Display name from catalog |
| `messageId`, `roomId`, `encryptedContent`, `iv` | — | Same as DM |
| `type`, `fileId`, … | — | Media fields when `type != text` |

**Sync:** `/app/room.message.sync` → `/user/queue/room-sync-messages` (`SyncRoomMessagesEvent` with `senderInternalId`).

**Edit/delete:** events `RoomMessageEditedEvent`, `RoomMessageDeletedEvent` with `deletedByInternalId` (+ optional `deletedByTgId`).

Membership check: `roomMembersRepository.isMember(roomId, internalId)`.

---

### GET_ROOM_MEMBERS (`/app/room.getMembers`)

**Request:** Client → Server, body `{ "roomId": "string" }`. Room member only.

**Response:** Server → Client, destination `/user/queue/room-members` (`RoomMembersListEvent`).

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

| Field | Type | Description |
|------|-----|----------|
| `members` | array | Enriched members (breaking change: was `string[]` internalId) |
| `members[].internalId` | string | Stable internal id |
| `members[].displayName` | string? | Name from `user:{internalId}` catalog; omitted for unknown |
| `members[].username` | string? | Telegram username (catalog does not store yet — often `null`) |
| `members[].role` | enum | `owner` if `internalId == room.ownerInternalId`; `admin` if overlay in `room_roles`; else `member` |
| `members[].joinedAt` | number? | Not populated (Redis Set does not store join time) |

**Error:** `{ "success": false, "error": "NOT_MEMBER | ROOM_NOT_FOUND | INTERNAL_ERROR" }`

---

### GET_ROOM_PRESENCE (`/app/room.getPresence`)

**Request:** Client → Server, body `{ "roomId": "string" }`. Room member only.

**Response:** Server → Client, destination `/user/queue/room-presence` (`RoomPresenceEvent.Snapshot`).

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

| Field | Type | Description |
|------|-----|----------|
| `members[].internalId` | string | Stable internal id |
| `members[].online` | boolean | Active WS connection (global heartbeat, 30s TTL) |
| `members[].lastSeen` | number? | Epoch ms, rounded to minute; omitted if presence not yet observed |

**Live updates:** Server → Client broadcast on `/topic/room/{roomId}` — `RoomPresenceEvent`
(`roomId`, `internalId`, `online`, `lastSeen`) on member connect / subscribe / disconnect.

**Error:** `{ "success": false, "error": "NOT_MEMBER | ROOM_NOT_FOUND | INTERNAL_ERROR" }`

> **Metadata leak:** presence reveals who was active in the room and when. See [SECURITY.md](./SECURITY.md#room-presence-metadata).

---

### KICK_MEMBER (`/app/room.kick`)

**Direction:** Client → Server (owner or admin; admin may kick members only)

**Request** (`KickMemberRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `targetInternalId` | string | Yes | Internal ID of member to remove |

**Response to initiator:** `/user/queue/room-kick-result` (`RoomKickResultEvent`) — exactly one
event per kick request (success or failure).

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

**Server cleanup:** SREM `room_members` / `member_rooms`; HDEL `room_member_pubkey`; DEL `room_join_request:{roomId}:{target}`; HDEL victim bundle in **all** epochs `room_keys:{roomId}:{epoch}`; **force-unsubscribe** from `/topic/room/{roomId}` for all victim STOMP sessions.

**Events after successful kick:**

| Event | Destination | Recipient | Fields |
|---------|-------------|------------|------|
| `ROOM_KICKED` | `/user/queue/room-kicked` | Victim | `roomId`, `byInternalId` |
| `ROOM_MEMBER_REMOVED` | `/user/queue/room-member-removed` | Each remaining member (incl. owner) | `roomId`, `removedInternalId` |
| `ROOM_KICK_RESULT` | `/user/queue/room-kick-result` | Initiator (owner) | `success`, `roomId`, `targetInternalId`, `error?` |

Owner **must** rekey after `ROOM_MEMBER_REMOVED` (see [SECURITY.md](./SECURITY.md) — forward secrecy on kick).

Rate-limit: `SESSION_ACTION` (10/min), same as ban/mute (`RoomHandler.enforceRateLimit`). `room.acceptJoin` / `room.rejectJoin` have no separate `SESSION_ACTION` — they fall into `GENERAL` via interceptor.

---

### BAN_MEMBER (`/app/room.ban`)

**Direction:** Client → Server (owner-only)

**Request** (`BanMemberRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `targetInternalId` | string | Yes | Internal ID of member to ban |

Logically = kick **+** entry in `room_bans:{roomId}`. Victim removed from membership
and gets same events as kick (`ROOM_KICKED`, `ROOM_MEMBER_REMOVED` to others); initiator gets
`ROOM_KICK_RESULT` on `/user/queue/room-kick-result`.

**Errors:** same as `KICK_MEMBER` (`NOT_OWNER`, `CANNOT_KICK_SELF`, `CANNOT_KICK_OWNER`,
`NOT_MEMBER`, `ROOM_NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`).

**Server cleanup:** as kick + `SADD room_bans:{roomId} {targetInternalId}`; force-unsubscribe
from `/topic/room/{roomId}`.

Banned `internalId` cannot rejoin (`requestJoin` / `acceptJoin`) → `USER_BANNED`.

Rate-limit: `SESSION_ACTION` (10/min).

---

### UNBAN_MEMBER (`/app/room.unban`)

**Direction:** Client → Server (owner-only)

**Request:** same payload as ban — `{ "roomId": "string", "targetInternalId": "string" }`
(`BanMemberRequest`).

**Server:** `SREM room_bans:{roomId} {targetInternalId}`. No separate user-queue ack
(fire-and-forget); errors logged (`NOT_OWNER`, `ROOM_NOT_FOUND`).

---

### GET_ROOM_BANS (`/app/room.getBans`)

**Direction:** Client → Server (owner-only)

**Request:** `{ "roomId": "string" }` (same shape as `GET_ROOM_MEMBERS`).

**Response:** `/user/queue/room-bans` (`RoomBanListEvent`):

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

**Direction:** Client → Server (owner or admin; admin may mute members only)

**Request** (`MuteMemberRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `targetInternalId` | string | Yes | Internal ID of member to mute |

Member **remains** in `room_members`; server adds `internalId` to `room_muted:{roomId}`.
Rekey is **not** required.

**Errors (log):** `NOT_OWNER`, `CANNOT_KICK_SELF`, `CANNOT_KICK_OWNER`, `CANNOT_KICK_ADMIN`, `NOT_MEMBER`, `ROOM_NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`.

**Event after success:** `ROOM_MODERATION` on `/topic/room/{roomId}` (`RoomModerationEvent` with `mutedAdded`).

Rate-limit: `SESSION_ACTION` (10/min).

---

### UNMUTE_MEMBER (`/app/room.unmute`)

**Direction:** Client → Server (owner or admin)

**Request:** same payload as mute — `{ "roomId": "string", "targetInternalId": "string" }`
(`MuteMemberRequest`).

**Server:** `SREM room_muted:{roomId} {targetInternalId}`. On successful removal — broadcast
`ROOM_MODERATION` with `mutedRemoved` on `/topic/room/{roomId}`.

---

### SET_READ_ONLY (`/app/room.setReadOnly`)

**Direction:** Client → Server (owner or admin)

**Request** (`SetReadOnlyRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `readOnly` | boolean | Yes | `true` — owner and admin can post; member gets `ROOM_READ_ONLY` |

**Server:** `HSET room:{roomId} readOnly {true|false}`; broadcast `ROOM_MODERATION` with `readOnly`.

**Send enforce:** member when `readOnly=true` → `/user/queue/room-message-sent` with `error=ROOM_READ_ONLY`.
Owner and admin can send in read-only.

---

### SET_ROLE (`/app/room.setRole`)

**Direction:** Client → Server (owner-only)

**Request** (`SetRoleRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `targetInternalId` | string | Yes | Member internal ID |
| `role` | enum | Yes | `admin` or `member` (remove overlay) |

**Server:** owner-only; target ∈ `room_members`; cannot change owner role; `admin` → `HSET room_roles`;
`member` → `HDEL room_roles`. Broadcast `ROOM_ROLE_UPDATED` on `/topic/room/{roomId}`.

**Errors (log):** `NOT_OWNER`, `NOT_MEMBER`, `CANNOT_SET_ROLE_ON_OWNER`, `INVALID_ROLE`, `ROOM_NOT_FOUND`.

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

**Direction:** Client → Server (owner-only)

**Request** (`SetRoomTtlRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `ttlSeconds` | number | No* | Relative lifetime in seconds from "now" |
| `autoBurnAt` | number | No* | Absolute auto-burn moment (Unix epoch ms) |

\* Exactly **one** of `ttlSeconds` or `autoBurnAt` is required. If both set — `autoBurnAt` is used.

**Server:** owner-only; `HSET room:{roomId} autoBurnAt {value}`; `EXPIRE room:{roomId}` until deadline (cap);
`SET room:autoburn:{roomId}` with TTL until deadline (trigger, not extended by activity).

**Errors (log):** `NOT_OWNER`, `ROOM_NOT_FOUND`, `TTL_OR_AUTOBURN_REQUIRED`, `INVALID_TTL`,
`AUTO_BURN_IN_PAST`, `INTERNAL_ERROR`.

**Event after success:** `ROOM_TTL_UPDATED` on `/topic/room/{roomId}`.

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

**Auto-burn:** when `room:autoburn:{roomId}` expires server runs same cascade as
`/app/room.burn`, and sends `ROOM_BURNED` to `/user/queue/room-burned` to each member.

---

### SET_MESSAGE_TTL (`/app/room.setMessageTtl`)

**Direction:** Client → Server (owner-only)

**Request** (`SetMessageTtlRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `messageTtlSeconds` | number | Yes | Message self-destruct timer in seconds; `0` = off |

**Server:** owner-only; `HSET room:{roomId} messageTtl {value}`; immediate lazy prune
`messages:{roomId}`; broadcast event.

**Errors (log):** `NOT_OWNER`, `ROOM_NOT_FOUND`, `INVALID_MESSAGE_TTL`, `INTERNAL_ERROR`.

**Event after success:** `ROOM_MESSAGE_TTL_UPDATED` on `/topic/room/{roomId}`.

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

**Direction:** Client → Server (owner-only)

**Request** (`TransferOwnershipRequest`):

| Field | Type | Required | Description |
|------|-----|-------------|----------|
| `roomId` | string | Yes | Room UUID |
| `newOwnerInternalId` | string | Yes | Internal ID of active member who will become owner |

**Server:** owner-only check; `newOwnerInternalId` ∈ `room_members`; atomically
`HSET room:{roomId} ownerInternalId {newOwnerInternalId}`; previous owner →
`HSET room_roles:{roomId} {previousOwner} admin`; `HDEL room_roles:{roomId} {newOwner}`.
**Rekey not required** — new owner is already a member with group key.

**Errors (log):** `NOT_OWNER`, `NOT_MEMBER`, `CANNOT_TRANSFER_TO_SELF`, `ROOM_NOT_FOUND`, `INTERNAL_ERROR`.

**Event after success:** `ROOM_OWNERSHIP_TRANSFERRED` on `/topic/room/{roomId}`.

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

| Field | Description |
|------|----------|
| `readOnly` | Current read-only flag after change |
| `mutedAdded` | On mute — added internalId |
| `mutedRemoved` | On unmute — removed internalId |

---

### ROOM_CREATED

**Direction:** Server → Client  
**Destination:** `/user/queue/room-created`

**Success:**
```json
{
  "success": true,
  "roomId": "uuid-v4"
}
```

**Error** (on `/user/queue/room-created` only `INTERNAL_ERROR` is emitted):
```json
{
  "success": false,
  "error": "INTERNAL_ERROR"
}
```

Request validation → `VALIDATION_ERROR` on `/user/queue/errors`; STOMP rate-limit exceed → `RATE_LIMIT_EXCEEDED` there (see Rate Limits above). Those codes do **not** arrive on `room-created`.

---

## Related Documents

- [DATA_MODELS.md](./DATA_MODELS.md) — Redis data structures
- [SECURITY.md](./SECURITY.md) — cryptography
- [ARCHITECTURE.md](./ARCHITECTURE.md) — overall architecture

