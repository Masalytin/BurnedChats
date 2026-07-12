# Burned Chats

End-to-end encrypted, ephemeral chat delivered as a Telegram Mini App. A trustless
relay server forwards ciphertext only; keys are derived and held client-side (Web
Crypto API). The stack includes a Java/Spring backend, a React frontend, and TON
smart contracts for wallet auth and an experimental deflationary token.

[![Backend CI](https://github.com/Masalytin/BurnedChats/actions/workflows/backend.yml/badge.svg)](https://github.com/Masalytin/BurnedChats/actions/workflows/backend.yml)
[![Frontend CI](https://github.com/Masalytin/BurnedChats/actions/workflows/frontend.yml/badge.svg)](https://github.com/Masalytin/BurnedChats/actions/workflows/frontend.yml)
[![Contracts CI](https://github.com/Masalytin/BurnedChats/actions/workflows/contracts.yml/badge.svg)](https://github.com/Masalytin/BurnedChats/actions/workflows/contracts.yml)

| | |
|---|---|
| Backend | Java 21, Spring Boot 3.3 |
| Frontend | React 19, Vite 7, TypeScript |
| Crypto | ECDH P-256, AES-256-GCM |
| Contracts | TON Jetton (Tact) |
| License | AGPL-3.0 |

This repository is an open-source project with production-shaped engineering (tests,
CI, specs, Docker). It is **not** a funded, audited, or officially launched service.
Read [Project status](#project-status) before treating the token or deployment as
production-ready.

---

## Features

- **Client-side E2EE** — ECDH handshake and AES-256-GCM in the browser; the relay
  stores and forwards ciphertext and metadata only.
- **Trustless relay** — rendezvous, packet relay, and Telegram notifications without
  access to plaintext or keys.
- **In-band key exchange** — visual fingerprint verification without an external channel.
- **1:1 chats and password rooms** — group E2EE with key rotation on membership changes;
  room passwords verified zero-knowledge (server stores salt + proof only).
- **Encrypted media** — chunked AES-GCM for files and thumbnails.
- **TON integration** — TON Connect wallet auth; Jetton (TEP-74) with staking, governance,
  treasury, and vesting contracts (Tact + Sandbox tests, 80% coverage gate).
- **Operations** — Docker Compose (dev / prod / SSL), Nginx TLS, Redis with TTL-only
  storage, Actuator + Prometheus metrics.
- **Specifications** — API, security, and data models under [`docs/specs/`](docs/specs/).

---

## Architecture

```
┌─────────────┐        WSS/STOMP        ┌─────────────┐        WSS/STOMP        ┌─────────────┐
│    Alice    │◄───────────────────────►│   Backend   │◄───────────────────────►│     Bob     │
│  (browser)  │   encrypted blobs only  │   (relay)   │   encrypted blobs only  │  (browser)  │
└──────┬──────┘                         └──────┬──────┘                         └──────┬──────┘
       │ keys in RAM                            │ metadata + ciphertext in Redis        │ keys in RAM
       │                                        │ (TTL, never plaintext)                │
       │ TON Connect                            │ read-only TON RPC                     │
       ▼                                        ▼
┌─────────────┐                          ┌─────────────┐
│  TON Wallet │                          │  TON RPC    │
└──────┬──────┘                          └─────────────┘
       ▼
┌───────────────────────────────────────────────────────────────┐
│  TON: BURN Jetton · Staking · Governance · Treasury · Vesting │
└───────────────────────────────────────────────────────────────┘
```

The server performs three roles: **rendezvous** (connect users), **relay** (forward
encrypted packets), and **notification** (Telegram bot pings without message content).

Full design: [`docs/specs/ARCHITECTURE.md`](docs/specs/ARCHITECTURE.md).

---

## Quick start (local)

Requirements: Docker and Docker Compose. A Telegram bot token is optional for local
development (a dev auth provider is available under the `dev` Spring profile).

```bash
git clone https://github.com/Masalytin/BurnedChats.git
cd BurnedChats

cp .env.example .env          # optional; set TELEGRAM_BOT_TOKEN if you have one
docker compose up -d --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend health | http://localhost:8080/actuator/health |
| Redis | localhost:6379 |

Production (TLS, Redis password, prod profile):

```bash
cp .env.example .env.prod     # DOMAIN, REDIS_PASSWORD, TELEGRAM_*, TON addresses
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

---

## Build and test

```bash
# Backend (Java 21)
cd backend && ./gradlew clean build

# Backend integration tests (Testcontainers; requires Docker)
./gradlew integrationTest

# Frontend (Node 20+ or 22+)
cd frontend && npm ci && npm run lint && npm run build && npm test

# Smart contracts (80% coverage gate on wrappers/helpers)
cd contracts && npm ci && npm run build && npm run test:coverage && npm run lint
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full matrix and PR expectations.

---

## Repository layout

```
BurnedChats/
├── backend/          # Spring Boot relay, STOMP handlers, Redis, TON RPC client
├── frontend/         # React Mini App — crypto, chat/rooms UI, TON Connect, i18n
├── contracts/        # TON smart contracts (Tact)
├── docs/specs/       # API, security, data models, tokenomics
├── scripts/          # CLI, git hooks, i18n checker, SSL setup
├── docker-compose*.yml
└── .github/workflows/
```

Start with [ARCHITECTURE.md](docs/specs/ARCHITECTURE.md) and [SECURITY.md](docs/specs/SECURITY.md).

---

## Security model

**Protected today**

| Property | Mechanism |
|----------|-----------|
| Message content | AES-256-GCM; server never decrypts |
| Keys | ECDH in browser; not stored server-side |
| Room passwords | Zero-knowledge proof (salt + hash on server) |
| Integrity / MITM | GCM auth tags + visual fingerprint ceremony |

**Not protected (by design or current scope)**

- **Metadata** — the relay and Telegram can observe who talks to whom, timing, and
  traffic volume. This is not a metadata-private messenger.
- **"Zero-knowledge"** here means the server has zero knowledge of **content** — not
  zk-SNARK/STARK proofs.
- **No independent security audit** — treat the cryptography as reviewable engineering,
  not as adversarially hardened production crypto.

Threat model: [`docs/specs/SECURITY.md`](docs/specs/SECURITY.md).

---

## Project status

| Area | Status |
|------|--------|
| Application (chat, rooms, files) | Implemented; self-hostable |
| Smart contracts | Implemented; Sandbox-tested; deployed to **TON testnet** |
| External audit | **Not completed** |
| Mainnet token launch | **Not launched**; no real liquidity program |

### BURN token disclaimer

The `contracts/` directory contains a complete TON token stack (Jetton TEP-74 with
transfer fee split, staking, governance, treasury, vesting). Parameters in
[`docs/specs/TOKENOMICS.md`](docs/specs/TOKENOMICS.md) describe the **design**, not
investment promises.

**BURN has no monetary value and is not an investment.** Do not expect returns; there
is no funded liquidity, no external audit, and no distribution program behind it.

---

## Documentation

| Document | Topic |
|----------|-------|
| [ARCHITECTURE.md](docs/specs/ARCHITECTURE.md) | System design |
| [SECURITY.md](docs/specs/SECURITY.md) | Cryptography and threat model |
| [API.md](docs/specs/API.md) | REST and WebSocket/STOMP |
| [DATA_MODELS.md](docs/specs/DATA_MODELS.md) | Redis keys and DTOs |
| [BAND_KEY_EXCHANGE.md](docs/specs/BAND_KEY_EXCHANGE.md) | In-band ECDH |
| [GROUP_KEY_PROTOCOL.md](docs/specs/GROUP_KEY_PROTOCOL.md) | Group E2EE for rooms |
| [TELEGRAM.md](docs/specs/TELEGRAM.md) | Mini App and bot |
| [TOKENOMICS.md](docs/specs/TOKENOMICS.md) | BURN token design |
| [I18N.md](docs/specs/I18N.md) | Localization |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Build, test, PR workflow |

---

## License

**GNU AGPL-3.0** — see [LICENSE](LICENSE).

You may use, study, modify, and self-host the software. If you run a modified version
as a network service, you must offer corresponding source to its users.

The name **Burned Chats**, its logo, domain, and official Telegram bot are project
trademarks and are not granted by this license. Forks may reuse the code under
AGPL-3.0 but must not present themselves as the official Burned Chats.

Copyright © 2026 Denis Masalytin.
