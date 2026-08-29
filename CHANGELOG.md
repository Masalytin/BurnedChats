# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Initial open-source publication. The project is pre-1.0: no versioned releases
exist yet, and the public API may change without notice.

### Added

- Home onboarding tour: three spotlight steps (search, Create Room, My QR) after the first-run briefing.

### Changed

- Default branch renamed from `master` to `main`.

### Current state at publication

- **Chat core** — 1:1 E2E-encrypted chats (ECDH P-256 + AES-256-GCM, client-side
  via Web Crypto API), in-band key exchange with visual fingerprint verification,
  self-destructing messages backed by Redis TTL.
- **Rooms** — password-protected group chats with zero-knowledge password
  verification and group key rotation on membership changes.
- **Media** — chunked AES-GCM encryption for files and thumbnails.
- **Telegram integration** — Mini App frontend, bot notifications without
  message content, initData-based authentication.
- **TON integration** — TON Connect wallet auth; full-stack BURN jetton
  (TEP-74 with fee split), staking, governance, treasury, and vesting contracts
  (Tact), deployed to TON testnet.
- **Operations** — Docker Compose (dev / prod / SSL), Nginx TLS, Prometheus
  metrics, CI for backend / frontend / contracts plus audit gates (Misti,
  npm audit).
- **Documentation** — specifications under `docs/specs/` (architecture, API,
  security threat model, data models, key-exchange protocols, tokenomics, i18n).

[Unreleased]: https://github.com/Masalytin/BurnedChats/commits/main
