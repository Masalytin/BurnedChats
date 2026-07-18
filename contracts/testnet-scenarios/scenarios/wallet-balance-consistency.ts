import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { resolveJettonMaster } from '../../scripts/deploy/manifest';
import { readJettonWalletBalance } from '../lib/balances';
import { checkWalletBalanceConsistency } from '../lib/matrix-checks';
import { fetchJettonTransferHistorySample } from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/**
 * Readonly: getWalletAddress + on-chain balance vs a tonapi transfer-history sample.
 * Empty history → explicit N/A check (not a silent vacuous pass).
 */
async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const jettonMaster = Address.parse(resolveJettonMaster(ctx.deployment));
    const master = ctx.provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const owner = ctx.provider.sender().address;
    if (!owner) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const walletAddress = await master.getGetWalletAddress(owner);
    const predicted = await BurnJettonMaster.predictWalletAddress(jettonMaster, owner);
    const onChainBalance = await readJettonWalletBalance(ctx.provider, jettonMaster, owner);

    let historySample: Awaited<ReturnType<typeof fetchJettonTransferHistorySample>> = [];
    try {
        historySample = await fetchJettonTransferHistorySample(owner, {
            jettonMaster,
            limit: 15,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return [
            {
                ok: false,
                message: `N/A: tonapi history fetch failed — ${msg}`,
            },
        ];
    }

    return checkWalletBalanceConsistency({
        walletAddress: walletAddress.toString({ urlSafe: true, bounceable: true }),
        predictedWalletAddress: predicted.toString({ urlSafe: true, bounceable: true }),
        onChainBalance,
        historySample: historySample.map((h) => ({
            amountNano: h.amountNano,
            direction: h.direction,
            netNano: h.netNano,
        })),
    });
}

const scenario: Scenario = {
    id: 'wallet-balance-consistency',
    title: 'Wallet address + balance vs transfer history',
    description:
        'Readonly: resolves getWalletAddress, reads balance, samples tonapi JettonTransfer history. Explicit N/A when history is empty.',
    tags: ['burn', 'readonly'],
    needsLiveTx: false,
    run,
};

export default scenario;
