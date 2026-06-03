import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { deployBurnStack } from './deploy/bootstrap';
import { isDryRun, isForceRedeploy, applyBlueprintWalletAliases, loadDeployEnv, resolveMnemonic, resolveToncenterApiKey } from './deploy/env';
import { syncAppConfigs } from './deploy/syncAppConfigs';

/**
 * Full BURN stack deploy orchestrator (testnet/mainnet via Blueprint flags).
 *
 * Env (`.env.testnet` / `.env.mainnet`, then `.env` — see `.env.example`):
 * - WALLET_MNEMONIC + WALLET_VERSION (Blueprint --mnemonic), or legacy MNEMONIC / MNEMONIC_TESTNET
 * - TONCENTER_API_KEY_TESTNET or TONCENTER_API_KEY
 * - JETTON_METADATA_URI (optional; default https://burnedchats.net/jetton-metadata.json — see deployments/README.md)
 * - INITIAL_MIN_PROPOSAL_VP (optional, default 0.01 BURN nano)
 * - AIRDROP_MULTISIG / LIQUIDITY_MULTISIG (optional, default deployer on testnet)
 *
 * Flags:
 * - `--force` re-send deploy txs even when code is already live
 * - `--dry-run` compute addresses + write deployments JSON without sending txs
 */
export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    const repoRoot = resolve(contractsRoot, '..');
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();

    const mnemonic = resolveMnemonic();
    const apiKey = resolveToncenterApiKey();
    console.log('[deploy] wallet mnemonic:', mnemonic ? '(set)' : '(missing)');
    console.log('[deploy] TONCENTER API key:', apiKey ? '(set)' : '(missing — public RPC limits apply)');

    if (!isDryRun() && !mnemonic) {
        throw new Error(
            'Set WALLET_MNEMONIC (or MNEMONIC / MNEMONIC_TESTNET) in contracts/.env.testnet before deploying. Use --dry-run to only compute addresses.',
        );
    }

    const { deployment } = await deployBurnStack(provider, {
        contractsRoot,
        force: isForceRedeploy(),
        dryRun: isDryRun(),
    });

    syncAppConfigs(repoRoot, deployment);
    console.log('[deploy] complete');
}
