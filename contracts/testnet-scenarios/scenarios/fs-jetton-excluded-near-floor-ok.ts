/**
 * fs-jetton-excluded-near-floor-ok — excluded sender attach ≈ 0.60 TON → full
 * amount credited (IMP-MNAUD-F16 / IMP-TNFS-F21).
 */
import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    MIN_SENDER_BALANCE,
    readJettonWalletBalance,
    TRANSFER_AMOUNT,
} from '../lib/balances';
import {
    EXCLUDED_NEAR_FLOOR_ATTACH_NANO,
    NA_EXCLUDED_SENDER_MISMATCH,
    NA_EXCLUDED_SENDER_UNAVAILABLE,
    NA_SENDER_NOT_EXCLUDED,
    checkExcludedTransferOkBalances,
    requireFeeTestRecipient,
    resolveExcludedFeeSender,
} from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    let excluded: Address;
    try {
        excluded = resolveExcludedFeeSender(ctx);
    } catch {
        return NA_EXCLUDED_SENDER_UNAVAILABLE;
    }
    const sender = ctx.provider.sender().address;
    if (!sender || !sender.equals(excluded)) {
        return NA_EXCLUDED_SENDER_MISMATCH;
    }
    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    const master = ctx.provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const isExcluded = await master.getGetIsExcluded(excluded);
    if (!isExcluded) {
        return NA_SENDER_NOT_EXCLUDED;
    }
    return null;
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const sender = resolveExcludedFeeSender(ctx);
    const recipient = requireFeeTestRecipient();

    const walletSender = provider.sender().address;
    if (!walletSender || !walletSender.equals(sender)) {
        throw new Error(NA_EXCLUDED_SENDER_MISMATCH);
    }
    if (recipient.equals(sender)) {
        throw new Error('FEE_TEST_RECIPIENT must differ from excluded sender.');
    }

    const senderBefore = await readJettonWalletBalance(provider, jettonMaster, sender);
    if (senderBefore < MIN_SENDER_BALANCE) {
        throw new Error(`Excluded sender BURN ${senderBefore} < ${MIN_SENDER_BALANCE}`);
    }
    const recipientBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);

    const senderWalletAddr = await master.getGetWalletAddress(sender);
    const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

    const attachNano = EXCLUDED_NEAR_FLOOR_ATTACH_NANO;
    console.log(
        `[fs-jetton-excluded-near-floor-ok] probing attach=${attachNano} nano (excluded near-floor; expect full credit)…`,
    );

    const seqnoBefore = await getSenderSeqno(provider);
    await senderWallet.sendTransfer(provider.sender(), {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: sender,
        value: attachNano,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    let recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
    let senderAfter = await readJettonWalletBalance(provider, jettonMaster, sender);
    for (let attempt = 0; attempt < 5 && recipientAfter === recipientBefore; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
        senderAfter = await readJettonWalletBalance(provider, jettonMaster, sender);
    }

    return checkExcludedTransferOkBalances({
        recipientDelta: recipientAfter - recipientBefore,
        senderDelta: senderAfter - senderBefore,
        amount: TRANSFER_AMOUNT,
    });
}

export const scenario: Scenario = {
    id: 'fs-jetton-excluded-near-floor-ok',
    title: 'Excluded-path near-floor ok (F16)',
    description:
        'Excluded sender attach ≈ 0.60 TON (above 0.58 gate) credits 100% amount with no fee legs.',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-ops-deployment-fingerprint'],
    naWhen,
    run: runChecks,
};

export default scenario;
