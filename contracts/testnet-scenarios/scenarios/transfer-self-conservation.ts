import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { resolveJettonMaster } from '../../scripts/deploy/manifest';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    MIN_SENDER_BALANCE,
    TRANSFER_AMOUNT,
    TRANSFER_TON,
    readJettonWalletBalance,
} from '../lib/balances';
import { checkSelfTransferConservation } from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/**
 * Live self-transfer: burn leg leaves the wallet, net returns — same conservation as sandbox.
 */
async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const jettonMaster = Address.parse(resolveJettonMaster(ctx.deployment));
    const master = ctx.provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const walletSender = ctx.provider.sender().address;
    if (!walletSender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const before = await readJettonWalletBalance(ctx.provider, jettonMaster, walletSender);
    if (before < MIN_SENDER_BALANCE) {
        throw new Error(
            `Sender balance ${before} nano < ${MIN_SENDER_BALANCE} nano (need >= 2 BURN for self-transfer + margin).`,
        );
    }

    const senderWalletAddr = await master.getGetWalletAddress(walletSender);
    const senderWallet = ctx.provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));
    const amount = TRANSFER_AMOUNT;

    console.log('[transfer-self-conservation] sending self-transfer…');
    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await senderWallet.sendTransfer(ctx.provider.sender(), {
        jettonAmount: amount,
        destinationOwner: walletSender,
        responseDestination: walletSender,
        value: TRANSFER_TON,
    });
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);

    // Indexer / wallet settle: re-read until conservation holds or a short retry budget elapses.
    let after = await readJettonWalletBalance(ctx.provider, jettonMaster, walletSender);
    for (let attempt = 0; attempt < 5 && after === before; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        after = await readJettonWalletBalance(ctx.provider, jettonMaster, walletSender);
    }

    return checkSelfTransferConservation({ before, after, amount });
}

const scenario: Scenario = {
    id: 'transfer-self-conservation',
    title: 'Self-transfer burn+net conservation',
    description:
        'Live self-transfer of 1 BURN: wallet balance drops by burn only (net returns). Mirrors sandbox conservation.',
    tags: ['burn'],
    needsLiveTx: true,
    run,
};

export default scenario;
