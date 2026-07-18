/**
 * fs-jetton-wallet-balance-consistency — readonly getWalletAddress + balance vs history sample.
 */
import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { readJettonWalletBalance } from '../lib/balances';
import { check } from '../lib/checks';
import { checkWalletBalanceConsistency, resolveFeeTestSender } from '../lib/matrix-checks';
import { fetchJettonTransferHistorySample, tonapiHost } from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const owner = resolveFeeTestSender(ctx);

    const walletAddress = await master.getGetWalletAddress(owner);
    const predicted = await BurnJettonMaster.predictWalletAddress(jettonMaster, owner);
    const onChainBalance = await readJettonWalletBalance(provider, jettonMaster, owner);

    const host = tonapiHost('testnet');
    let historySample: Awaited<ReturnType<typeof fetchJettonTransferHistorySample>> = [];
    try {
        historySample = await fetchJettonTransferHistorySample(host, owner, {
            jettonMaster,
            limit: 15,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return [
            check('history-fetch', false, `N/A: tonapi history fetch failed — ${msg}`),
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

export const scenario: Scenario = {
    id: 'fs-jetton-wallet-balance-consistency',
    title: 'Wallet address + balance vs transfer history',
    description:
        'Readonly: getWalletAddress, on-chain balance, tonapi JettonTransfer sample. Explicit N/A when history is empty.',
    tags: ['jetton', 'readonly'],
    needsLiveTx: false,
    depends_on: ['fs-jetton-transfer-ok'],
    run: runChecks,
};

export default scenario;
