# Contract Source Verification (TON)

> How to publish and verify the BURN contract sources so explorers (**tonscan**
> preferred; tonviewer optional/legacy) and wallets show a **"source verified"**
> badge and let anyone read the exact code running on-chain.

## Why verify

On TON the **compiled** code (a code cell with a `code hash`) is already public on
any deployed address — hiding the repo source hides nothing and is decompilable.
Verification adds the missing piece: **cryptographic proof that a given
human-readable source, compiled with a specific compiler version + settings,
produces exactly the on-chain code hash.** It is a reproducible-build attestation,
not a "trust me".

Verification **increases** protection and reputation:

- **Trust / adoption** — a verified badge is the line between "legit" and "assumed
  rug"; wallets and DEX aggregators surface verification status.
- **Free security review** — more eyes (whitehats/community) can find bugs before
  attackers. Obscurity only removes the whitehats; attackers decompile anyway.
- **Anti-impersonation** — anyone can deploy a token literally named "BURN". The
  verified, canonical address + published sources + official channels are how users
  know which deployment is authoritative.
- **No hidden-backdoor suspicion** — verified source lets anyone confirm there is no
  hidden mint/rug function.

See the project security posture in [`../docs/specs/SECURITY.md`](../docs/specs/SECURITY.md).

## How TON verification works

1. Compile the contract (`npm run build`) → code cell + `code hash`, artifacts under
   `build/` (gitignored).
2. On **[verifier.ton.org](https://verifier.ton.org)** enter the deployed address and
   upload the sources + the **exact** compiler (Tact) version and build settings.
3. The verifier backend **recompiles the source in a controlled environment** and
   checks the resulting `code hash` matches the on-chain hash at that address.
4. On match, independent **verifier nodes sign** an attestation; sources are pinned to
   IPFS and registered on-chain via the **sources-registry** contract.
5. Explorers/wallets read that registry → show the verified badge and the source.

> **Determinism is mandatory.** The published compiler version + settings must be the
> exact ones used at deploy time, or the hash will not match. Pin the Tact version
> (see below) — do not rely on the `>=1.6.13 <2.0.0` range.

## Prerequisites

- The contract is **deployed** (testnet stack is already live — see table below).
- A pinned Tact compiler version. This repo currently declares a **range** in
  `package.json` (`"@tact-lang/compiler": ">=1.6.13 <2.0.0"`). Before verifying,
  record the **exact resolved version** and pin it so the build is reproducible:

  ```bash
  cd contracts
  npm ls @tact-lang/compiler   # note the exact installed version, e.g. 1.6.13
  # then pin it in package.json (drop the range) and commit package-lock.json
  ```

- All source files a contract imports (Tact `import` graph) must be available to the
  verifier, plus `tact.config.json` for the project's build options.

## Contracts and settings

Build projects and options come from [`tact.config.json`](tact.config.json)
(`debug: false`, `external: false`, `mode: "full"` for every project). Verify each
deployed contract against its source:

| Contract | Source | tact.config project |
|----------|--------|---------------------|
| BurnJettonMaster | `jetton/burn-jetton-master.tact` | `BurnJettonMaster` |
| StakingPool | `staking/staking-pool.tact` | `StakingPool` |
| StakingMaster | `staking/staking-master.tact` | `StakingMaster` |
| Governor | `governance/governor.tact` | `Governor` |
| Timelock | `governance/timelock.tact` | `Timelock` |
| Treasury | `treasury/treasury.tact` | `Treasury` |
| Vesting | `vesting/vesting.tact` | `Vesting` |

> The Jetton **wallet** code (`jetton/burn-jetton-wallet.tact`) is deployed per holder
> by the master; verify a representative wallet address if desired.

### Current testnet deployment (from `deployments/testnet.json`, 2026-06-28)

| Contract | Testnet address |
|----------|-----------------|
| jettonMaster | `kQD-ZhhzrzyI3k4WarDMPhxAJTdc6MStCZYyCyHHw7Jx-NjD` |
| treasury | `kQCnUzQM-U0cMdChXCaRUy3WSEc5rvnOAEaAbVqHJ-mrNV7P` |
| stakingPool | `kQD0Z08_0tB-rT249cyzdYDhQw03IE2XcFAsHhtHRGbuXD6Q` |
| stakingMaster | `kQCotwKsH0ZAd09msYeJLsEeXzvks_Q6sp8gZj-jE5LgV7M5` |
| governor | `kQB53bI7Y1NdovwTyjox45Lx2opXD6QfuluFTAs4nT0ybC-M` |
| timelock | `kQAV1au0ntabRd_tBJhtEZKZ37KOAPoIAqKYvTSDVRW2jueT` |
| vestingDeveloper | `kQD2BAcU3dMmDQziMyu3MYWYSbaPkw5l0bCPfnHUEg9arnQS` |
| vestingEcosystem | `kQCT6xj5b5loCcCk48pwQpMtQJpwZyDhFRxDJmMoeT4krt2c` |
| vestingReserve | `kQBL9ahUgiHppEcRZ4kyrJ0Voumg48M8BwzmE9Noe8Ve_K-6` |
| vestingStakingAllocation | `kQBXJNQc_yssOLZgPYm7dR_wYD9_plLbMmc9-QOagmcp0ORN` |

## Step-by-step

```bash
cd contracts
npm ci
npm ls @tact-lang/compiler     # confirm exact version; pin it in package.json
npm run build                  # regenerate build/ from current sources
npm run verify                 # prints verifier instructions + env check
```

Then, per contract:

1. Open **[verifier.ton.org](https://verifier.ton.org)** and switch the network
   toggle to **testnet** (or mainnet for a mainnet deploy).
2. Paste the contract **address** (table above).
3. Select compiler **Tact** and the **exact** version you pinned.
4. Upload the contract's `.tact` source **and every file it imports**, plus the
   relevant `tact.config.json` build options (`debug=false`, `external=false`,
   `mode=full`).
5. Submit. The verifier recompiles and compares the `code hash`.
   - **Match** → verifier nodes sign, sources published to IPFS + sources-registry.
   - **Mismatch** → almost always a compiler-version or build-option difference;
     re-pin the exact version/settings used at deploy and retry.
6. Repeat for each deployed contract.

## Confirm it worked

- Open the address on **[testnet.tonscan.org](https://testnet.tonscan.org)** (or
  `tonscan.org` for mainnet) → the contract should show a **verified / source
  available** indicator and let you browse the code.
  - Legacy/optional: [testnet.tonviewer.com](https://testnet.tonviewer.com) /
    `tonviewer.com` — not required for ops; prefer tonscan when explorers disagree.
- Cross-check the on-chain `code hash` equals the hash of your local `build/` output.

## Mainnet notes

- The verification flow is identical; switch the verifier + explorer to mainnet and
  use the mainnet addresses (`deployments/mainnet.json`).
- Verify **immediately after deploy** — an unverified mainnet token holding value is
  the single biggest "scam" signal and suppresses adoption.
- Verification is **not** a security audit. It proves "the published source is what
  runs", not "the source is safe". A mainnet launch with real value still needs an
  external audit (see [`../docs/PORTFOLIO_PRODUCTION_CHECKLIST.md`](../docs/PORTFOLIO_PRODUCTION_CHECKLIST.md) §6).

## Caveats

- **verifier.ton.org UI may change** — the flow (address → compiler+version →
  sources → hash match) is stable even if labels differ.
- **Pin the compiler.** The `>=1.6.13 <2.0.0` range in `package.json` will eventually
  resolve to a newer Tact that produces a different hash. Pin the exact version and
  commit `package-lock.json` before publishing, and record it here when you verify.
