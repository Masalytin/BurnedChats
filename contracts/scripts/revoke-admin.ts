import { Address } from '@ton/core';
import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { INACCESSIBLE_ADMIN_ADDRESS } from './deploy/constants';
import { requireIrreversibleConfirm } from './deploy/confirm';
import { loadDeployEnv } from './deploy/env';
import { resolveJettonMaster, updateManifestFlags } from './deploy/manifest';
import { loadDeployment, saveDeployment } from './deploy/store';
import { syncAppConfigs } from './deploy/syncAppConfigs';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from './deploy/wait';

/**
 * Step 6 — irreversible admin revocation via ChangeOwner to inaccessible address.
 * Requires CloseMint completed first.
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
    if (!deployment.mintClosed) {
        throw new Error('[revoke-admin] mint must be closed first — run close-mint script');
    }
    if (deployment.adminRevoked) {
        console.log('[revoke-admin] admin already revoked — nothing to do');
        return;
    }

    const jettonMasterAddr = Address.parse(resolveJettonMaster(deployment));
    const opened = provider.open(BurnJettonMaster.fromAddress(jettonMasterAddr));
    const data = await opened.getGetJettonData();

    if (data.adminAddress.equals(INACCESSIBLE_ADMIN_ADDRESS)) {
        console.log('[revoke-admin] on-chain admin already inaccessible — updating manifest only');
        const updated = updateManifestFlags(deployment, { adminRevoked: true });
        saveDeployment(contractsRoot, updated);
        syncAppConfigs(repoRoot, updated);
        return;
    }

    const deployer = provider.sender().address;
    if (!deployer) {
        throw new Error('[revoke-admin] deployer wallet address unavailable from sender()');
    }
    if (!data.adminAddress.equals(deployer)) {
        throw new Error(
            `[revoke-admin] current admin ${data.adminAddress.toString()} is not the mnemonic wallet ${deployer.toString()}`,
        );
    }

    await requireIrreversibleConfirm(
        `[revoke-admin] IRREVERSIBLE: ChangeOwner → zero address on ${jettonMasterAddr.toString()}. ` +
            'All admin ops will be permanently disabled.',
    );

    const seqnoBefore = await getSenderSeqno(provider);
    await opened.sendChangeOwner(provider.sender(), INACCESSIBLE_ADMIN_ADDRESS);
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    const after = await opened.getGetJettonData();
    if (!after.adminAddress.equals(INACCESSIBLE_ADMIN_ADDRESS)) {
        throw new Error('[revoke-admin] ChangeOwner tx sent but admin is not the inaccessible address');
    }

    const updated = updateManifestFlags(deployment, { adminRevoked: true });
    const filePath = saveDeployment(contractsRoot, updated);
    syncAppConfigs(repoRoot, updated);
    console.log('[revoke-admin] success — manifest updated', filePath);
}
