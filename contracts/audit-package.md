# BURN Token — External Audit Package

> Prepared for external smart contract audit.  
> Date: 2026-07-16 (updated IMP-TOKSIM-03).

---

## Mainnet stop condition

**Mainnet deployment of BURN contracts is forbidden until this external audit completes**
and all P0/P1 findings are resolved or explicitly accepted by the project owner.

---

## 1. Contract inventory

Production `.tact` sources under `contracts/`:

| File | Contract / module | Purpose |
|------|-------------------|---------|
| `jetton/burn-jetton-master.tact` | **BurnJettonMaster** | TEP-74 jetton master: mint/burn, fixed 1% burn-on-transfer, CloseMint, admin revoke |
| `jetton/burn-jetton-wallet.tact` | **BurnJettonWallet** | Per-holder wallet: transfers with hardcoded 1% burn to master |

**Deploy topology (target, post IMP-TOKSIM-08):**

```
BurnJettonMaster ──► JettonWallet (per user)
```

Mint split: **7 BURN** developer holder, **993 BURN** LP provision holder → CloseMint → admin revoked.

> **Note:** Staking, governance, treasury, vesting, and BurnPlaceholder contracts were removed in IMP-TOKSIM-03. Their sources remain in git history for reference only.

---

## 2. Threat model and trust assumptions

Synced with [SECURITY.md](../docs/specs/SECURITY.md) and [TOKENOMICS.md](../docs/specs/TOKENOMICS.md) (mem-token simplification in progress — IMP-TOKSIM-07).

### Design invariants

| Invariant | Enforcement |
|-----------|-------------|
| **Zero mint after cap** | `CloseMint` sets `mintable = false` irreversibly |
| **Fixed 1% burn** | Hardcoded in wallet — no admin fee params |
| **No upgradeability** | Contracts are immutable post-deploy — no proxy path |
| **Ephemeral off-chain** | Chat layer (BurnedChats) is separate; audit scope is on-chain BURN only |

### Trust boundaries

| Actor | Trust level | Notes |
|-------|-------------|-------|
| **Admin EOA (deploy window)** | Temporary | Mints 7/993, then CloseMint + admin revoke (IMP-TOKSIM-08) |
| **External users** | Untrusted | All value-moving paths gated by TEP-74 semantics |

---

## 3. Build, test, and CI

### Prerequisites

- Node.js ≥ 18 (CI uses 22)
- Working directory: `contracts/`

### Commands

```bash
cd contracts
npm ci
npm run build          # blueprint build --all (BurnJettonMaster only)
npm test               # jest --verbose (sandbox integration tests)
npm run test:coverage  # c8, lines ≥80% on wrappers/helpers
npm run lint           # eslint
npm run misti          # static analysis on tact.config.json
npm run format:check   # prettier
```

### Deploy / verify scripts

```bash
npm run deploy:burn:testnet   # jetton-only bootstrap
npm run verify:deployment     # on-chain getter checks vs manifest
```

### CI pipeline

GitHub Actions: [`.github/workflows/contracts.yml`](../.github/workflows/contracts.yml)

On PR/push touching `contracts/**`:

1. `npx blueprint build --all`
2. `npm run test:coverage`
3. `npm run lint`
4. `npm run format:check`

### Test coverage notes

`test:coverage` enforces **≥80% line coverage** on:

- `wrappers/**/*.ts`
- `tests/helpers.ts`

Contract `.tact` logic is exercised via sandbox specs. Key suites:

| Spec file | Coverage focus |
|-----------|----------------|
| `tests/jetton.spec.ts` | Mint/burn/close-mint/admin |
| `tests/jetton-tep74.spec.ts`, `jetton-tep89.spec.ts` | Jetton standard compliance |
| `tests/jetton-gas-profile.spec.ts` | Burn-only gas anchors |
| `tests/estimateJettonTransferTon.spec.ts` | Client attach estimator |

---

## 4. Audit scope suggestions

Priority areas for external review:

1. **Economic invariants** — fixed 1% burn, supply cap, rounding at low amounts
2. **Jetton edge cases** — TEP-74 excess routing, close-mint irreversibility, admin revoke
3. **Access control completeness** — all privileged messages enumerated
4. **Front-running / MEV** — TON-specific ordering (informational)

Out of scope: BurnedChats E2EE chat layer, backend Redis, Telegram bot, removed staking/governance stack.

---

## Appendix — Spec references

| Document | Path |
|----------|------|
| Tokenomics | [docs/specs/TOKENOMICS.md](../docs/specs/TOKENOMICS.md) |
| Security | [docs/specs/SECURITY.md](../docs/specs/SECURITY.md) |
