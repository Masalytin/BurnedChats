# Deployment manifests

`testnet.json` / `mainnet.json` are written by `contracts/scripts/deploy.ts` after a successful deploy.

```bash
cd contracts
cp .env.example .env.testnet
# Fund deployer (~5 TON testnet) and set:
#   WALLET_MNEMONIC + WALLET_VERSION (or legacy MNEMONIC_TESTNET)
#   TONCENTER_API_KEY_TESTNET
# Optional override (default: frontend-hosted metadata on burnedchats.net):
#   JETTON_METADATA_URI=https://burnedchats.net/jetton-metadata.json
npm run deploy:burn:testnet
npm run verify:deployment
```

### Post-deploy verification (`verify:deployment`)

Beyond on-chain supply/balance/admin checks, `verify-deployment.ts` also:

1. **Metadata URI** — fetches `deployment.metadataUri` or decodes the off-chain URI from
   on-chain `jettonContent`; expects HTTP 200 and JSON with `name`, `symbol`, `decimals`.
2. **Tonapi indexability** (testnet/mainnet only) — GET
   `https://{testnet.}tonapi.io/v2/jettons/{jettonMaster}` must not return
   `{"error":"entity not found"}`; response must include `metadata` or `symbol`.
   Retries 3× with 5 s delay (tonapi indexing lag after deploy).

Skip tonapi when outbound HTTP is unavailable (e.g. CI sandbox):

```bash
VERIFY_SKIP_TONAPI=1 npm run verify:deployment
```

Metadata HTTP check still runs unless verify is pointed at a deployment without network.
On a fresh redeploy, allow up to ~15 s for the tonapi retry loop before treating index
lag as failure.

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

Re-run with `--force` to overwrite live contracts (destructive on same addresses).

Use `--dry-run` to compute addresses and write JSON without sending transactions (still requires Blueprint wallet for deployer address).
