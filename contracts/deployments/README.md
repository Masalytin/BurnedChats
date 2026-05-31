# Deployment manifests

`testnet.json` / `mainnet.json` are written by `contracts/scripts/deploy.ts` after a successful deploy.

```bash
cd contracts
cp .env.example .env.testnet
# Fund deployer (~5 TON testnet) and set:
#   WALLET_MNEMONIC + WALLET_VERSION (or legacy MNEMONIC_TESTNET)
#   TONCENTER_API_KEY_TESTNET
# Optional override (default: in-repo GitHub raw metadata.json):
#   JETTON_METADATA_URI=https://raw.githubusercontent.com/Masalytin/BurnedChats/master/contracts/jetton/metadata.json
npm run deploy:burn:testnet
npm run verify:deployment
```

### Jetton metadata (`JETTON_METADATA_URI`)

Deploy embeds a TEP-64 off-chain URI into `BurnJettonMaster` content. If `JETTON_METADATA_URI`
is unset, bootstrap uses the canonical file in this repo:

`https://raw.githubusercontent.com/Masalytin/BurnedChats/master/contracts/jetton/metadata.json`

Companion assets:

- JSON: [`../jetton/metadata.json`](../jetton/metadata.json) (`name`, `symbol`, `decimals`, `image`)
- Icon: [`../jetton/burn-icon.png`](../jetton/burn-icon.png)

**Before deploy:** curl both URLs and confirm HTTP 200. GitHub raw links work only after the
files are pushed to the default branch (`master`). For local/server deploy before push, set
`JETTON_METADATA_URI` explicitly (e.g. temporary CDN or fork raw URL).

**Mainnet:** prefer an immutable URL (release tag or CDN), not a floating `master` branch — set
`JETTON_METADATA_URI` in `.env.mainnet` rather than relying on the default.

Env load order for `--testnet`: `.env.testnet` → `.env`. Blueprint reads `WALLET_MNEMONIC` and
`WALLET_VERSION`; legacy `MNEMONIC_*` vars are aliased automatically via `blueprint.config.ts`.

Re-run with `--force` to overwrite live contracts (destructive on same addresses).

Use `--dry-run` to compute addresses and write JSON without sending transactions (still requires Blueprint wallet for deployer address).
