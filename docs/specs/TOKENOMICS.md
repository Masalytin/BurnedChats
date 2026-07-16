# BURN Token — Tokenomics

> Simple deflationary meme jetton for the Burned Chats ecosystem. **Testnet only** — not a
> launched product or investment offer. See [README.md](../../README.md#project-status).

> **Terminology (as of June 2026):** **TON** — blockchain and ecosystem (The Open Network,
> TON Connect, TON RPC). **GRAM** — native network coin for gas and fees (formerly Toncoin,
> ticker `TON`; no token migration).

## Table of Contents

- [Legal Disclaimer](#legal-disclaimer)
- [Token Overview](#token-overview)
- [Key Parameters](#key-parameters)
- [Burn Mechanism](#burn-mechanism)
- [Supply and Distribution](#supply-and-distribution)
- [Deployment Finalization](#deployment-finalization)
- [DEX and Tax-Token Behavior](#dex-and-tax-token-behavior)
- [Technical Architecture](#technical-architecture)
- [Smart Contracts](#smart-contracts)
- [BurnedChats Integration](#burnedchats-integration)
- [Risks and Mitigation](#risks-and-mitigation)
- [FAQ](#faq)

---

## Legal Disclaimer

> **BURN is a meme token with no stated monetary value, investment promise, expected return,
> governance rights, staking yield, treasury allocation, airdrop, or product utility beyond
> optional wallet display in the Burned Chats Mini App.** This document describes on-chain
> technical mechanics only. It is **not** an offer of securities, financial instruments, or
> investment advice. Deployments on TON testnet are experimental engineering artifacts.
> Any mainnet publication requires independent legal review by qualified counsel. **This text
> is not legal advice.**

---

## Token Overview

### Philosophy

The name **BURN** aligns with the Burned Chats brand: messages and data are ephemeral; the
jetton applies a small automatic burn on every transfer. The token is **not** required to use
the messenger and does not gate chat features.

### Why TON?

| Advantage | Description |
|-----------|-------------|
| **Native integration** | TON is built into Telegram via @wallet |
| **Instant transactions** | ~5 seconds to confirm |
| **Low fees** | ~$0.01–0.05 per transaction (gas paid in native coin **GRAM**) |
| **TON Connect** | Seamless authorization in Mini App |
| **Jetton standard** | Proven token standard (TEP-74) |
| **Ecosystem** | DeDust, STON.fi, Tonkeeper |

---

## Key Parameters

```
┌─────────────────────────────────────────────────────────────────┐
│                      BURN TOKEN SPECS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Name:               BURN                                       │
│   Blockchain:         TON (The Open Network)                     │
│   Native coin:        GRAM¹ (gas, network fees)                  │
│   Standard:           Jetton (TEP-74)                             │
│   Decimals:           9                                          │
│                                                                  │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                                                  │
│   Fixed maximum supply:    1,000 BURN (after CloseMint)          │
│   Minimum unit:            0.000000001 BURN (1 nano)             │
│                                                                  │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                                                  │
│   Transfer burn fee:       1.0% (hardcoded, entire fee burned)   │
│   Staking / Treasury:      removed (no fee split)                │
│   Excluded addresses:      none (burn on every transfer)         │
│   Dynamic burn / floor:    removed                               │
│                                                                  │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                                                  │
│   Developer allocation:    7 BURN (0.7%)                         │
│   Liquidity provision:     993 BURN (99.3%) → DEX, LP burned     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

¹ **GRAM** — official post-rebrand ticker of the TON native coin (formerly Toncoin, ticker
`TON`). The blockchain and ecosystem products are still called TON.

---

## Burn Mechanism

On every jetton transfer (P2P, contract, or DEX router path):

```
Sender: 100 BURN
    │
    ├── 1.0% → Burned forever 🔥          = 1.0 BURN
    │
    └── Recipient receives:              = 99.0 BURN
```

- **Fee is hardcoded** at 1% (`burnBps = 100`); there is no admin-adjustable fee schedule.
- **The full 1% is burned** — no staking pool, treasury, or protocol revenue leg.
- **Rounding:** for amounts where `amount * 100 / 10000` truncates to zero, burn is zero and
  the full amount is delivered (standard nano-token rounding).
- **Supply decreases** on each burn via `JettonBurnNotification` on the master contract.

There is no supply floor rule: the token can theoretically burn toward zero supply.

---

## Supply and Distribution

Total supply at genesis: **1,000 BURN**, minted in two allocations:

| Recipient | Amount | % | Notes |
|-----------|--------|---|-------|
| **Developer** | 7 | 0.7% | Single mint to deployer wallet; no vesting contract |
| **Liquidity** | 993 | 99.3% | Minted for DEX liquidity provision |

**Liquidity procedure (testnet runbook):**

1. Mint 993 BURN to a liquidity wallet.
2. Add liquidity on a DEX (e.g. STON.fi / DeDust) paired with GRAM.
3. **Burn all received LP tokens** to a burn address (irreversible liquidity lock).
4. Expect ~1% burn on the liquidity deposit transfer (~9.93 BURN burned on entry) — this is
   normal tax-token behavior.

No community airdrop, staking rewards pool, ecosystem reserve, treasury allocation, or BCID
fee semantics apply to this token design.

---

## Deployment Finalization

After minting and liquidity steps:

| Step | Effect |
|------|--------|
| **`CloseMint`** | Irreversible; no further minting; fixed supply cap enforced |
| **Admin revocation** | `ChangeOwner` to null/burn address; no further `JettonUpdateContent` or admin ops |

After these steps the jetton master and wallets are **immutable** on-chain. Verification scripts
should assert `mintable = false`, expected `totalSupply`, and revoked admin.

---

## DEX and Tax-Token Behavior

BURN is a **fee-on-transfer (tax) token**. DEX aggregators and pools may show warnings such as
**"tax token"** because the pool receives ~1% less than the quoted input amount.

| Aspect | Behavior |
|--------|----------|
| Pool compatibility | STON.fi supports tax tokens up to 10% fee; 1% is within supported range |
| Quote vs received | ~1% discrepancy between quoted and credited amount is expected |
| Intermediate routing | Token may be unsuitable as a hop in multi-hop routes (acceptable for meme scope) |
| Excluded DEX routers | **Not used** — excluding routers would disable burn on trading volume and require a permanent admin |

Users swapping on DEX should expect the UI warning and slightly lower effective amounts.

---

## Technical Architecture

### Overview diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                 BURNED CHATS + BURN TOKEN                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐         ┌─────────────┐        ┌─────────────┐ │
│  │  Frontend   │◄───────►│   Backend   │◄──────►│    Redis    │ │
│  │ (Mini App)  │   WSS   │ (Spring)    │        │             │ │
│  └──────┬──────┘         └──────┬──────┘        └─────────────┘ │
│         │                       │                                │
│         │ TON Connect           │ Read-only balance RPC          │
│         ▼                       ▼                                │
│  ┌─────────────┐         ┌─────────────┐                        │
│  │  TON Wallet │◄───────►│  TON RPC    │                        │
│  │ (@wallet)   │         │  (toncenter)│                        │
│  └──────┬──────┘         └─────────────┘                        │
│         │                       ▲                                │
│         ▼                       │                                │
│  ┌─────────────────────────────┴───────────────────────────────┐│
│  │                      TON BLOCKCHAIN                          ││
│  │  ┌─────────────────────────────────────────────────────┐    ││
│  │  │ BURN Jetton Master + per-user Jetton Wallets         │    ││
│  │  └─────────────────────────────────────────────────────┘    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Frontend (`frontend/src/ton/`)

- `connector.ts` — TON Connect
- `burnToken.ts` — balance, send, fee display ("1% will burn")
- `wallet.ts` — wallet helpers

Staking and governance UI modules were removed in token-simplification (IMP-TOKSIM-05).

### Backend (`backend/.../ton/`)

- `TonService` — TON RPC client
- `JettonService` — BURN balance and jetton-wallet address resolution
- `TonProofVerifier` — wallet auth (independent of tokenomics)

`StakingVerifier` and `GovernanceVerifier` were removed in IMP-TOKSIM-04.

---

## Smart Contracts

```
contracts/
├── tact/
│   ├── burn-jetton-master.tact    # Jetton master (TEP-74)
│   └── burn-jetton-wallet.tact    # Wallet with hardcoded 1% burn
├── scripts/
│   ├── deploy/                    # Bootstrap, mint, CloseMint, verify
│   └── verify-burn-testnet.ts
└── tests/
    └── jetton-*.spec.ts
```

Legacy staking, governance, treasury, and vesting trees were removed in IMP-TOKSIM-03;
sources remain in git history for reference only.

---

## BurnedChats Integration

| Layer | Role |
|-------|------|
| **TON Connect** | Wallet authentication (`ton_proof`) — not tied to BURN holdings |
| **Wallet UI** | Optional: show BURN balance and send with 1% burn preview |
| **Backend REST** | `GET /api/wallet/burn-balance`, `GET /api/wallet/jetton-wallet` (read-only RPC cache) |

No staking tiers, governance voting, treasury spend flows, or product gating by token balance.

---

## Risks and Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Smart contract bug** | Medium | Critical | Tests, coverage gate, planned external audit before any mainnet |
| **Low liquidity** | Medium | High | 99.3% supply directed to LP; LP tokens burned |
| **DEX tax-token friction** | Medium | Medium | Documented; 1% within STON.fi tax-token support |
| **Regulatory perception** | Medium | High | Meme-token disclaimer; no yield/governance/treasury promises |
| **Whale concentration** | Medium | Medium | Low total supply (1000 BURN) |
| **TON network issues** | Low | High | Monitoring, RPC fallbacks |

---

## FAQ

### Why only 1,000 tokens?

Low supply keeps the experiment understandable and makes large-scale accumulation costly in
relative terms. It is a design choice for a meme token, not an investment thesis.

### Why 0.7% developer allocation?

Minimal dev slice (7 BURN) with no vesting contract — aligns deployer with a fixed-supply,
immutable contract after `CloseMint` and admin revocation.

### Can the burn rate or supply change?

**No**, after deployment finalization (`CloseMint` + admin revocation). The 1% burn is
hardcoded in the wallet contract; there is no governance or timelock path to alter parameters.

### Does holding BURN unlock chat features?

**No.** Burned Chats E2EE features do not depend on token ownership.

### What happened to the previous full tokenomics design?

An earlier testnet stack included staking, governance, treasury, vesting, and multi-leg fee
splits. That design was superseded by token-simplification (2026-07); see git history and
[ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — technical architecture
- [SECURITY.md](./SECURITY.md) — system security
- [API.md](./API.md) — API specification
