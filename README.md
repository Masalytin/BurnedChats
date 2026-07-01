# Burned Chats

> **End-to-end encrypted, self-destructing chat as a Telegram Mini App — with a trustless relay server, in-band ECDH key exchange, and an experimental deflationary token on TON.**

[![Contracts CI](https://github.com/Masalytin/BurnedChats/actions/workflows/contracts.yml/badge.svg)](https://github.com/Masalytin/BurnedChats/actions/workflows/contracts.yml)
![Backend](https://img.shields.io/badge/Backend-Java%2021%20%2B%20Spring%20Boot%203.3-orange)
![Frontend](https://img.shields.io/badge/Frontend-React%2019%20%2B%20Vite%207%20%2B%20TypeScript-blue)
![Crypto](https://img.shields.io/badge/E2EE-ECDH%20P--256%20%2B%20AES--256--GCM-green)
![Contracts](https://img.shields.io/badge/Contracts-TON%20Jetton%20(Tact)-9cf)
![License](https://img.shields.io/badge/License-AGPL--3.0-blue)

Burned Chats is a private messenger where the server never sees message content —
only opaque encrypted bytes. Keys are derived and held **client-side** (Web Crypto
API); messages "burn" when a chat is closed. It runs as a Telegram Mini App on top
of a Java/Spring backend, a React frontend, and a set of TON smart contracts.

> **This is an open-source portfolio project.** It is engineered like a real
> product (task cards, decision logs, tests, CI, Docker deploy), but it is **not**
> a funded, audited, or officially launched service. Read
> [What this is / is NOT](#-what-this-is--what-this-is-not) before drawing
> conclusions — especially about the token.

---

## ✨ Highlights

- **Real end-to-end encryption** — ECDH P-256 handshake + AES-256-GCM, performed
  entirely in the browser. The relay only stores/forwards ciphertext and metadata.
- **Trustless relay architecture** — the backend is a rendezvous + relay +
  notification service; it has no access to plaintext or keys.
- **In-band key exchange with visual verification** — MITM protection via a shared
  visual fingerprint, no external channel required.
- **1-on-1 chats, password rooms, and group E2EE** — group key with rotation on
  member changes; zero-knowledge password rooms (server stores only salt + proof).
- **Encrypted media** — chunked AES-GCM for files and images.
- **Full Web3 layer on TON** — TON Connect wallet auth, a deflationary Jetton
  (TEP-74) with staking / governance / treasury / vesting contracts, written in
  **Tact** with a Sandbox test suite and an 80% coverage gate.
- **Production-shaped ops** — Docker Compose (dev / prod / SSL), Nginx TLS
  termination, Redis with TTL-only storage, Actuator + Prometheus metrics.
- **Engineering discipline** — phased development plans, per-task cards, decision
  logs, and specs under [`docs/`](docs/CONTEXT.md).

---

## 🏗️ Architecture

```
┌─────────────┐        WSS/STOMP        ┌─────────────┐        WSS/STOMP        ┌─────────────┐
│    Alice    │◄───────────────────────►│   Backend   │◄───────────────────────►│     Bob     │
│  (browser)  │   encrypted blobs only  │   (relay)   │   encrypted blobs only  │  (browser)  │
└──────┬──────┘                         └──────┬──────┘                         └──────┬──────┘
       │ keys in RAM                            │ metadata + ciphertext in Redis        │ keys in RAM
       │ AES-256-GCM                            │ (TTL, never plaintext)                │ AES-256-GCM
       │                                        │
       │ TON Connect (sign)                     │ read-only TON RPC (balance/staking)
       ▼                                        ▼
┌─────────────┐                          ┌─────────────┐
│  TON Wallet │                          │  TON RPC    │
└──────┬──────┘                          └─────────────┘
       │
       ▼
┌───────────────────────────────────────────────────────────────┐
│                        TON BLOCKCHAIN                          │
│   BURN Jetton · Staking · Governance · Treasury · Vesting      │
└───────────────────────────────────────────────────────────────┘
```

The server performs exactly three roles: **rendezvous** (connect users), **relay**
(forward encrypted packets), and **notification** (Telegram bot pings, no content).
Full design: [`docs/specs/ARCHITECTURE.md`](docs/specs/ARCHITECTURE.md).

---

## 🧰 Tech stack

| Layer | Technologies |
|-------|--------------|
| **Frontend** | React 19, Vite 7, TypeScript 5.9, Telegram Mini App SDK, Web Crypto API, TON Connect UI, react-i18next |
| **Backend** | Java 21, Spring Boot 3.3, Spring Web + WebSocket/STOMP, Spring WebFlux (TON RPC), Lettuce (reactive Redis), MapStruct, Micrometer/Prometheus |
| **Storage** | Redis 7 — TTL-only, no persistent plaintext store |
| **Smart contracts** | TON, Tact, Jetton (TEP-74), Blueprint + Sandbox tests |
| **Infra** | Docker Compose (dev/prod/SSL), Nginx, Let's Encrypt |
| **Crypto** | ECDH P-256, AES-256-GCM, HKDF, PBKDF2 (room passwords) |

---

## 🚀 Quick start (local, dev)

Requirements: Docker + Docker Compose. A Telegram bot token is optional for local
dev (a dev auth provider is enabled in the `dev` profile).

```bash
git clone https://github.com/Masalytin/BurnedChats.git
cd BurnedChats

cp .env.example .env          # optional for local dev; fill TELEGRAM_BOT_TOKEN if you have one
docker compose up -d --build
```

- Frontend: <http://localhost:3000>
- Backend health: <http://localhost:8080/actuator/health>
- Redis: `localhost:6379`

Production compose (TLS, Redis password, prod profile):

```bash
cp .env.example .env.prod     # fill DOMAIN, REDIS_PASSWORD, TELEGRAM_* , TON addresses
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

---

## 🧪 Building & testing

```bash
# Backend (Java 21) — unit/component tests (no Docker required)
cd backend && ./gradlew build

# Backend integration tests (Testcontainers; requires Docker Engine)
./gradlew integrationTest

# Frontend (Node 20+/22+)
cd frontend && npm ci && npm run lint && npm run build && npm test

# Smart contracts (Tact + Sandbox, 80% coverage gate)
cd contracts && npm ci && npm run build && npm run test:coverage && npm run lint
```

Test surface today: **64** backend test files, **34** frontend test files, **14**
contract spec files.

---

## 📁 Repository layout

```
BurnedChats/
├── backend/        # Java 21 / Spring Boot relay, STOMP handlers, Redis repos, TON RPC client
├── frontend/       # React 19 Mini App — crypto, chat/rooms UI, TON Connect, i18n
├── contracts/      # TON smart contracts (Tact): jetton, staking, governance, treasury, vesting
├── docs/           # entry point: docs/CONTEXT.md — specs, phase plans, task cards, decisions
├── scripts/        # backlog validator, worktree helpers, CLI tooling
├── docker-compose*.yml
└── .github/workflows/
```

Start reading at [`docs/CONTEXT.md`](docs/CONTEXT.md). Specifications live in
[`docs/specs/`](docs/specs/) (API, data models, security, tokenomics).

---

## 🔐 Security model (honest version)

**What is protected:**

- **Message content** — encrypted client-side (AES-256-GCM). The server and its
  operator cannot read messages.
- **Keys** — negotiated via ECDH in the browser; never sent to or stored by the
  server. Room passwords are verified zero-knowledge (server keeps salt + proof).
- **Integrity & MITM** — GCM auth tags + a visual fingerprint both parties confirm.

**What is NOT protected (by design / current scope):**

- **Metadata is visible.** The relay and Telegram see *who talks to whom*, when,
  and how much — Telegram IDs, timing, and traffic volume. This is **not** an
  anonymity/metadata-privacy tool like SimpleX or Session.
- **This is E2EE, not "zero-knowledge proofs."** "Zero-knowledge" here means the
  *server has zero knowledge of content* — it does **not** involve zk-SNARKs/STARKs.
- **No independent security audit** has been performed. Treat the crypto as
  well-intentioned and reviewable, not as production-hardened for adversarial use.

Details and threat model: [`docs/specs/SECURITY.md`](docs/specs/SECURITY.md).

---

## 🪙 BURN token — status & disclaimer

The `contracts/` directory contains a complete, tested TON token stack (Jetton
TEP-74 with a 1% transfer fee split into burn/staking/treasury, tiered staking,
governance, treasury, and vesting).

**Current status:** contracts are implemented and tested in Sandbox and deploy to
**TON testnet**. There has been **no external audit** and **no mainnet launch with
real liquidity**.

> ⚠️ **BURN has no monetary value and is not an investment.** It exists as an
> engineering artifact / experiment. Do not buy it expecting returns; there is no
> funded liquidity, no audit, and no distribution program behind it. Tokenomics
> parameters in [`docs/specs/TOKENOMICS.md`](docs/specs/TOKENOMICS.md) are a design
> exercise, not promises.

---

## 🗺️ Roadmap & docs

- Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Phase plans: [`docs/phases/`](docs/phases/)
- API / data models / security / tokenomics: [`docs/specs/`](docs/specs/)

---

## 📄 License

**GNU AGPL-3.0** — see [`LICENSE`](LICENSE).

Free to use, study, modify, and self-host. The key term (vs. MIT/Apache): **if you
run a modified version as a network service, you must make your modified source
available to its users.** This keeps derivatives open and deters closed-source
commercial exploitation, while remaining OSI-approved open source.

> The name **"Burned Chats"**, its logo, domain, and official Telegram bot are
> project trademarks and are **not** granted by this license. Forks may reuse the
> code under AGPL-3.0 but must not present themselves as the official Burned Chats.

Copyright © 2026 Burned Chats. <!-- TODO: replace with your name/handle -->
For commercial licensing (an AGPL exception), contact the copyright holder.
