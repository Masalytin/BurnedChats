# Deployment manifests

| File | Role |
|------|------|
| `testnet.json` | **Shared tip** — canonical testnet addresses for Mini App / backend / frontend. Written by `deploy:burn:testnet` (+ `syncAppConfigs`). |
| `testnet-lab.json` | **Lab tip** — separate stack for destructive scenarios and short-timer governance. Tracked; **never** synced into app env. |
| `mainnet.json` | Mainnet tip (production). |

`testnet.json` / `mainnet.json` are written by `contracts/scripts/deploy.ts` after a successful deploy. Lab is produced via backup→deploy→copy→restore (see private `RUNBOOK-redeploy.md`); the live runner selects it with:

```bash
npm run testnet:scenarios -- --manifest lab …
# default --manifest shared → testnet.json
```

**Do not point Mini App / `syncAppConfigs` at lab.** App configs always follow `testnet.json`.

```bash
cd contracts
cp .env.example .env.testnet
# Fund deployer (~5 TON testnet) and set:
#   WALLET_MNEMONIC + WALLET_VERSION (or legacy MNEMONIC_TESTNET)
#   TONCENTER_API_KEY_TESTNET
# Optional override (default: frontend-hosted metadata on burnedchats.net):
#   JETTON_METADATA_URI=https://burnedchats.net/jetton-metadata.json
npm run deploy:burn:testnet   # runs blueprint build --all, then deploy
npm run verify:deployment
```

