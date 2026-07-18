/**
 * fs-jetton-transfer-self-conservation — self-transfer: burn+legs+net conserve (0.5/0.3/0.2).
 */
import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    assertSenderFeePreflight,
    readFeeConfigActive,
    readJettonWalletBalance,
    TRANSFER_AMOUNT,
} from '../lib/balances';
import {
    checkSelfTransferConservation,
    resolveFeeTestSender,
    TRANSFER_TON,
    totalFeeOf,
} from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    const sender = resolveFeeTestSender(ctx);
    const active = await readFeeConfigActive(ctx.provider, jettonMaster, sender);
    if (!active) {
        return 'fee config inactive — run sync:fee:testnet or redeploy';
    }
    return null;
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const sender = resolveFeeTestSender(ctx);

    const walletSender = provider.sender().address;
    if (!walletSender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }
    if (!walletSender.equals(sender)) {
        throw new Error(
            `Mnemonic wallet ${walletSender.toString()} must equal FEE_TEST_SENDER ${sender.toString()}.`,
        );
    }

    const before = await readJettonWalletBalance(provider, jettonMaster, sender);
    await assertSenderFeePreflight(provider, jettonMaster, sender, before);

    const senderWalletAddr = await master.getGetWalletAddress(sender);
    const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));
    const amount = TRANSFER_AMOUNT;

    console.log(
        `[fs-jetton-transfer-self-conservation] self-transfer ${amount} nano (expect −${totalFeeOf(amount)} total fee)…`,
    );
    const seqnoBefore = await getSenderSeqno(provider);
    await senderWallet.sendTransfer(provider.sender(), {
        jettonAmount: amount,
        destinationOwner: sender,
        responseDestination: sender,
        value: TRANSFER_TON,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    let after = await readJettonWalletBalance(provider, jettonMaster, sender);
    for (let attempt = 0; attempt < 5 && after === before; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        after = await readJettonWalletBalance(provider, jettonMaster, sender);
    }

    return checkSelfTransferConservation({ before, after, amount });
}

export const scenario: Scenario = {
    id: 'fs-jetton-transfer-self-conservation',
    title: 'Self-transfer fee conservation (0.5/0.3/0.2)',
    description:
        'Live self-transfer of 1 BURN: balance drops by total fee only (net returns). Mirrors sandbox conservation.',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-fee-split'],
    naWhen,
    run: runChecks,
};

export default scenario;
