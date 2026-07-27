# BURN Token — Tokenomics

> Deflationary jetton design for the Burned Chats ecosystem. **Testnet only** — not a launched product or investment offer. See [README.md](../../README.md#project-status).

> **Terminology (as of June 2026):** **TON** — blockchain and ecosystem (The Open Network, TON Connect, TON RPC).
> **GRAM** — native network coin for gas and fees (formerly Toncoin, ticker `TON`; no token migration).

## Table of Contents

- [Token Overview](#token-overview)
- [Key Parameters](#key-parameters)
- [Deflationary Mechanism](#deflationary-mechanism)
- [Treasury](#treasury)
- [Emission Distribution](#emission-distribution)
- [Staking](#staking)
- [BCID Fee Semantics](#bcid-fee-semantics)
- [Utility](#utility)
- [Governance](#governance)
- [Technical Architecture](#technical-architecture)
- [Smart Contracts](#smart-contracts)
- [BurnedChats Integration](#burnedchats-integration)
- [Launch Plan](#launch-plan)
- [Risks and Mitigation](#risks-and-mitigation)

---

## Token Overview

### Philosophy

The name and mechanics of the **BURN** token align perfectly with the Burned Chats philosophy:

```
┌─────────────────────────────────────────────────────────────────┐
│                    🔥 BURN = PRIVACY + VALUE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Messages burn        →    Tokens are burned                    │
│   Privacy grows        →    Scarcity increases                   │
│   Trust strengthens    →    Value rises                          │
│                                                                  │
│   "The more active the usage — the more gets burned"             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why TON?

| Advantage | Description |
|--------------|----------|
| **Native integration** | TON is built into Telegram via @wallet |
| **Instant transactions** | ~5 seconds to confirm |
| **Low fees** | ~$0.01–0.05 per transaction (gas paid in native coin **GRAM**) |
| **TON Connect** | Seamless authorization in Mini App |
| **Jetton standard** | Proven token standard |
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
│   Native coin:        GRAM¹ (gas, network fees)                 │
│   Standard:           Jetton (TEP-74)                            │
│   Decimals:           9                                          │
│                                                                  │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                                                  │
│   Maximum supply:          1,000 BURN                            │
│   Minimum unit:            0.000000001 BURN (1 nano)             │
│                                                                  │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                                                  │
│   Burn Rate:               0.5% of each transaction              │
│   Staking Pool Rate:       0.3% of each transaction              │
│   Treasury Rate:           0.2% of each transaction              │
│   Total Fee:               1.0% of each transaction              │
│                                                                  │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                                                  │
│   Developer Allocation:    7 BURN (0.7%)                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

¹ **GRAM** — official post-rebrand ticker of the TON native coin (formerly Toncoin, ticker `TON`). The blockchain and ecosystem products are still called TON.

---

## Deflationary Mechanism

### Base mechanism (1% total fee, 0.5% burn)

On every transaction:

```
Sender: 100 BURN
    │
    ├── 0.5% → Burned forever 🔥          = 0.5 BURN
    ├── 0.3% → Staking Pool 💰           = 0.3 BURN  
    ├── 0.2% → Treasury 🏦               = 0.2 BURN
    │
    └── Recipient receives:              = 99.0 BURN
```

### Dynamic Burn (optional)

```
┌─────────────────────────────────────────┐
│         DYNAMIC BURN MECHANISM          │
├─────────────────────────────────────────┤
│                                         │
│  Base burn:                 0.5%        │
│                                         │
│  Large transaction bonus    +0.25%      │
│  (>10 BURN)                             │
│                                         │
│  High network activity      +0.125%     │
│  bonus                                  │
│  (>100 tx/hour)                         │
│                                         │
│  ─────────────────────────────────      │
│  Maximum burn:              ~0.875%     │
│                                         │
└─────────────────────────────────────────┘
```

### Deflation forecast

Calculation at base burn rate 0.5% and average transaction ~0.1 BURN:

| Scenario | Transactions/day | Burned/year | Supply after 1 year |
|----------|-----------------|-------------|------------------|
| Low | 100 | ~18 BURN | ~982 BURN |
| Medium | 500 | ~91 BURN | ~909 BURN |
| High | 2000 | ~365 BURN | ~635 BURN |

> **Important:** At high activity levels, supply can shrink by 35%+ per year. Actual deflation depends on transaction volume (volume × burn rate), not just transaction count. When supply < 100 BURN, burn rate automatically drops to 0.1% (see FAQ).

---

## Treasury

Treasury is a separate smart contract that accumulates 0.2% of each transaction. It is an **excluded address** for fee mechanics (incoming transfers are not subject to additional burn/staking fees).

### Fund allocation

```
┌─────────────────────────────────────────────────────────────────┐
│                    TREASURY ALLOCATION                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 🏗️ INFRASTRUCTURE                                            │
│     ├── Hosting and servers (backend, Redis)                     │
│     ├── TON RPC nodes and services                                 │
│     ├── Domain names and SSL certificates                        │
│     └── Monitoring and logging                                   │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  2. 🛡️ SECURITY                                                  │
│     ├── Smart contract audits (external)                         │
│     ├── Bug bounty program                                       │
│     ├── Penetration testing                                      │
│     └── Formal contract verification                             │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  3. 🤝 GRANTS                                                    │
│     ├── Developer grants (feature expansion)                     │
│     ├── Ecosystem partner grants (integrations)                  │
│     └── Educational initiatives and documentation                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

> **Distinction from Ecosystem allocation (150 BURN):** Ecosystem allocation is intended for large strategic partnerships and marketing campaigns (2-year vesting). Treasury funds operational expenses, audits, bug bounty, and targeted grants from the ongoing transaction fee stream — this allowed reducing Ecosystem allocation from 200 to 150 BURN, redirecting funds to the Liquidity Pool.

### Treasury spending

Any Treasury spending requires governance voting (`Treasury Spend`: 20% VP quorum, 66% threshold, 7-day period). All stakers vote using the VP formula.

Treasury Spend proposals must target the **canonical Treasury contract** wired in `Governor` at deploy time; the Governor rejects create payloads whose treasury address does not match. The Mini App pins the same address from `VITE_TREASURY_ADDRESS` (read-only in the form).

---

## Emission Distribution

### Allocation Chart

```
Total Supply: 1,000 BURN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  20%        │
│  Community Airdrop                           200 BURN            │
│                                                                  │
│  ██████████████████████████████░░░░░░░░░░░░░░░░░░░░  30%        │
│  Staking Rewards Pool                        300 BURN            │
│                                                                  │
│  ███████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  15%        │
│  Ecosystem Development                       150 BURN            │
│                                                                  │
│  ██████████████████████████████░░░░░░░░░░░░░░░░░░░░  30%        │
│  Liquidity Pool (DEX)                        300 BURN            │
│                                                                  │
│  ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  4.3%       │
│  Reserve                                      43 BURN            │
│                                                                  │
│  █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0.7%       │
│  Developer                                     7 BURN            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Distribution details

| Category | Amount | % | Vesting | Purpose |
|-----------|------------|---|---------|------------|
| **Developer** | 7 | 0.7% | 12 months linear | Developer personal allocation |
| **Community Airdrop** | 200 | 20% | — | Early BurnedChats users |
| **Staking Rewards** | 300 | 30% | — (on-chain emission, 3 years) | Staking rewards (linear distribution) |
| **Ecosystem** | 150 | 15% | 2 years | Grants, partnerships, marketing |
| **Liquidity** | 300 | 30% | — | DEX pools (DeDust, STON.fi) |
| **Reserve** | 43 | 4.3% | 3 years | Unforeseen expenses |

### Vesting Schedule

```
┌─────────────────────────────────────────────────────────────────┐
│                      VESTING TIMELINE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Month    0    6    12   18   24   30   36   48   60            │
│          ─┬────┬────┬────┬────┬────┬────┬────┬────┬─            │
│           │    │    │    │    │    │    │    │    │             │
│  Airdrop  ████████████████████████████████████████  Immediate    │
│           │    │    │    │    │    │    │    │    │             │
│  Liquidity████████████████████████████████████████  Immediate (LP)│
│           │    │    │    │    │    │    │    │    │             │
│  Developer██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Linear       │
│           │    │    │    │    │    │    │    │    │  12 months │
│           │    │    │    │    │    │    │    │    │             │
│  Staking  ████████████████████████░░░░░░░░░░░░░░░░  Linear     │
│           │    │    │    │    │    │    │    │    │  3 years*   │
│           │    │    │    │    │    │    │    │    │             │
│  Ecosystem░░░░░░░░░░████████████████████████░░░░░░░  Linear      │
│           │    │    │    │    │    │    │    │    │  2 years    │
│           │    │    │    │    │    │    │    │    │             │
│  Reserve  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████  After      │
│           │    │    │    │    │    │    │    │    │  3 years    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

> **\* Staking Rewards are not held by a vesting contract.** The full 300 BURN
> allocation is minted directly to the StakingPool's jetton wallet at TGE
> (bootstrap mints with an `EmissionFundForward` payload; the pool relays
> `EmissionReserveFunded` to the StakingMaster, so the emission reserve is
> credited only when the jettons physically arrive). The 3-year linear release
> is enforced **on-chain** by StakingMaster `tickEmission` math
> (`EmissionNanoPerSec = 3170` nano/sec, capped by the funded reserve) — rewards
> can never be distributed faster than the schedule, even though the tokens sit
> in the pool wallet from day one.

---

## Staking

### Tiered Staking System

```
┌─────────────────────────────────────────────────────────────────┐
│                      STAKING TIERS                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  🥉 FLEXIBLE (no lock)                                             │
│     ├── Reward share: 5%                                         │
│     ├── Voting Power: 1.0x                                       │
│     └── Unstake: instant                                         │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  🥈 SILVER (6 months)                                              │
│     ├── Reward share: 10%                                        │
│     ├── Voting Power: 1.5x                                       │
│     └── Unstake: after lock period                               │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  🥇 GOLD (1 year)                                                 │
│     ├── Reward share: 25%                                        │
│     ├── Voting Power: 2.0x                                       │
│     └── Unstake: after lock period                               │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  💎 DIAMOND (3 years)                                             │
│     ├── Reward share: 60%                                        │
│     ├── Voting Power: 3.0x (maximum)                           │
│     ├── Bonuses: + Exclusive NFT Badge                           │
│     ├── Early Access: Beta features                                │
│     └── Unstake: after lock period                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

> **APY is not fixed** — it depends on total staked tokens in each tier and the current distribution rate from the Staking Pool. Reward share is the portion of total reward distribution allocated to a tier.

### Staking Pool dynamics

```
┌─────────────────────────────────────────────────────────────────┐
│                  STAKING POOL DYNAMICS                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PHASE 1 (year 0–3): Initial Allocation                          │
│  ├── Source: 300 BURN minted to the pool wallet at TGE           │
│  ├── Release: linear, enforced on-chain by tickEmission          │
│  ├── Rate:     100 BURN/year = ~0.274 BURN/day                     │
│  └── Additional: + 0.3% of each transaction volume               │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  PHASE 2 (year 3+): Self-sustaining                              │
│  ├── Source: transaction fees only                               │
│  ├── Rate: 0.3% × daily tx volume                                │
│  └── Depends on network activity                                 │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Distribution across tiers (always):                             │
│  ├── 60% → Diamond  (3 years)                                    │
│  ├── 25% → Gold     (1 year)                                     │
│  ├── 10% → Silver   (6 months)                                   │
│  └── 5%  → Flexible (no lock)                                    │
│                                                                  │
│  Within a tier — proportional to stake size                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Individual reward calculation

```
DailyReward(user) = TierShare × DailyPoolEmission × (UserStake / TotalTierStake)

Where:
├── TierShare           — 0.05 / 0.10 / 0.25 / 0.60 (Flexible/Silver/Gold/Diamond)
├── DailyPoolEmission   — 0.274 BURN (phase 1) + tx_fees_today
└── UserStake / TotalTierStake — user's share within their tier
```

### Indicative APY calculator (Phase 1, at different participation levels)

Assumptions: 30% supply (300 BURN) staked, typical tier distribution (Diamond 30% / Gold 25% / Silver 25% / Flexible 20%), tx fees ignored.

| Stake | Tier | Tier share of total stake | Indicative APY | Reward/year |
|-------|-----|--------------------------|-------------------|-------------|
| 10 BURN | Flexible | 60 BURN total | ~8% | ~0.83 BURN |
| 10 BURN | Silver | 75 BURN total | ~13% | ~1.33 BURN |
| 10 BURN | Gold | 75 BURN total | ~33% | ~3.33 BURN |
| 10 BURN | Diamond | 90 BURN total | ~67% | ~6.67 BURN |

> **Important:** Actual APY depends on how many tokens are staked in your tier. Fewer competitors means higher yield. After year 3 (initial allocation exhausted), APY is determined only by tx fees and drops substantially.

### Staking Pool Wallet

Staking Pool is a separate smart contract acting as an **excluded address** for fee mechanics: transfers from Staking Pool to users are not subject to repeated burn/staking/treasury fees. This allows rewards to be paid out without double taxation.

---

## BCID Fee Semantics

> BURN distribution for Burned Chats ID (BCID NFT profile) operations and alignment with the **standard 1% Jetton fee** on transfers.

### Operation variants

| Operation | Cost (user) | Distribution within BCID contract |
|----------|---------------------------|--------------------------------------|
| Mint BCID | 0.001 BURN (+ GRAM gas) | 50% burn / 30% staking / 20% treasury |
| Rename | 0.001 BURN | 50% / 30% / 20% |
| Avatar update | 0.0005 BURN | 50% / 30% / 20% |

### Mechanics (Variant A — adopted)

1. **BCID contract is included in Jetton Master excluded addresses**; the specific BCID address is added after on-chain deployment.
2. User Jetton **transfer** to the BCID contract address is **not** subject to the standard 1% Jetton Wallet-level fee (sender/recipient excluded per master rules).
3. BCID contract receives the **full** stated amount (e.g. 0.001 BURN for mint).
4. Contract executes **outgoing** transfers per the 50/30/20 split (to excluded burn path / staking pool / treasury — without repeated Jetton fee).
5. **Result:** 100% of BURN paid by product semantics goes to 50/30/20; no stacking of "1% Jetton on top" for mint/rename/avatar on BCID.

### Edge cases

- **Insufficient balance** — wallet rejects transfer before reaching the network.
- **Insufficient GRAM for gas** on BCID contract — operation does not complete; user sees error in wallet / UI.
- **Nickname collision** — resolved on-chain in nickname registry (see P3-3.1.2).

### Rationale

Variant A — adopted: BCID operations use the 50/30/20 split without stacking the standard 1% Jetton transfer fee.

---

## Utility

### Use Cases in BurnedChats

```
┌─────────────────────────────────────────────────────────────────┐
│                    BURN TOKEN UTILITY                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 🎁 REWARDS & INCENTIVES                                      │
│     ├── Airdrop to early users                                   │
│     ├── Referral program (invite friends)                        │
│     ├── Bug report rewards                                       │
│     ├── Contests and challenges                                  │
│     └── Community activity                                       │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  2. 🗳️ GOVERNANCE                                                │
│     ├── Voting on new features                                   │
│     ├── Roadmap prioritization                                   │
│     ├── Parameter changes (burn rate, tier shares,               │
│     │   distribution rate)                                       │
│     └── Treasury distribution                                    │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  3. 💎 STAKING BENEFITS                                          │
│     ├── Passive income (dynamic APY)                             │
│     ├── Voting Power for governance                              │
│     ├── Exclusive NFT badges (Diamond)                           │
│     └── Early access to beta features (Diamond)                  │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  4. 🎨 COSMETICS & STATUS                                        │
│     ├── Unique avatar frames                                     │
│     ├── Animated burn effects                                    │
│     ├── Exclusive notification sounds                            │
│     └── "OG Holder" status for early adopters                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Governance

### Voting Power

```
Voting Power = Staked Amount × Time Multiplier

Time Multipliers:
├── Flexible:  1.0x
├── 6 months:  1.5x
├── 1 year:    2.0x
└── 3 years:   3.0x

Example:
├── Alice: 10 BURN (3 years) → 10 × 3.0 = 30 VP
├── Bob:   20 BURN (flexible) → 20 × 1.0 = 20 VP
└── Alice has more influence despite a smaller stake
```

### Governance Proposals

| Type | Quorum | Approval threshold | Voting period |
|-----|--------|----------------|-------------------|
| Parameter Change | 10% VP | 51% | 3 days |
| Feature Priority | 5% VP | 51% | 7 days |
| Treasury Spend | 20% VP | 66% | 7 days |
| Emergency | 30% VP | 75% | 24 hours |

### Proposal examples

```
┌─────────────────────────────────────────────────────────────────┐
│  PROPOSAL #001: Reduce burn rate to 0.25%                        │
├─────────────────────────────────────────────────────────────────┤
│  Type: Parameter Change                                          │
│  Proposer: 0x1234...                                             │
│  Required VP: 10%                                                │
│  Current VP: 15.3% ✅                                             │
│                                                                  │
│  Votes:                                                          │
│  ├── FOR:     62.4%  ████████████░░░░░░░░                        │
│  └── AGAINST: 37.6%  ███████░░░░░░░░░░░░░                        │
│                                                                  │
│  Status: PASSED ✅                                                │
│  Execution: In 48 hours                                          │
└─────────────────────────────────────────────────────────────────┘
```

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
│         │ TON Connect           │ Verify balance                 │
│         ▼                       ▼                                │
│  ┌─────────────┐         ┌─────────────┐                        │
│  │  TON Wallet │◄───────►│  TON RPC    │                        │
│  │ (@wallet)   │         │  (toncenter)│                        │
│  └──────┬──────┘         └─────────────┘                        │
│         │                       ▲                                │
│         │                       │                                │
│         ▼                       │                                │
│  ┌─────────────────────────────┴───────────────────────────────┐│
│  │                      TON BLOCKCHAIN                          ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          ││
│  │  │ BURN Jetton │  │  Staking    │  │  Governance │          ││
│  │  │   Master    │  │   Pool      │  │   Contract  │          ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### New Frontend components

```
frontend/src/
├── ton/
│   ├── connector.ts           # TON Connect integration
│   ├── burnToken.ts           # Jetton interaction
│   ├── staking.ts             # Staking operations
│   ├── governance.ts          # Voting
│   └── wallet.ts              # Balance, history
├── components/
│   ├── Wallet/
│   │   ├── WalletButton.tsx   # Connect button
│   │   ├── Balance.tsx        # Balance display
│   │   ├── SendModal.tsx      # Send tokens
│   │   └── History.tsx        # Transaction history
│   ├── Staking/
│   │   ├── StakingDashboard.tsx
│   │   ├── StakeModal.tsx
│   │   ├── UnstakeModal.tsx
│   │   └── RewardsCard.tsx
│   └── Governance/
│       ├── ProposalList.tsx
│       ├── ProposalDetail.tsx
│       ├── VoteModal.tsx
│       └── CreateProposal.tsx
├── hooks/
│   ├── useTonConnect.ts
│   ├── useBurnToken.ts
│   ├── useStaking.ts
│   └── useGovernance.ts
└── types/
    └── ton.ts
```

### Backend changes

```
backend/src/main/java/dev/burnedchats/
├── ton/
│   ├── TonService.java            # TON RPC client
│   ├── JettonService.java         # BURN balance verification
│   ├── StakingVerifier.java       # Staking verification
│   └── dto/
│       ├── WalletInfo.java
│       └── StakingInfo.java
└── config/
    └── TonConfig.java             # TON configuration
```

---

## Smart Contracts

### Contract structure

```
contracts/
├── jetton/
│   ├── burn-jetton-master.fc      # Main token contract
│   ├── burn-jetton-wallet.fc      # User wallet
│   └── burn-logic.fc              # Deflation logic
├── staking/
│   ├── staking-master.fc          # Main staking contract
│   ├── staking-pool.fc            # Rewards pool
│   └── lock-contract.fc           # Time-lock contract
├── governance/
│   ├── governor.fc                # Main governance contract
│   ├── proposal.fc                # Proposal contract
│   └── timelock.fc                # Execution delay
├── scripts/
│   ├── deploy.ts                  # Deploy scripts
│   ├── mint.ts                    # Minting
│   └── verify.ts                  # Verification
└── tests/
    ├── jetton.spec.ts
    ├── staking.spec.ts
    └── governance.spec.ts
```

> Contract source code and integration will appear in `contracts/` and the corresponding `frontend/src/ton/`, `backend/src/.../ton/` files during v1.5 implementation.

---

## BurnedChats Integration

### Integration components

**Backend:** `TonService` (TON RPC), `JettonService` (BURN balance), `StakingVerifier` (staking tier).

**Frontend:** `useTonConnect` (wallet connection), `useBurnToken` (balance), `useStaking` (staking operations), `useGovernance` (voting).

---

## Risks and Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|---------|-----------|
| **Smart contract bug** | Medium | Critical | Audit, tests, bug bounty |
| **Low liquidity** | Medium | High | Increased LP allocation (30%, 300 BURN) for DEX depth |
| **Whale manipulation** | Medium | High | Low total supply (1000 BURN) itself makes mass buying expensive; large wallet monitoring |
| **Regulatory issues** | Low | Critical | Utility token, not security |
| **Low adoption** | Medium | High | Tied to real utility |
| **TON network issues** | Low | High | Monitoring, fallback plans |
| **Staking pool drain** | Low | High | Reward limits, on-chain emission cap |

### Contingency Plans

```
┌─────────────────────────────────────────────────────────────────┐
│  EMERGENCY PROCEDURES                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Critical Bug Found:                                          │
│     ├── Pause contract (if possible)                             │
│     ├── Notify community                                         │
│     ├── Develop and test fix                                     │
│     └── Deploy updated contract                                  │
│                                                                  │
│  2. Liquidity Crisis:                                            │
│     ├── Use Reserve allocation (43 BURN)                         │
│     ├── Buyback from Treasury and LP replenishment               │
│     ├── Temporarily reduce staking distribution rate             │
│     └── Partnerships for additional liquidity                    │
│                                                                  │
│  3. Whale Attack / Market Manipulation:                          │
│     ├── Activate emergency governance                            │
│     ├── Buyback & burn from Treasury                             │
│     └── Coordinate with DEX on protective measures               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Success Metrics

### Launch Metrics (first month)

| Metric | Target |
|---------|------|
| Unique holders | > 500 |
| Total staked | > 30% supply |
| Daily transactions | > 100 |
| Liquidity (DEX) | > $15,000 |
| Active stakers | > 50 |

### Growth Metrics (6 months)

| Metric | Target |
|---------|------|
| Unique holders | > 5,000 |
| Total staked | > 50% supply |
| Tokens burned | > 10% initial supply |
| Daily active users | > 500 |
| Governance participation | > 20% of stakers |

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — technical architecture
- [SECURITY.md](./SECURITY.md) — system security
- [API.md](./API.md) — API specification

---

## FAQ

### Why only 1,000 tokens?

Low emission creates:
- Psychological value ("I own a whole token")
- Natural scarcity
- Simplicity of understanding (1 BURN = meaningful amount)

### Why 0.7% developer allocation?

- Demonstrates belief in the project
- Minimal allocation size + 12-month linear vesting rules out "rug pull" possibility
- Aligns interests with the community

### What if supply becomes too small?

When supply < 100 BURN:
- Burn rate automatically drops to 0.1%
- Staking rewards decrease proportionally
- Token becomes a "collectible asset"

### Can parameters be changed?

Yes, through governance:
- Burn rate (0.1% – 5%)
- Staking pool distribution rate (linear distribution speed of 300 BURN initial allocation)
- Tier reward shares (60/25/10/5 shares between Diamond/Gold/Silver/Flexible)
- Treasury distribution

All stakers vote with weight per the VP formula (see Governance section). Quorum and approval threshold requirements depend on proposal type (Parameter Change / Feature Priority / Treasury Spend / Emergency).
