# BURN jetton testnet deploy runbook (IMP-TOKSIM-08)

Jetton-only lifecycle for the simplified 1000 BURN meme token: **7 BURN dev**,
**993 BURN LP provision**, **1% burn on every transfer** (including DEX deposits).

> **Legacy:** pre-2026-07-16 full-stack addresses (`staking`, `governor`, `treasury`, …)
> are obsolete. After env sync, configs reference only `jettonMaster` from this manifest.

## Manifest shape (`deployments/testnet.json`)

```json
{
  "network": "testnet",
  "deployedAt": "YYYY-MM-DD",
  "jettonMaster": "kQ...",
  "totalSupplyAfterLpBurn": "990070000000000",
  "mintClosed": true,
  "adminRevoked": true
}
```

| Field | When set |
|-------|----------|
| `jettonMaster` | After step 1 (bootstrap deploy) |
| `totalSupplyAfterLpBurn` | After step 4 (LP + 1% burn on deposit) — nano-string from `get_jetton_data.totalSupply` |
| `mintClosed` | After step 5 (`close-mint` script) |
| `adminRevoked` | After step 6 (`revoke-admin` script) |

---

## Prerequisites

```powershell
cd contracts
cp .env.example .env.testnet
```

Fill in `.env.testnet`:

| Variable | Purpose |
|----------|---------|
| `WALLET_MNEMONIC` + `WALLET_VERSION` | Blueprint deployer wallet (testnet TON for gas) |
| `TONCENTER_API_KEY_TESTNET` | Higher RPC rate limits |
| `JETTON_METADATA_URI` | Optional; default `https://burnedchats.net/jetton-metadata.json` |
| `DEVELOPER_HOLDER` | Receives 7 BURN (default: deployer) |
| `LIQUIDITY_MULTISIG` | Receives 993 BURN for LP (default: deployer) |

Verify metadata is reachable:

```powershell
curl.exe -sfI "https://burnedchats.net/jetton-metadata.json"
```

Dry-run (no on-chain txs — computes master address, writes manifest template):

```powershell
npm run deploy:jetton:testnet -- --dry-run
```

**Expected:** console prints `jettonMaster: kQ...`, `deployments/testnet.json` updated with
`mintClosed: false`, `adminRevoked: false`.

---

## Step 1–3 — Bootstrap (deploy master + mint 7 / 993)

```powershell
npm run deploy:jetton:testnet
```

**On-chain actions (requires operator approval per transaction in wallet):**

1. Deploy `BurnJettonMaster` (`admin = deployer`, `mintable = true`)
2. Mint **7 BURN** → `DEVELOPER_HOLDER` (no vesting)
3. Mint **993 BURN** → `LIQUIDITY_MULTISIG`

**Expected result:**

- `deployments/testnet.json` → `jettonMaster` filled, flags still `false`
- `frontend/.env.testnet` + `backend/.../application-testnet.yml` synced (jetton-only)

**Verify:**

```powershell
npx blueprint run verify-deployment --testnet --mnemonic
```

At this stage `verify-deployment` will **fail** on `mintable=false` and supply-cap checks —
that is expected until steps 4–6 complete.

Check mint balances manually (tonapi or wallet):

- Developer wallet: `7_000_000_000` nano (7 BURN)
- LP holder wallet: `993_000_000_000` nano (993 BURN)
- `get_jetton_data.totalSupply` = `1_000_000_000_000` nano

---

## Step 4 — LP pool on STON.fi testnet (manual, irreversible liquidity lock)

