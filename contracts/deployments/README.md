# Deployment manifests

`testnet.json` / `mainnet.json` are written by `contracts/scripts/deploy.ts` after a successful deploy.

```bash
cd contracts
cp .env.example .env.testnet
# Fund deployer (~5 TON testnet) and set:
#   WALLET_MNEMONIC + WALLET_VERSION (or legacy MNEMONIC_TESTNET)
#   TONCENTER_API_KEY_TESTNET
npm run deploy:burn:testnet
npm run verify:deployment
```

Env load order for `--testnet`: `.env.testnet` → `.env`. Blueprint reads `WALLET_MNEMONIC` and
`WALLET_VERSION`; legacy `MNEMONIC_*` vars are aliased automatically via `blueprint.config.ts`.

Re-run with `--force` to overwrite live contracts (destructive on same addresses).

Use `--dry-run` to compute addresses and write JSON without sending transactions (still requires Blueprint wallet for deployer address).
