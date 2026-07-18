/**
 * fs-jetton-dust-transfer — dust gates: amount=0 reject; 1 nano fee truncation.
 */
import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    assertSenderFeePreflight,
    MIN_SENDER_BALANCE,
    readFeeConfigActive,
    readJettonWalletBalance,
} from '../lib/balances';
import {
    checkDustOneNano,
    checkDustZeroRejected,
    requireFeeTestRecipient,
    resolveFeeTestSender,
    TRANSFER_TON,
} from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

const DUST_ONE = 1n;

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
    const recipient = requireFeeTestRecipient();

    const walletSender = provider.sender().address;
    if (!walletSender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }
    if (!walletSender.equals(sender)) {
        throw new Error(
            `Mnemonic wallet ${walletSender.toString()} must equal FEE_TEST_SENDER ${sender.toString()}.`,
        );
    }
    if (recipient.equals(sender)) {
        throw new Error('FEE_TEST_RECIPIENT must differ from sender for dust-transfer.');
    }

    const senderBalance = await readJettonWalletBalance(provider, jettonMaster, sender);
    if (senderBalance < MIN_SENDER_BALANCE) {
        throw new Error(
            `Sender balance ${senderBalance} nano < ${MIN_SENDER_BALANCE} nano.`,
        );
    }
    await assertSenderFeePreflight(provider, jettonMaster, sender, senderBalance);

    const senderWalletAddr = await master.getGetWalletAddress(sender);
    const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

    // 1) Zero amount → reject (wallet gate: amount > 0)
    const senderBefore0 = await readJettonWalletBalance(provider, jettonMaster, sender);
    const recipientBefore0 = await readJettonWalletBalance(provider, jettonMaster, recipient);
    let seqno = await getSenderSeqno(provider);
    await senderWallet.sendTransfer(provider.sender(), {
        jettonAmount: 0n,
        destinationOwner: recipient,
        responseDestination: sender,
        value: TRANSFER_TON,
    });
    await waitForSenderSeqnoIncrement(provider, seqno);

    const checks: CheckResult[] = [
        ...checkDustZeroRejected({
            recipientDelta:
                (await readJettonWalletBalance(provider, jettonMaster, recipient)) -
                recipientBefore0,
            senderJettonDelta:
                (await readJettonWalletBalance(provider, jettonMaster, sender)) - senderBefore0,
        }),
    ];

    // 2) 1 nano → succeeds; fees truncate to 0
    const recipientBefore1 = await readJettonWalletBalance(provider, jettonMaster, recipient);
    seqno = await getSenderSeqno(provider);
    await senderWallet.sendTransfer(provider.sender(), {
        jettonAmount: DUST_ONE,
        destinationOwner: recipient,
        responseDestination: sender,
        value: TRANSFER_TON,
    });
    await waitForSenderSeqnoIncrement(provider, seqno);

    let recipientAfter1 = await readJettonWalletBalance(provider, jettonMaster, recipient);
    for (
        let attempt = 0;
        attempt < 5 && recipientAfter1 === recipientBefore1;
        attempt += 1
    ) {
        await new Promise((r) => setTimeout(r, 2_000));
        recipientAfter1 = await readJettonWalletBalance(provider, jettonMaster, recipient);
    }

    checks.push(
        ...checkDustOneNano({
            recipientDelta: recipientAfter1 - recipientBefore1,
            amount: DUST_ONE,
        }),
    );

    return checks;
}

export const scenario: Scenario = {
    id: 'fs-jetton-dust-transfer',
    title: 'Dust transfer gates',
    description:
        'Zero-amount rejected (balances unchanged); 1-nano transfer succeeds with fee truncation under 0.5/0.3/0.2.',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-fee-split'],
    naWhen,
    run: runChecks,
};

export default scenario;
