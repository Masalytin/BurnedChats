# BURN Token — External Audit Package

> Prepared for external smart contract audit.  
> Date: 2026-06-28.

---

## Mainnet stop condition

**Mainnet deployment of BURN contracts is forbidden until this external audit completes**
and all P0/P1 findings are resolved or explicitly accepted by the project owner.

Prerequisite engineering work on `master` is complete: functional blockers closed,
relay/cashback paths verified, and this audit package assembled.

---

## 1. Contract inventory

All production `.tact` sources under `contracts/`:

| File | Contract / module | Purpose |
|------|-------------------|---------|
| `jetton/burn-jetton-master.tact` | **BurnJettonMaster** | TEP-74 jetton master: mint/burn, 1% fee split, dynamic burn, excluded list, admin/timelock gates |
| `jetton/burn-jetton-wallet.tact` | **BurnJettonWallet** | Per-holder wallet: transfers, fee path, live excluded resolve, message definitions |
| `treasury/treasury.tact` | **Treasury** | On-chain treasury: timelock-gated BURN spends, accounting |
| `treasury/treasury-messages.tact` | — | Shared `TreasurySpend` message layout (must mirror `treasury.tact`) |
| `staking/staking-master.tact` | **StakingMaster** | Staking orchestrator: positions, emission ticks, governance VP relay |
| `staking/staking-pool.tact` | **StakingPool** | Reward pool wallet logic: accrual, pay rewards/unstake |
| `staking/staking-lock.tact` | **StakingLock** | Tier lock durations / multipliers (timelock-gated) |
| `staking/staking-messages.tact` | — | Staking inter-contract messages |
| `governance/governor.tact` | **Governor** | Proposal factory, vote relay, execution coordinator |
| `governance/proposal.tact` | **Proposal** | Per-proposal child: voting, finalize, timelock queue, treasury/param actions |
| `governance/timelock.tact` | **Timelock** | Delay queue + target execution (governor-gated) |
| `governance/governance-messages.tact` | — | Governance opcodes |
| `governance/governance-payload.tact` | — | Proposal payload encoding |
| `governance/governance-types.tact` | — | Shared types (proposal classes, config) |
| `vesting/vesting.tact` | **Vesting** | Linear vesting schedules (×4 instances at deploy) |
| `vp-math.tact` | — | Voting power math (imported by governance) |
| `contracts/burn_placeholder.tact` | BurnPlaceholder | **Out of mainnet scope** — early placeholder only |

**Deploy topology (testnet):**

```
BurnJettonMaster ──► JettonWallet (per user)
Treasury ──► treasuryJettonWallet
StakingPool ◄──► StakingMaster ◄──► Governor ◄──► Timelock
                      ▲                │
                      │                └──► Proposal (child per id)
                 StakingLock
Vesting ×4
```

---

## 2. Threat model and trust assumptions

Synced with [SECURITY.md](../docs/specs/SECURITY.md) (Governance on-chain section) and [TOKENOMICS.md](../docs/specs/TOKENOMICS.md).

### Design invariants

| Invariant | Enforcement |
|-----------|-------------|
| **Zero mint after cap** | `CloseMint` sets `mintable = false` irreversibly (admin = Timelock post-bootstrap) |
| **Treasury spends only via governance** | `TreasurySpend` accepts only `timelock` sender; queued through Gov → Proposal → Timelock |
| **Fee params only via timelock** | `BurnJettonMaster.timelock` gates fee/exclusion/dynamic-burn after bootstrap |
| **No upgradeability** | Contracts are immutable post-deploy — no proxy/admin upgrade path |
| **Ephemeral off-chain** | Chat layer (BurnedChats) is separate; audit scope is on-chain BURN only |

### Trust boundaries

| Actor | Trust level | Notes |
|-------|-------------|-------|
| **Timelock contract** | High — holds spend/fee/revoke authority | `admin` + `timelock` on JettonMaster after bootstrap |
| **Governor contract** | Medium — coordinates proposals/votes | VP from staking snapshot |
| **Deployer EOA** | **Residual trust** | `Timelock.governor = deployer` — can replay `TimelockQueue` from Governor during bootstrap. No direct fee/treasury access post-bootstrap |
| **Staking bootstrapOwner** | **Residual trust** | `FundEmissionReserve` gated by deployer until migrated to governance |
| **External users** | Untrusted | All value-moving paths gated |

### Attack classes reviewed (relay audit)