**DEX:** [STON.fi](https://app.ston.fi) — switch wallet/network to **TON testnet**.
STON.fi supports fee-on-transfer (tax) tokens up to 10%; BURN uses 1%.

### 4.1 Create BURN/TON pool

1. Open STON.fi → **Liquidity** → **Create pool** (or **Add liquidity** if pool exists).
2. Select **BURN** jetton master from `deployments/testnet.json` (`jettonMaster`).
   - UI may show a **“tax token”** warning — expected.
3. Pair with **TON** (native).
4. Deposit **993 BURN** from the LP holder wallet (`LIQUIDITY_MULTISIG` / deployer).
5. Add matching **TON** side per your target price (testnet — any reasonable ratio).

### 4.2 Expected 1% burn on deposit

The jetton wallet burns **1% on transfer**. When 993 BURN leaves the LP holder wallet
for the pool, **~9.93 BURN** is destroyed and **~983.07 BURN** arrives in the pool.

| Quantity | Value |
|----------|------:|
| LP wallet sends | 993 BURN |
| Burned (1%) | ~9.93 BURN |
| Pool receives (net) | **~983.07 BURN** |
| On-chain `totalSupply` after deposit | **~990.07 BURN** (= 1000 − 9.93) nano: `990_070_000_000` |

Record the observed `totalSupply` from tonapi or:

```powershell
npx blueprint run verify-deployment --testnet --mnemonic
# read total supply line even if other checks fail
```

Update manifest manually (or after observing on-chain supply):

```json
"totalSupplyAfterLpBurn": "990070000000000"
```

(round to your observed nano value)

### 4.3 Burn LP tokens (permanent liquidity lock)

After receiving LP tokens for the BURN/TON position:

1. In STON.fi → **Portfolio** → your BURN/TON LP position.
2. **Remove liquidity** is **not** the goal — instead send LP jettons to the burn sink:

**LP burn address (TON null / inaccessible):**

```
EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c
```

(Unbounceable friendly: `UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ` — same zero address.)

3. Transfer **100%** of received LP tokens to that address.
4. Confirm LP balance is zero in your wallet.

**Verify:**

- LP token wallet balance for your address = 0
- Pool still contains ~983 BURN + your TON (liquidity locked, not removable without LP tokens)

---

## Step 5 — CloseMint (irreversible)

Only after step 4 verify is green.

```powershell
npm run close-mint:testnet
```

Script prompts `Type "yes" to continue` unless `--confirm` or `DEPLOY_I_KNOW_WHAT_IM_DOING=1`.

**Expected:**

- On-chain `mintable = false`
- Manifest `mintClosed: true`

**Verify:**

```powershell
# get_jetton_data → mintable false; Mint op must revert
npm run close-mint:testnet   # should log "mint already closed"
```

---

## Step 6 — Revoke admin (irreversible)

Only after step 5.

```powershell
npm run revoke-admin:testnet
```

Sends `ChangeOwner` → zero workchain address (`0:0000…0000`, IMP-TOKSIM-01).

**Expected:**

- `get_jetton_data.adminAddress` = zero address
- All admin ops (`Mint`, `CloseMint`, `JettonUpdateContent`, `ChangeOwner`) revert forever
- Manifest `adminRevoked: true`
- Transfers (and 1% burn) still work

**Verify:**

```powershell
npm run verify:deployment
VERIFY_SKIP_TONAPI=1 npm run verify:deployment   # if tonapi indexing lags
npm run verify:burn:testnet   # live 1% burn regression (needs BURN_TEST_RECIPIENT)
```

---

## npm scripts summary

| Script | Step |
|--------|------|
| `npm run deploy:jetton:testnet` | 1–3 bootstrap |
| `npm run close-mint:testnet` | 5 CloseMint |
| `npm run revoke-admin:testnet` | 6 admin revoke |
| `npm run verify:deployment` | Post-runbook checks |
| `npm run verify:burn:testnet` | Transfer burn regression |

Aliases kept for compatibility: `deploy:burn:testnet` → same as `deploy:jetton:testnet`.

---

## Env sync (automatic)

`syncAppConfigs.ts` propagates **only** `jettonMaster` to:

- `frontend/.env.testnet` → `VITE_BURN_JETTON_MASTER`
- `backend/src/main/resources/application-testnet.yml` → `jetton-master` default

Removed slots (must not reappear): `VITE_STAKING_MASTER`, `VITE_GOVERNOR_ADDRESS`,
`VITE_TREASURY_ADDRESS`, `BURN_STAKING_MASTER_ADDRESS`, etc.

Root `.env.example` and `docker-compose.prod.yml` follow the same jetton-only shape.

---

## Full checklist (mainnet-portable)

- [ ] Metadata URI HTTP 200
- [ ] Bootstrap: master deployed, 7 + 993 minted, supply = 1000 BURN
- [ ] STON.fi pool: ~983 BURN in pool, ~9.93 BURN burned, LP tokens sent to zero address
- [ ] `totalSupplyAfterLpBurn` recorded in manifest
- [ ] CloseMint: `mintable = false`
- [ ] Admin revoke: admin = zero address
- [ ] `npm run verify:deployment` all green
- [ ] `npm run verify:burn:testnet` — 1 BURN transfer burns exactly 0.01 BURN
- [ ] Frontend wallet: balance + send against new testnet master (manual)

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| `LITE_SERVER_NOTREADY` | Blueprint retries automatically; wait and re-run |
| Partial mint / balance mismatch | Do **not** re-run bootstrap blindly — reconcile on-chain first |
| STON.fi “tax token” warning | Expected for 1% fee jettons |
| `verify-deployment` fails before step 5–6 | Expected — complete LP + CloseMint + revoke first |
| tonapi not indexed | `VERIFY_SKIP_TONAPI=1` for local verify |

Companion assets: [`../../frontend/public/jetton-metadata.json`](../../frontend/public/jetton-metadata.json),
[`../../frontend/public/burn-icon.png`](../../frontend/public/burn-icon.png).

BURN sends in the Mini App attach **0.8 TON** per transfer (`contracts/tests/helpers.ts` → `TRANSFER_TON`).
