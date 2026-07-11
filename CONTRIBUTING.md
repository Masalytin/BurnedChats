# Contributing to Burned Chats

Thank you for your interest in contributing. This repository is the **public OSS
face** of Burned Chats: product code plus stable specifications under
`docs/specs/`. Internal backlog, task cards, and agent workflow live in a
**private maintainer repo** and are not part of this clone.

## Prerequisites

| Module | Requirements |
|--------|----------------|
| **Backend** | Java 21, Docker (for integration tests via Testcontainers) |
| **Frontend** | Node.js 20+ or 22+ |
| **Contracts** | Node.js 20+ or 22+ |
| **Local stack** | Docker + Docker Compose (optional; see README Quick start) |

## Build & test matrix

Run these from the repository root before opening a PR. All commands must exit 0.

### Backend

```bash
cd backend
./gradlew clean build
```

Unit/component tests run in `build`. Integration tests (`integrationTest`) require
a running Docker Engine.

### Frontend

```bash
cd frontend
npm ci
npm run lint
npm run build
npm test
```

### Contracts

```bash
cd contracts
npm ci
npm run lint
npm run build
npm test
```

Coverage gate for contracts: `npm run test:coverage` (80% minimum) when touching
Tact code.

## Specifications are the contract

When you change behaviour that affects contributors or integrators, update the
matching spec in the **same change**:

| Change type | Update |
|-------------|--------|
| REST / STOMP API | `docs/specs/API.md` |
| Redis keys, DTOs | `docs/specs/DATA_MODELS.md` |
| Crypto, threat model | `docs/specs/SECURITY.md` |
| Architecture | `docs/specs/ARCHITECTURE.md` |
| Token / on-chain | `docs/specs/TOKENOMICS.md` |
| User flows | `docs/specs/USER_FLOWS.md`, `USER_FLOWS_ROOMS.md` |
| Telegram integration | `docs/specs/TELEGRAM.md` |

Do not link to internal backlog paths (phase plans, improvement reports, task cards,
decision logs) from public specs — they are not shipped in this repository.

## Internationalization

All user-visible strings go through i18n. See [`docs/specs/I18N.md`](docs/specs/I18N.md)
for frontend (`react-i18next`) and backend/bot (`MessageSource`) conventions.

## Pull requests

1. Fork and branch from `master`.
2. Keep commits focused; use conventional scope in messages (`feat(backend): …`,
   `fix(frontend): …`, `docs(specs): …`).
3. Ensure the build matrix above is green.
4. Do not force-push to `master`.
5. AGPL-3.0 applies — network deployments of modified versions must offer
   corresponding source to users (see [LICENSE](LICENSE)).

## What is not in this repo

The following are **maintainer-only** and intentionally absent from the public
clone:

- Phase plans, task cards, decision logs (maintainer-only backlog)
- Backlog validator and parallel worktree scripts
- Cursor agent rules and skills

Specs in `docs/specs/` are the authoritative reference for external
contributors. Questions about roadmap priority or internal cards should go to
the maintainer via GitHub issues — not by expecting those paths in this tree.

## Documentation index

| Spec | Topic |
|------|-------|
| [API.md](docs/specs/API.md) | REST and STOMP |
| [ARCHITECTURE.md](docs/specs/ARCHITECTURE.md) | System design |
| [BAND_KEY_EXCHANGE.md](docs/specs/BAND_KEY_EXCHANGE.md) | In-band ECDH |
| [DATA_MODELS.md](docs/specs/DATA_MODELS.md) | Redis and DTOs |
| [GROUP_KEY_PROTOCOL.md](docs/specs/GROUP_KEY_PROTOCOL.md) | Group E2EE |
| [I18N.md](docs/specs/I18N.md) | Localization |
| [LANDING_PAGE.md](docs/specs/LANDING_PAGE.md) | Marketing copy spec |
| [SECURITY.md](docs/specs/SECURITY.md) | Threat model |
| [TELEGRAM.md](docs/specs/TELEGRAM.md) | Mini App and bot |
| [TOKENOMICS.md](docs/specs/TOKENOMICS.md) | BURN token |
| [USER_FLOWS.md](docs/specs/USER_FLOWS.md) | 1:1 chat UX |
| [USER_FLOWS_ROOMS.md](docs/specs/USER_FLOWS_ROOMS.md) | Rooms UX |