| Class | Description | Status |
|-------|-------------|:------:|
| **RC-A** | Cashback-loop between `receive()` handlers | Fixed/verified — see Appendix A |
| **RC-B** | Insufficient gas propagation multi-hop | Fixed — TreasurySpend relay gas budget |
| **RC-C** | Frontend `attachedTon` / `responseAddress` mismatch | Verified — frontend attach parity tests |

Reference: relay audit matrix in repository history (cashback-loop class RC-A).

---

## 3. Authority map (post-bootstrap, mainnet-target)

After `contracts/scripts/deploy/bootstrap.ts` (timelock-gated bootstrap):

| Contract | Field | Points to | Gated operations |
|----------|-------|-----------|------------------|
| BurnJettonMaster | `admin` | Timelock | Mint, ChangeOwner, CloseMint |
| BurnJettonMaster | `timelock` | Timelock | SetFeeDestinations, Add/RemoveExcluded, dynamic burn, SetTimelock (one-shot consumed) |
| StakingLock | `timelock` | Timelock | Tier config, multipliers, shares |
| Treasury | `timelock` | Timelock | TreasurySpend |
| Vesting ×4 | `timelock` | Timelock | Revoke |
| Governor | `timelock` | Timelock | Execute callbacks |
| Timelock | `governor` | **Deployer EOA** | Queue replay only |
| StakingMaster | `governorAddr` | Governor | Vote relay, param proposals |

Bootstrap wiring: Timelock gates admin operations on master, staking, treasury, vesting, and governor.

**Known limitation:** no EOA controls fee/tier/exclusion/spend/revoke after bootstrap. Remaining centralization: deployer as Timelock governor.

---

## 4. Build, test, and CI

### Prerequisites

- Node.js ≥ 18 (CI uses 22)
- Working directory: `contracts/`

### Commands

```bash
cd contracts
npm ci
npm run build          # blueprint build --all (compiles all .tact)
npm test               # jest --verbose (sandbox integration tests)
npm run test:coverage  # c8, lines ≥80% on wrappers/helpers
npm run lint           # eslint
npm run format:check   # prettier
```

### Deploy / verify scripts

