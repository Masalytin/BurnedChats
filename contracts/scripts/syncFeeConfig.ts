import { Address } from '@ton/core';
import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { loadDeployment } from './deploy/store';

/**
 * Push master fee config to one holder's jetton wallet (fixes exit 21507 on live deploys).
 *
 * Usage (testnet, timelock wallet mnemonic in .env.testnet):
 *   SYNC_FEE_OWNER=0Q... npm run sync:fee:testnet
 *
 * Requires `deployments/testnet.json` from a prior `npm run deploy:burn:testnet`.
 * Sender must be the jetton timelock address (`get_timelock_address` on master).
 */
export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    const network = provider.network();
    if (network !== 'testnet' && network !== 'mainnet') {
        throw new Error(`syncFeeConfig supports testnet/mainnet only, got ${network}`);
    }

    const rawOwner = process.env.SYNC_FEE_OWNER?.trim();
    if (!rawOwner) {
        throw new Error(
            'Set SYNC_FEE_OWNER to the TEP-74 owner address (user wallet), e.g. SYNC_FEE_OWNER=0Q... npm run sync:fee:testnet',
        );
    }
    const owner = Address.parse(rawOwner);

    const deployment = loadDeployment(contractsRoot, network);
    if (!deployment) {
        throw new Error(`Missing deployments/${network}.json — run deploy:burn:${network} first.`);
    }

    const masterAddr = Address.parse(deployment.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(masterAddr));

    const timelock = await master.getGetTimelockAddress();
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Wallet address unavailable from Blueprint sender.');
    }
    if (!sender.equals(timelock)) {
        console.warn(
            `[syncFeeConfig] warning: sender ${sender.toString()} != timelock ${timelock.toString()} — SyncFeeConfigToWallet may bounce.`,
        );
    }

    const walletAddr = await master.getGetWalletAddress(owner);
    const wallet = provider.open(BurnJettonWallet.fromAddress(walletAddr));

    let activeBefore = false;
    try {
        activeBefore = await wallet.getGetFeeConfigActive();
    } catch {
        activeBefore = false;
    }

    console.log('[syncFeeConfig] network', network);
    console.log('[syncFeeConfig] master', masterAddr.toString());
    console.log('[syncFeeConfig] owner', owner.toString());
    console.log('[syncFeeConfig] jetton wallet', walletAddr.toString());
    console.log('[syncFeeConfig] fee_config_active before', activeBefore);

    if (activeBefore) {
        console.log('[syncFeeConfig] already synced — nothing to do.');
        return;
    }

    await master.sendSyncFeeConfigToWallet(provider.sender(), owner);

    const activeAfter = await wallet.getGetFeeConfigActive();
    console.log('[syncFeeConfig] fee_config_active after', activeAfter);
    if (!activeAfter) {
        throw new Error(
            'Sync tx sent but get_fee_config_active is still false — check timelock sender and wallet deployment.',
        );
    }
    console.log('[syncFeeConfig] done.');
}
