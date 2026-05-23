# Deployment manifests

`testnet.json` / `mainnet.json` are written by `contracts/scripts/deploy.ts` after a successful deploy.

```bash
cd contracts
cp .env.example .env.testnet
# Fund deployer (~5 TON testnet) and set MNEMONIC + TONCENTER_API_KEY_TESTNET
npm run deploy:burn:testnet
npm run verify:deployment
```

Re-run with `--force` to overwrite live contracts (destructive on same addresses).

Use `--dry-run` to compute addresses and write JSON without sending transactions (still requires Blueprint wallet for deployer address).