`npm run deploy:burn:*`, `verify:*`, `sync:fee:*`, and `mint` rebuild contracts
automatically. For **manual** `npx blueprint run …` (vesting partial deploys, etc.),
run `npm run build` first if `.tact` changed or `build/` is missing — see
[`../README.md`](../README.md#manual-blueprint-run-no-npm-wrapper).

### Post-deploy verification (`verify:deployment`)

Beyond on-chain supply/balance/admin checks, `verify-deployment.ts` also:

1. **Metadata URI** — fetches `deployment.metadataUri` or decodes the off-chain URI from
   on-chain `jettonContent`; expects HTTP 200 and JSON with `name`, `symbol`, `decimals`.
2. **Tonapi indexability** (testnet/mainnet only) — GET
   `https://{testnet.}tonapi.io/v2/jettons/{jettonMaster}` must not return
   `{"error":"entity not found"}`; response must include `metadata` or `symbol`.
   Retries 3× with 5 s delay (tonapi indexing lag after deploy).
   **Soft N/A (IMP-TNFS-F05):** if every on-chain fingerprint check already passed
   and tonapi still reports index lag after retries, the check becomes soft N/A
   with reason `tonapi-index-lag` (scenario does **not** hard-fail). On-chain
   mismatches still fail the run. This does not replace manual tip sync
   (`IMP-TNFS-01`).

Skip tonapi when outbound HTTP is unavailable (e.g. CI sandbox), or to force-skip
the index check:

```bash
SKIP_TONAPI_INDEX=1 npm run verify:deployment
# equivalent legacy alias:
VERIFY_SKIP_TONAPI=1 npm run verify:deployment
```

Metadata HTTP check still runs unless verify is pointed at a deployment without network.
On a fresh redeploy, allow up to ~15 s for the tonapi retry loop; persistent lag
after that is soft N/A when on-chain checks are green (see above).

### MNAUD tip code-hash pin (`EXPECT_MNAUD_TIP`) — IMP-TNFS-F29

After merging **IMP-MNAUD-F07** / **F16** and redeploying lab/shared, gate the tip
before F19–F21 live packs:

```powershell
$env:EXPECT_MNAUD_TIP = '1'
npm run verify:deployment
# or: npm run testnet:scenarios -- --manifest lab --scenario fs-ops-deployment-fingerprint --force
```

Compares on-chain Governor + StakingMaster account code and JettonWallet code
(from `get_jetton_data`) to local `build/**/*.code.boc`. Mismatch → hard FAIL
(stale tip). Without the env flag (and without `expectMnaudTip` /
`lab.expectMnaudTip` in the manifest) the check is soft N/A so pre-MNAUD tips
still verify green.

Optional: persist hashes in the deployment JSON as `codeHashes.governor` /
`staking` / `jettonWallet` (or `jetton` for wallet code); under the pin those
values must also match the local build.

**Human explorer (ops):** prefer **[testnet.tonscan.org](https://testnet.tonscan.org)** /
[tonscan.org](https://tonscan.org) for manual address/tx checks. Scenario report
links use the same hosts (`tonscanTxUrl` / `tonscanAddressUrl` in
`testnet-scenarios/lib/tonapi.ts`). Tonviewer is optional/legacy only — do not
treat it as primary. This does **not** change the TonAPI JSON host
(`testnet.tonapi.io` / `tonapi.io`) used for index/event fetch above.

### Jetton metadata (`JETTON_METADATA_URI`)

Deploy embeds a TEP-64 off-chain URI into `BurnJettonMaster` content. If `JETTON_METADATA_URI`
is unset, bootstrap uses the canonical file on the production frontend:

`https://burnedchats.net/jetton-metadata.json`

Companion assets (source in repo, served after frontend deploy):

- JSON: [`../../frontend/public/jetton-metadata.json`](../../frontend/public/jetton-metadata.json)
  — mirror in [`../jetton/metadata.json`](../jetton/metadata.json) for contracts docs
- Icon: [`../../frontend/public/burn-icon.png`](../../frontend/public/burn-icon.png) →
  `https://burnedchats.net/burn-icon.png`

**Before jetton deploy:** deploy frontend, then curl both URLs — HTTP 200:

```bash
curl -sfI https://burnedchats.net/jetton-metadata.json
curl -sfI https://burnedchats.net/burn-icon.png
```

Override with `JETTON_METADATA_URI` for staging or pinned releases.

**Mainnet:** prefer an immutable URL (release tag or CDN), not a floating `master` branch — set
`JETTON_METADATA_URI` in `.env.mainnet` rather than relying on the default.

Env load order for `--testnet`: `.env.testnet` → `.env`. Blueprint reads `WALLET_MNEMONIC` and
`WALLET_VERSION`; legacy `MNEMONIC_*` vars are aliased automatically via `blueprint.config.ts`.

### Multisig holders and fee smoke wallets

| Env var | Purpose |
|---------|---------|
| `LIQUIDITY_MULTISIG` | LP allocation holder (300 BURN mint). **Excluded** from transfer fees by design. Set to a dedicated address — not the deployer — so deployer is not both liquidity holder and smoke sender. |
| `AIRDROP_MULTISIG` | Community airdrop holder (200 BURN). Non-excluded; bootstrap syncs `feeConfig` after mint (IMP-JETTON-FEE-03). |
| `BURN_SMOKE_TEST_OWNER` | Non-excluded wallet for post-deploy burn transfer smoke (`scripts/post-deploy-burn-transfer-smoke.sh`). Root `.env.example`. |
| `FEE_TEST_SENDER` | Optional alias for fee-split verification scripts (IMP-JETTON-FEE-02). |

Without `LIQUIDITY_MULTISIG`, deployer becomes liquidity holder → `addExcluded` → fee smoke from deployer
wallet shows 100% to recipient (misleading «fee not working»). Use `BURN_SMOKE_TEST_OWNER` or a separate
airdrop/non-excluded wallet for fee verification.

### Timelock governor multisig (PARAMETERS §2 B)

Owner decision 2026-08-08: on **mainnet** `Timelock.governor` is a multisig
(not a single EOA). Bootstrap reads:

| Env var | Required when | Purpose |
|---------|---------------|---------|
| `TIMELOCK_GOVERNOR` | `--mainnet` / `MAINNET_FINALIZE=1` | Multisig address → Timelock init `governor` |
| `TIMELOCK_GOVERNOR_MULTISIG` | alias | Same as `TIMELOCK_GOVERNOR` |
| `MULTISIG_KIND` | lab agent tests (optional) | Hint for future harness (`ton-multisig-v2`, …) |
| `MULTISIG_THRESHOLD` | lab agent tests (optional) | e.g. `2` for 2-of-3 |
| `MULTISIG_SIGNER_{1,2,3}_MNEMONIC` | lab agent tests | Throwaway **testnet** signer seeds (≥ threshold) |
| `MULTISIG_SIGNER_{1,2,3}_ADDRESS` | optional | Override if address ≠ default V5R1 derivation |

**Ordinary lab (current default):** leave `TIMELOCK_GOVERNOR` unset →
`Timelock.governor =` deployer (`WALLET_MNEMONIC`). Scenario runner still signs
Timelock queue/execute via `DEPLOY_WALLET_MNEMONIC` / deployer (IMP-TNFS-F16).

**Lab tip with real multisig governor (agent can test without the owner online):**

1. Deploy a **throwaway** testnet multisig (never mainnet keys / never prod signers).
   Helper (needs a local compile of [ton-blockchain/multisig-contract-v2](https://github.com/ton-blockchain/multisig-contract-v2)
   → set `MULTISIG_V2_BUILD` to its `build/`):
   `node -r dotenv/config scripts/deploy/deploy-throwaway-timelock-multisig.cjs dotenv_config_path=.env.testnet`
   Env helpers / readiness: `scripts/deploy/multisig-env.ts` (+ `tests/multisig-env.spec.ts`).
2. Set `TIMELOCK_GOVERNOR` + fill `MULTISIG_SIGNER_*_MNEMONIC` (≥ `MULTISIG_THRESHOLD`)
   and `MULTISIG_THRESHOLD` / `MULTISIG_KIND` in `.env.testnet` (gitignored).
3. Fund the multisig with testnet TON (queue/execute attaches) — the helper funds ~1.5 TON
   and also ensures the Order **librarian** (masterchain library) is active.
4. Redeploy lab (`LAB_GOV_SHORT_TIMERS=1`, `TIMELOCK_GOVERNOR` set). Confirm
   `bootstrap.timelockGovernorIsDeployer=false` in `testnet-lab.json`.
5. **Harness (IMP-MNAUD-F15):** `testnet-scenarios/lib/multisig.ts` —
   `resolveTimelockGovernorSender` uses deployer EOA when `get_governor` equals
   the deploy wallet; otherwise packs ton-multisig-v2 `new_order` + ≥threshold
   `approve` and delivers Timelock queue/execute from the multisig. Incomplete
   signer env → explicit N/A / loud error (no false-PASS). After setting
   `TIMELOCK_GOVERNOR`, **redeploy** lab (`LAB_GOV_SHORT_TIMERS=1`) — Timelock
   address changes with governor init.

**Security:** do not put mainnet multisig signer mnemonics in `.env.testnet`.
Secrets must never appear in `reports/*.json` or git commits (`.env*` is gitignored).

See also `docs/specs/TOKENOMICS.md` § fee verification notes.

Post-deploy fee-split regression:

```bash
cd contracts
npm run verify:fee-split:testnet
```

### BURN jetton transfer gas (Mini App)

User-facing BURN sends attach **3.5 TON** to each `JettonTransfer` message
(`contracts/tests/helpers.ts` → `TRANSFER_TON`; frontend
`BURN_TRANSFER_ATTACHED_TON` in `frontend/src/ton/transactionBuilder.ts`).
The wallet contract requires strictly more than **2.05 TON** attached plus forward fees;
see `contracts/jetton/burn-jetton-wallet.tact` and
[TX-A2AC8E4F-FAIL-REPORT.md](../jetton-unknown-tonviewer-balances/TX-A2AC8E4F-FAIL-REPORT.md).

Re-run with `--force` to overwrite live contracts (destructive on same addresses).

### Fix «Fee destinations not configured» (exit 21507) on live wallets

If a holder received BURN before fee-config propagation was deployed, their jetton wallet
may reject sends until master pushes config:

```bash
cd contracts
# timelock/deployer mnemonic in .env.testnet
SYNC_FEE_OWNER=0QYourUserWallet... npm run sync:fee:testnet
```

After redeploying wallet code with fee-config propagation (see `docs/specs/TOKENOMICS.md`),
new P2P recipients inherit config automatically; sync is only needed for wallets that
already exist with an empty `feeConfig`.

Use `--dry-run` to compute addresses and write JSON without sending transactions (still requires Blueprint wallet for deployer address).
