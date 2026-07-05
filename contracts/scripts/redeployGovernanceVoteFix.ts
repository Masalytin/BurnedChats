import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { deployBurnStack } from './deploy/bootstrap';
import { applyBlueprintWalletAliases, loadDeployEnv, resolveMnemonic, resolveToncenterApiKey } from './deploy/env';
import { syncAppConfigs } from './deploy/syncAppConfigs';

/**
 * Resume deploy after IMP-GOVREFUND-01: deploy only StakingMaster + Governor slice
 * (new bytecode addresses), wire pool, setGovernor, update testnet.json + app configs.
 *
 * Usage:
 *   DEPLOY_STAKING_MASTER_NANO=38000000000 DEPLOY_FORCE=1 \
 *     npx blueprint run redeployGovernanceVoteFix --testnet --mnemonic
 */
export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    const repoRoot = resolve(contractsRoot, '..');
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();

    const mnemonic = resolveMnemonic();
    const apiKey = resolveToncenterApiKey();
    console.log('[redeploy-gov] wallet mnemonic:', mnemonic ? '(set)' : '(missing)');
    console.log('[redeploy-gov] TONCENTER API key:', apiKey ? '(set)' : '(missing)');

    if (!mnemonic) {
        throw new Error('Set WALLET_MNEMONIC in contracts/.env.testnet');
    }

    const { deployment } = await deployBurnStack(provider, {
        contractsRoot,
        force: true,
        dryRun: false,
        governanceSliceOnly: true,
    });

    syncAppConfigs(repoRoot, deployment);
    console.log('[redeploy-gov] complete — verify with npm run verify:deployment');
}
