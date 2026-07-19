# contracts — BURN smart contracts (TON)

Smart contracts for the BURN token stack (Jetton, Staking, Governance, Treasury, Vesting) live here, isolated from backend and frontend. Stack: [Blueprint](https://github.com/ton-org/blueprint), Sandbox tests, [Tact](https://tact-lang.org/) (FunC/toolchain via Blueprint where needed).

## Prerequisites

- Node.js **18+**
- npm

## Bootstrap (already done in-repo)

From repository root, non-interactive scaffold:

```bash
npx create-ton@latest contracts --type tact-empty --contractName BurnPlaceholder
```

On some setups `npm create ton@latest -- contracts ...` does not forward flags; use the `npx create-ton@latest` form above.

## Setup

```bash
cd contracts
cp .env.example .env.testnet
# Set WALLET_MNEMONIC + WALLET_VERSION (or MNEMONIC_TESTNET) and TONCENTER_API_KEY_TESTNET.
# Never commit .env, .env.testnet, or mainnet secrets.
npm install
```

## Build

Compile Tact projects (see `tact.config.json`):

```bash
npm run build
# or: npx blueprint build
# Non-interactive single contract: npx blueprint build BurnPlaceholder
```

Artifacts go to `build/` (gitignored).

## Test

Sandbox (in-memory TVM) tests via Jest (`npm test`). `npx blueprint test` is a thin wrapper that forwards to `npm test` (do not set `npm test` to `blueprint test` — it would recurse).

```bash
npm test
# equivalent: npx blueprint test
```

## Lint & format

```bash
npm run lint
npm run format        # Prettier write
npm run format:check # Prettier CI check
```

TypeScript targets ES2022 with `strict` mode (hand-written TS). Generated bindings under `build/` may not satisfy `noUnusedLocals`; those checks are disabled project-wide so `jest` + `ts-jest` accept Tact output.

## Deploy scripts

Requires env file (see `.env.example`) and a funded wallet mnemonic.

All npm deploy/verify/sync/mint scripts **run `npm run build` first** so TypeScript
wrappers always import fresh Tact artifacts from `build/` (gitignored). You do not
need a separate manual build before `npm run deploy:burn:testnet` and siblings.

```bash
npm run deploy:burn:testnet   # full BURN stack — WALLET_MNEMONIC in .env.testnet
npm run deploy:burn:mainnet   # mainnet — use .env.mainnet, never commit secrets
npm run verify:deployment     # alias → fs-ops-deployment-fingerprint (see Live testnet scenarios)
npm run verify:fee-split:testnet  # alias → fs-jetton-fee-split (0.5/0.3/0.2)
npm run testnet:scenarios     # full-stack live scenario CLI
npm run deploy:testnet        # legacy BurnPlaceholder only (interactive wallet picker)
npm run deploy:mainnet        # legacy BurnPlaceholder only
npm run verify                # verifier instructions + env check
npm run mint                  # placeholder until Jetton (P5-1-1-2)
```

### Manual `blueprint run` (no npm wrapper)

`blueprint run` does **not** compile contracts. Scripts invoked directly — e.g.
`deployVesting`, `deployVestingDeveloper`, `deployBurnPlaceholder`,
`deployVestingStakingAllocation` — import wrappers from `build/`. After changing
`.tact` sources, on a fresh clone, or whenever `build/` is missing or stale, run
**`npm run build`** before `npx blueprint run <ScriptName> …`, or deploy will fail
with TypeScript errors (`TS2305`, `Cannot find module`).

Interactive runner (pick any script under `scripts/`):

```bash
npm run build   # required if .tact changed or build/ absent
npx blueprint run
```

## Live testnet scenarios (`testnet:scenarios`)

Opt-in full-stack live harness under `testnet-scenarios/` (fee **0.5 / 0.3 / 0.2**, staking, treasury, governance, vesting). Not run in CI. Requires `.env.testnet` + funded mnemonic. Private ops runbook: `BurnedChats-dev` → `docs/improvements/full-stack-testnet-scenarios/RUNBOOK.md`.

```bash
npm run testnet:scenarios -- --list
npm run testnet:scenarios -- --scenario fs-jetton-fee-split
npm run testnet:scenarios -- --tag staking
npm run testnet:scenarios -- --all              # never includes destructive
npm run testnet:scenarios -- --failed-only
npm run testnet:scenarios -- --force
npm run testnet:scenarios -- --manifest lab --tag destructive
```

| Flag | Notes |
|------|--------|
| `--list` / `--scenario` / `--tag` / `--all` / `--failed-only` / `--force` | Filters + skip control |
| `--manifest shared\|lab` | `deployments/testnet.json` (default) vs `testnet-lab.json` |
| Destructive | **Excluded from `--all`**. Use `--tag destructive` or `--scenario <id>` on **lab** only |

### Thin `verify:*` aliases

Muscle-memory wrappers (logic lives in scenarios; Q6=A):

| Script | Scenario |
|--------|----------|
| `npm run verify:deployment` | `fs-ops-deployment-fingerprint` |
| `npm run verify:fee-split:testnet` | `fs-jetton-fee-split` |

### Lab vs shared (hard rule)

| Tip | File | Mini App / `syncAppConfigs` |
|-----|------|-------------------------------|
| **Shared** | `deployments/testnet.json` | **Always** — backend/frontend testnet env |
| **Lab** | `deployments/testnet-lab.json` | **Never** — destructive + short-timer gov only |

Do **not** point the Mini App at lab. Details: [`deployments/README.md`](deployments/README.md).

## CI

Pull requests run `.github/workflows/contracts.yml`: `npm ci`, `npm run build`, `npm test`, `npm run lint`, `npm run format:check`.

## Layout

| Path                   | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `contracts/`           | Tact sources (placeholder contract today)      |
| `jetton/` … `vesting/` | Future modules (placeholders)                  |
| `scripts/`             | Deploy, mint, verify helpers                   |
| `tests/`               | Sandbox specs                                  |
| `wrappers/`            | Extra wrappers if not generated under `build/` |

See also `docs/specs/TOKENOMICS.md`.