```bash
npm run deploy:testnet       # testnet deploy (blueprint)
npm run verify:deployment      # on-chain getter checks vs manifest
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
- `tests/staking-helpers.ts`

Contract `.tact` logic is exercised via sandbox specs, not directly measured by c8. Key suites:

| Spec file | Coverage focus |
|-----------|----------------|
| `tests/governance.spec.ts` | Full governance + treasury spend + relay clean |
| `tests/staking.spec.ts` | Stake/unstake/claim/emission |
| `tests/staking-solvency.spec.ts` | Emission funding, solvency, PayUnstake |
| `tests/jetton.spec.ts` | Mint/burn/fees/excluded/close-mint |
| `tests/vesting.spec.ts` | Vesting claim/revoke |
| `tests/staking-fee-accrual.spec.ts` | Pool↔Master fee accrual |
| `tests/jetton-tep74.spec.ts`, `jetton-tep89.spec.ts` | Jetton standard compliance |

Frontend attach parity (RC-C): `frontend/tests/ton/frontendAttachParity.test.ts`.

---

## 5. Testnet deployment addresses

Source: [`deployments/testnet.json`](deployments/testnet.json) (deployed 2026-06-28).

| Key | Address |
|-----|---------|
| jettonMaster | `kQD-ZhhzrzyI3k4WarDMPhxAJTdc6MStCZYyCyHHw7Jx-NjD` |
| treasury | `kQCnUzQM-U0cMdChXCaRUy3WSEc5rvnOAEaAbVqHJ-mrNV7P` |
| treasuryJettonWallet | `kQBuOvZMW0jkOZuPmydXPnWWFcT30brMHzqFzt9UH5Xo6W3b` |
| stakingPool | `kQD0Z08_0tB-rT249cyzdYDhQw03IE2XcFAsHhtHRGbuXD6Q` |
| stakingLock | `kQAlGLEoSO7VabHHDfgkF8sWem1dBCmpOIEqR_O0GKAcbSnJ` |
| stakingMaster | `kQCotwKsH0ZAd09msYeJLsEeXzvks_Q6sp8gZj-jE5LgV7M5` |
| governor | `kQB53bI7Y1NdovwTyjox45Lx2opXD6QfuluFTAs4nT0ybC-M` |
| timelock | `kQAV1au0ntabRd_tBJhtEZKZ37KOAPoIAqKYvTSDVRW2jueT` |
| vestingDeveloper | `kQD2BAcU3dMmDQziMyu3MYWYSbaPkw5l0bCPfnHUEg9arnQS` |
| vestingEcosystem | `kQCT6xj5b5loCcCk48pwQpMtQJpwZyDhFRxDJmMoeT4krt2c` |
| vestingReserve | `kQBL9ahUgiHppEcRZ4kyrJ0Voumg48M8BwzmE9Noe8Ve_K-6` |
| vestingStakingAllocation | `kQBXJNQc_yssOLZgPYm7dR_wYD9_plLbMmc9-QOagmcp0ORN` |
| airdropHolder | `kQB8WzqUmqJpvVVdu26-wKMNOLwVR3ZP5fLfBMoPY6joDtax` |
| liquidityHolder | `kQBNxdjqjhQP2OPaZHSRj06NRTd4z6-Trd6BdZ0DX0_9WM4G` |

---

## 6. Closed pre-mainnet blockers (for auditor context)

| Issue | Resolution |
|-------|------------|
| TreasurySpend opcode/schema mismatch | Fixed in contracts + wrappers |
| Bootstrap authority wiring | Timelock-gated admin map (§3) |
| Staking pool solvency | Reward funding model in staking contracts |
| Close mint | CloseMint gated via Timelock |
| TreasurySpend gas budget | Relay gas budget in treasury spend path |

---

## Appendix A — Relay audit matrix

**Summary:** all audited pairs are `fixed` or `verified`; **no open P0 pairs**.

Pre-RELAY incidents (already patched):

| Incident | Class | Status |
|----------|-------|--------|
| Governor ⇄ StakingMaster cashback loop (~349 hops) | RC-A | Fixed |
| Proposal ⇄ StakingMaster cashback loop (~164 hops) | RC-A | Fixed |
| StakingPool ⇄ StakingMaster fee accrual | RC-A | Fixed |
| Excess GRAM to wrong wallet on BURN transfer | RC-C | Fixed |
| TreasurySpend gas not reaching JW | RC-B | Fixed |

---

## Appendix B — «Flow clean» regression tests

Helper: `tests/helpers/cashbackLoopAssert.ts`

```typescript
assertRelayFlowClean(transactions, {
    maxTx: 15,
    partnerPairs: [[addrA, addrB], /* … */],
});
```

Equivalent manual checks in `governance.spec.ts`:

```typescript
expect(transactions.length).toBeLessThan(15);
assertNoOutOfGas(transactions);
expect(countEmptyBodyHopsBetween(transactions, addrA, addrB)).toBe(0);
```

### Specs using `assertRelayFlowClean`

| Spec | Flows covered |
|------|---------------|
| `governance.spec.ts` | Vote relay, queue/execute, treasury spend, finalize |
| `staking.spec.ts` | TierConfigSync Lock↔Master, governance vote via staking |
| `jetton.spec.ts` | Mint, fee sync, plain TON to master |
| `vesting.spec.ts` | VestRelease, revoke |
| `helpers/cashbackLoopAssert.spec.ts` | Helper unit tests |

### Frontend RC-C tests

| File | Coverage |
|------|----------|
| `frontend/tests/ton/frontendAttachParity.test.ts` | stake/unstake/claim/vote attach budgets |
| `frontend/tests/ton/transactionBuilder.test.ts` | message builder shapes |

---

## Appendix C — Spec references

| Document | Path |
|----------|------|
| Tokenomics | [docs/specs/TOKENOMICS.md](../docs/specs/TOKENOMICS.md) |
| Security (incl. governance RC-A pattern) | [docs/specs/SECURITY.md](../docs/specs/SECURITY.md) |
| API (governance vote relay) | [docs/specs/API.md](../docs/specs/API.md) |

---

## Audit scope suggestions

Priority areas for external review:

1. **Economic invariants** — fee split, emission funding model, treasury accounting vs JW delivery
2. **Governance liveness** — Timelock.governor = deployer, Executed vs actual spend
3. **Cashback / gas relay** — partner-aware receive(), SendRemainingValue chains
4. **Jetton edge cases** — excluded resolve, TEP-74 excess routing, close-mint irreversibility
5. **Access control completeness** — all privileged messages enumerated
6. **Front-running / MEV** — TON-specific ordering (informational)

Out of scope: BurnedChats E2EE chat layer, backend Redis, Telegram bot.
