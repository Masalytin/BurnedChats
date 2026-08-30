# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Settings theme picker with Ember, Bone, Nocturne, and Telegram live previews.
- Ember, Bone, and Nocturne appearance palettes; stored `dark` theme migrates to Ember, and new installs default to Ember.

### Fixed

- Telegram theme mode derives elevated surfaces and borders from the client palette and falls back to Ember when contrast is unreadable.

## [0.1.7] - 2026-08-30

### Added

- First-run language picker after sign-in when no saved preference exists (native names, one tap to continue).

## [0.1.6] - 2026-08-30

### Fixed

- Wallet web session can link Telegram without a toast storm: Mini App absorbs a
  wallet-less Telegram stub, keeps the link challenge until success, completes
  `lt_` before WebSocket connect, and opens the bot URL in a new tab on web.

## [0.1.5] - 2026-08-29

### Fixed

- Staking tier cards (Flexible / Silver / Gold / Diamond) now load without a connected wallet; only personal positions stay empty until connect.

## [0.1.4] - 2026-08-29

### Fixed

- Home tour no longer covers the Create Room control: the tooltip sits above a mid-page spotlight and shrinks instead of sliding over the hole.

## [0.1.3] - 2026-08-29

### Removed

- First-run "Quick check" quiz after the briefing; Got it now goes straight to the Home tour.

## [0.1.2] - 2026-08-29

### Fixed

- Home onboarding tour keeps the hint and Next button inside the visible viewport (flip/clamp) so a blocked page scroll cannot trap the user.

## [0.1.1] - 2026-08-29

### Added

- First-run briefing continues to a two-question quiz (keys stay in RAM; burn destroys chats with no recovery) before dismiss; Skip still marks the briefing seen.
- Home onboarding tour: three spotlight steps (search, Create Room, My QR) after the first-run briefing.
- First visit to Create Room auto-opens the existing room-creation help sheet once; Back/Escape close only the sheet.
- Settings can replay onboarding: confirm resets local tour progress and returns to Home for the briefing and tour again.

## [0.1.0] - 2026-08-24

Initial open-source publication. The project is pre-1.0: the public API may change without notice.

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

[Unreleased]: https://github.com/Masalytin/BurnedChats/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/Masalytin/BurnedChats/releases/tag/v0.1.7
[0.1.6]: https://github.com/Masalytin/BurnedChats/releases/tag/v0.1.6
[0.1.5]: https://github.com/Masalytin/BurnedChats/releases/tag/v0.1.5
[0.1.4]: https://github.com/Masalytin/BurnedChats/releases/tag/v0.1.4
[0.1.3]: https://github.com/Masalytin/BurnedChats/releases/tag/v0.1.3
[0.1.2]: https://github.com/Masalytin/BurnedChats/releases/tag/v0.1.2
[0.1.1]: https://github.com/Masalytin/BurnedChats/releases/tag/v0.1.1
[0.1.0]: https://github.com/Masalytin/BurnedChats/commits/main
