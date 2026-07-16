import { Address } from '@ton/core';
import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { requireIrreversibleConfirm } from './deploy/confirm';
import { loadDeployEnv } from './deploy/env';
import { resolveJettonMaster, updateManifestFlags } from './deploy/manifest';
import { loadDeployment, saveDeployment } from './deploy/store';
import { syncAppConfigs } from './deploy/syncAppConfigs';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from './deploy/wait';

/**
 * Step 5 — irreversible CloseMint on the jetton master from deployments/{network}.json.
 * Requires LP step completed (runbook step 4) and operator confirmation.
 */
export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    const repoRoot = resolve(contractsRoot, '..');
    loadDeployEnv(contractsRoot);

    const network = provider.network() === 'testnet' ? 'testnet' : 'mainnet';
    const deployment = loadDeployment(contractsRoot, network);
    if (!deployment) {
        throw new Error(`Missing deployments/${network}.json — run deploy:jetton:${network} first`);
    }
    if (deployment.mintClosed) {
        console.log('[close-mint] mint already closed — nothing to do');
        return;
    }

    const jettonMasterAddr = Address.parse(resolveJettonMaster(deployment));
    const opened = provider.open(BurnJettonMaster.fromAddress(jettonMasterAddr));
    const data = await opened.getGetJettonData();
    if (!data.mintable) {
        console.log('[close-mint] on-chain mintable=false — updating manifest only');
        const updated = updateManifestFlags(deployment, { mintClosed: true });
        saveDeployment(contractsRoot, updated);
        syncAppConfigs(repoRoot, updated);
        return;
    }

    await requireIrreversibleConfirm(
        `[close-mint] IRREVERSIBLE: CloseMint on ${jettonMasterAddr.toString()}. No further mints will ever be possible.`,
    );

    const seqnoBefore = await getSenderSeqno(provider);
    await opened.sendCloseMint(provider.sender());
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    const after = await opened.getGetJettonData();
    if (after.mintable) {
        throw new Error('[close-mint] CloseMint tx sent but mintable is still true');
    }

    const updated = updateManifestFlags(deployment, { mintClosed: true });
    const filePath = saveDeployment(contractsRoot, updated);
    syncAppConfigs(repoRoot, updated);
    console.log('[close-mint] success — manifest updated', filePath);
}
