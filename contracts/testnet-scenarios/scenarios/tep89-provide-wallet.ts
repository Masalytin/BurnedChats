import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { resolveJettonMaster } from '../../scripts/deploy/manifest';
import { checkTep89WalletDiscovery } from '../lib/tep89-cashback-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/**
 * Readonly TEP-89 / TEP-74 discovery consistency on live:
 * `BurnJettonMaster.predictWalletAddress` must equal on-chain `get_wallet_address`.
 * ProvideWalletAddress tx path deferred — see decision log IMP-TNSCEN-05.
 */
async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const jettonMaster = Address.parse(resolveJettonMaster(ctx.deployment));
    const master = ctx.provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const owner = ctx.provider.sender().address;
    if (!owner) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const onChain = await master.getGetWalletAddress(owner);
    const predicted = await BurnJettonMaster.predictWalletAddress(jettonMaster, owner);

    const fmt = (a: Address) => a.toString({ urlSafe: true, bounceable: true });
    return checkTep89WalletDiscovery({
        predictedWallet: fmt(predicted),
        onChainWallet: fmt(onChain),
        owner: fmt(owner),
    });
}

const scenario: Scenario = {
    id: 'tep89-provide-wallet',
    title: 'TEP-89 wallet discovery consistency',
    description:
        'Readonly: predicted jetton wallet equals on-chain get_wallet_address for the mnemonic owner (TEP-89/TEP-74 discovery). Fails on mismatch. Live ProvideWalletAddress path deferred to keep the probe non-destructive / indexer-stable.',
    tags: ['tep89', 'burn', 'readonly'],
    needsLiveTx: false,
    run,
};

export default scenario;
