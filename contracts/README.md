# contracts — BURN smart contracts (TON)

Smart contracts for the BURN mem-token jetton (master + wallet) live here, isolated from backend and frontend. Stack: [Blueprint](https://github.com/ton-org/blueprint), Sandbox tests, [Tact](https://tact-lang.org/).

## Prerequisites

- Node.js **18+**
- npm

## Setup

```bash
cd contracts
cp .env.example .env.testnet
# Set WALLET_MNEMONIC + WALLET_VERSION (or MNEMONIC_TESTNET) and TONCENTER_API_KEY_TESTNET.
# Never commit .env, .env.testnet, or mainnet secrets.
npm install
```

## Build

Compile the single Tact project (`BurnJettonMaster` — see `tact.config.json`):

```bash
npm run build
# or: npx blueprint build --all
```

Artifacts go to `build/` (gitignored).

## Test

Sandbox (in-memory TVM) tests via Jest (`npm test`). `npx blueprint test` is a thin wrapper that forwards to `npm test` (do not set `npm test` to `blueprint test` — it would recurse).

```bash
npm test
npm run test:coverage
# equivalent: npx blueprint test
```

## Lint & format

```bash
npm run lint
npm run misti
npm run format        # Prettier write
npm run format:check # Prettier CI check
```

TypeScript targets ES2022 with `strict` mode (hand-written TS). Generated bindings under `build/` may not satisfy `noUnusedLocals`; those checks are disabled project-wide so `jest` + `ts-jest` accept Tact output.

## Deploy scripts

Requires env file (see `.env.example`) and a funded wallet mnemonic.

All npm deploy/verify scripts **run `npm run build` first** so TypeScript wrappers always import fresh Tact artifacts from `build/` (gitignored).

```bash
npm run deploy:burn:testnet   # jetton-only deploy — WALLET_MNEMONIC in .env.testnet
npm run deploy:burn:mainnet   # mainnet — use .env.mainnet, never commit secrets
npm run verify:deployment     # post-deploy checks (testnet)
npm run verify:burn:testnet   # live transfer smoke on testnet
npm run verify                # verifier instructions + env check
```

CloseMint, LP provision, and admin revocation are documented in IMP-TOKSIM-08 runbook (not part of the minimal bootstrap yet).

### Manual `blueprint run` (no npm wrapper)

`blueprint run` does **not** compile contracts. After changing `.tact` sources, on a fresh clone, or whenever `build/` is missing or stale, run **`npm run build`** before `npx blueprint run <ScriptName> …`.

```bash
npm run build   # required if .tact changed or build/ absent
npx blueprint run
```

## CI

Pull requests run `.github/workflows/contracts.yml`: `npm ci`, `npx blueprint build --all`, `npm run test:coverage`, `npm run lint`, `npm run format:check`.

## Layout

| Path        | Purpose                              |
| ----------- | ------------------------------------ |
| `jetton/`   | BurnJettonMaster + BurnJettonWallet  |
| `scripts/`  | Deploy, verify helpers               |
| `tests/`    | Sandbox specs                        |
| `wrappers/` | Hand-written TS helpers on `build/`    |

See also `docs/specs/TOKENOMICS.md`.

## Changelog

- **2026-07-16 (IMP-TOKSIM-03):** Removed staking, governance, treasury, vesting, vp-math, and BurnPlaceholder trees. Single-contract repo (`BurnJettonMaster` only). Legacy full-stack sources remain in git history.
