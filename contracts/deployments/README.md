# Deployment manifests

`testnet.json` / `mainnet.json` are written by `contracts/scripts/deploy.ts` after a successful deploy.

```bash
cd contracts
cp .env.example .env.testnet
# Fund deployer and set:
#   WALLET_MNEMONIC + WALLET_VERSION (or legacy MNEMONIC_TESTNET)
#   TONCENTER_API_KEY_TESTNET
# Optional override (default: frontend-hosted metadata on burnedchats.net):
#   JETTON_METADATA_URI=https://burnedchats.net/jetton-metadata.json
npm run deploy:burn:testnet   # runs blueprint build --all, then jetton-only deploy
npm run verify:deployment
```

`npm run deploy:burn:*` and `verify:*` rebuild contracts automatically. For manual
`npx blueprint run …`, run `npm run build` first if `.tact` changed or `build/` is missing.

### Post-deploy verification (`verify:deployment`)

`verify-deployment.ts` checks on-chain jetton state (supply, mintable, admin revoked,
TEP-74 getter shape), metadata URI HTTP 200, and tonapi indexability.

Skip tonapi when outbound HTTP is unavailable:

```bash
VERIFY_SKIP_TONAPI=1 npm run verify:deployment
```

### Jetton metadata (`JETTON_METADATA_URI`)

Deploy embeds a TEP-64 off-chain URI into `BurnJettonMaster` content. Default:
`https://burnedchats.net/jetton-metadata.json`

Companion assets:

- JSON: [`../../frontend/public/jetton-metadata.json`](../../frontend/public/jetton-metadata.json)
- Icon: [`../../frontend/public/burn-icon.png`](../../frontend/public/burn-icon.png)

### Mint holders

| Env var | Purpose |
|---------|---------|
| `DEVELOPER_HOLDER` | Receives 7 BURN at bootstrap (default: deployer) |
| `LIQUIDITY_MULTISIG` | Receives 993 BURN LP provision (default: deployer) |

CloseMint, LP pool creation, and admin revocation — IMP-TOKSIM-08 runbook.

### BURN jetton transfer gas (Mini App)

User-facing BURN sends attach **0.8 TON** to each `JettonTransfer` message
(`contracts/tests/helpers.ts` → `TRANSFER_TON`).

Re-run with `--force` to overwrite live contracts (destructive on same addresses).

Use `--dry-run` to compute addresses and write JSON without sending transactions.

> **Legacy:** `deployments/testnet.json` may still list pre-IMP-TOKSIM-03 full-stack
> addresses until IMP-TOKSIM-08 redeploys the simplified jetton.
