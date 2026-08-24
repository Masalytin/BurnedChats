# System Architecture

> Trustless relay for end-to-end encrypted ephemeral chat (Telegram Mini App, optional TON wallet auth)

## Overview

```
┌──────────────┐   HTTPS / WSS (STOMP)   ┌─────────────────────┐   Bot webhook
│   Frontend   │◄───────────────────────►│  Spring Boot relay  │◄────────────── Telegram
│  Mini App    │   ciphertext + metadata │  + Redis (TTL+AOF)  │
│  Web Crypto  │                         │                     │
└──────────────┘                         └─────────────────────┘
       │ keys in RAM only                         │
       │                                          │ read-only TON RPC
       ▼                                          ▼
  (no persistence)                          TON contracts (testnet)
```

### Principles

1. **Zero-knowledge** — server relays opaque ciphertext; no decryption keys on server
2. **Ephemeral storage** — Redis keys with TTL; no SQL or durable **plaintext**
   chat history. Compose enables AOF so ciphertext/metadata survive a Redis
   process restart; losing the volume or `FLUSH*` still wipes all rendezvous.
3. **Client-side crypto** — ECDH P-256 + AES-256-GCM via Web Crypto API
4. **Fail-safe destruction** — keys wiped from RAM on close, burn, or long background

---

## Frontend (`frontend/`)

| Area | Location | Role |
|------|----------|------|
| App shell | `App.tsx`, `AppRouter.tsx` | Mini App at `/app`; public landing at `/` |
| Crypto | `src/crypto/` | `ecdh.ts`, `aes.ts`, `groupKey.ts`, `fileEncryption.ts`, `keyStore.ts`, `pow.ts`, `kdf.ts` |
| STOMP | hooks + services | WebSocket client, event handlers (no separate `socket/` package) |
| Rooms / DM UI | `components/Chat/`, `components/Room*` | Encrypted 1:1 and group rooms |
| TON | `src/ton/`, wallet pages | TON Connect auth, jetton balance, staking, governance |
| i18n | `src/i18n/` | react-i18next; locales `en`, `ru`, `ar`, `de`, `es`, `fr`, `uk`, `zh-CN` |
| Telegram SDK | `@twa-dev/sdk` via `hooks/useTelegram.ts` | Theme, haptics, initData |

Keys live in an in-memory `keyStore` (not `sessionStorage`). See [SECURITY.md](./SECURITY.md).

---

## Backend (`backend/`)

Java 21, Spring Boot 3.3, WebFlux, STOMP over WebSocket (SockJS fallback), Lettuce reactive Redis.

```
dev.burnedchats/
├── handler/          # STOMP @MessageMapping (Search, Session, Handshake, Message, Room, Burn, PoW, …)
├── controller/       # REST: Health, Auth, File, Wallet, Governance, DevAuth (dev only)
├── service/          # Session lifecycle, rooms, files, burn cascade, rate limits, notifications
├── repository/       # Redis access (sessions, messages, rooms, files, identity, …)
├── security/         # Handshake auth, STOMP interceptors, wallet/Telegram validation, PoW
├── telegram/         # Webhook bot, BotMessageService, TelegramWebhookController
├── ton/              # JettonService, StakingVerifier, GovernanceVerifier, TonProofVerifier
├── config/           # WebSocket, Redis, properties
├── model/ + dto/     # Domain models and wire DTOs
└── messaging/        # StompUserMessenger (delivery by internalId)
```

### What the backend does

- Validates Telegram `initData` and TON wallet proofs
- Rendezvous: connect users by `internalId`, relay encrypted packets
- Stores ciphertext blobs and metadata in Redis with TTL (AOF may persist those
  opaque blobs on disk; keys never leave the client)
- Sends Telegram bot notifications **without** message content
- Read-only TON contract queries for wallet/governance UI

### What the backend does not do

- Store or derive encryption keys
- Decrypt messages or room names
- Log message plaintext

---

## Identity model

Canonical user key: **`internalId`** (UUID string). STOMP `Principal#getName()` and all `/user/queue/*` routing use `internalId`.

| Auth mode | Credentials | `telegramId` |
|-----------|-------------|--------------|
| Telegram (default) | `X-Telegram-Init-Data` on WS handshake | present when linked |
| Wallet | `X-Auth-Type: wallet` + `X-Auth-Token` | absent until linked |

Authentication happens on the **HTTP WebSocket handshake** (`StompHandshakeAuthInterceptor`), not on STOMP `CONNECT`. Details: [API.md](./API.md#authentication).

---

## Redis

Single metadata store. Key families: sessions, offline message queues, rooms, invites, files, rate limits, identity (`auth_tg:`, `auth_wallet:`, `user:`), TON RPC cache. Full inventory: [DATA_MODELS.md](./DATA_MODELS.md).

---

## Telegram bot

Production uses **webhook** mode (`BurnedChatsWebhookBot`, `POST /api/telegram/webhook`). Commands: `/start`, `/help`, `/burn` (remote burn-all). Localized via `BotMessageService` + `MessageSource`. Details: [TELEGRAM.md](./TELEGRAM.md).

---

## TON contracts (`contracts/`)

Tact contracts: BURN jetton (TEP-74), staking, governance, treasury, vesting. Deployed to **testnet**; not audited mainnet production. Backend exposes read-only REST (`/api/wallet/*`, `/api/governance/*`). Token design: [TOKENOMICS.md](./TOKENOMICS.md).

---

## Deployment (current)

Typical self-hosted stack:

- One Spring Boot instance
- One Redis instance
- Nginx reverse proxy (TLS, CSP, rate limits)
- Optional Docker Compose profiles (`dev`, `prod`, `testnet`)

Horizontal multi-instance STOMP fan-out is **not** implemented (simple broker, not Redis pub/sub relay).

---

## Related documents

| Document | Topic |
|----------|-------|
| [API.md](./API.md) | REST and STOMP contract |
| [DATA_MODELS.md](./DATA_MODELS.md) | Redis keys and DTOs |
| [SECURITY.md](./SECURITY.md) | Cryptography and threat model |
| [GROUP_KEY_PROTOCOL.md](./GROUP_KEY_PROTOCOL.md) | Room group E2EE |
