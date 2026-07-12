# Contributing to Burned Chats

Thank you for your interest in contributing. This repository contains the
**public source** of Burned Chats: application code and stable specifications
under `docs/specs/`. Product behaviour is defined by those specs — keep them in
sync when you change APIs, data models, or security-relevant behaviour.

## Prerequisites

| Module | Requirements |
|--------|----------------|
| **Backend** | Java 21, Docker (Testcontainers integration tests) |
| **Frontend** | Node.js 20+ or 22+ |
| **Contracts** | Node.js 20+ or 22+ |
| **Local stack** | Docker + Docker Compose (optional; see README Quick start) |

## Build & test matrix

Run from the repository root before opening a PR. All commands must exit 0.

### Backend

```bash
cd backend
./gradlew clean build
```

Integration tests (`integrationTest`) require a running Docker Engine.

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

When touching Tact code, also run `npm run test:coverage` (80% minimum on wrappers
and helpers).

## Specifications are the contract

Update the matching spec in the **same change** when behaviour affects
contributors or integrators:

| Change type | Update |
|-------------|--------|
| REST endpoints / request-response shapes | `docs/specs/openapi.yaml` — run `./gradlew exportOpenApi` from repo root and commit the diff |
| Inbound STOMP `@MessageMapping` destinations | `docs/specs/stomp-routes.json` — run `./gradlew exportStompRoutes` and commit the diff |
| Auth handshake, rate limits, error taxonomy, ZK field semantics, server→client STOMP events | `docs/specs/API.md` (narrative only) |
| Redis keys, DTOs | `docs/specs/DATA_MODELS.md` |
| Crypto, threat model | `docs/specs/SECURITY.md` |
| Architecture | `docs/specs/ARCHITECTURE.md` |
| Token / on-chain | `docs/specs/TOKENOMICS.md` |
| Telegram integration | `docs/specs/TELEGRAM.md` |

### API contract drift check

CI runs `./gradlew :backend:checkApiContracts` after every backend build.
It fails when committed `openapi.yaml` or `stomp-routes.json` do not match
a fresh export from the current code.

Before opening a PR that touches REST controllers or STOMP handlers:

```bash
# From repository root
./gradlew exportOpenApi exportStompRoutes
git diff docs/specs/openapi.yaml docs/specs/stomp-routes.json
# Commit any changes together with your code
./gradlew :backend:checkApiContracts
```

Narrative-only API changes (handshake flow, rate-limit table, error semantics)
belong in slim `API.md` — do not duplicate REST paths or inbound destination
lists there; those live in the generated artifacts above.

## Internationalization

All user-visible strings go through i18n. See [`docs/specs/I18N.md`](docs/specs/I18N.md)
for frontend (`react-i18next`) and backend/bot (`MessageSource`) conventions.

## Pull requests

1. Fork and branch from `master`.
2. Keep commits focused; use conventional scopes (`feat(backend): …`,
   `fix(frontend): …`, `docs(specs): …`).
3. Ensure the build matrix above is green.
4. Do not force-push to `master`.
5. **AGPL-3.0** applies — network deployments of modified versions must offer
   corresponding source to users (see [LICENSE](LICENSE)).

## Documentation index

| Spec | Topic |
|------|-------|
| [API.md](docs/specs/API.md) | REST and STOMP |
| [ARCHITECTURE.md](docs/specs/ARCHITECTURE.md) | System design |
| [BAND_KEY_EXCHANGE.md](docs/specs/BAND_KEY_EXCHANGE.md) | In-band ECDH |
| [DATA_MODELS.md](docs/specs/DATA_MODELS.md) | Redis and DTOs |
| [GROUP_KEY_PROTOCOL.md](docs/specs/GROUP_KEY_PROTOCOL.md) | Group E2EE |
| [I18N.md](docs/specs/I18N.md) | Localization |
| [SECURITY.md](docs/specs/SECURITY.md) | Threat model |
| [TELEGRAM.md](docs/specs/TELEGRAM.md) | Mini App and bot |
| [TOKENOMICS.md](docs/specs/TOKENOMICS.md) | BURN token |

Questions about roadmap or priorities — open a GitHub issue.
