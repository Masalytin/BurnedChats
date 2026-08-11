/**
 * fs-jetton-excluded-insufficient-gas — excluded sender attach at minTonFeePath
 * → reject; balances unchanged (IMP-MNAUD-F11 / F16 / IMP-TNFS-F21).
 *
 * After F11, claimed-excluded uses the same entry gate as the fee path.
 */
import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { MIN_TON_FEE_PATH_NANO } from '../../scripts/lib/estimateJettonTransferTon';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    MIN_SENDER_BALANCE,
    readJettonWalletBalance,
    TRANSFER_AMOUNT,
} from '../lib/balances';
import {
    NA_EXCLUDED_SENDER_MISMATCH,
    NA_EXCLUDED_SENDER_UNAVAILABLE,
    NA_SENDER_NOT_EXCLUDED,
    checkInsufficientGasOutcome,
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

    // Strict `>` gate: attach exactly minTonFeePath must reject (F11).
    const attachNano = MIN_TON_FEE_PATH_NANO;
    console.log(
        `[fs-jetton-excluded-insufficient-gas] probing attach=${attachNano} nano (fee-path gate; expect reject)…`,
    );

    const seqnoBefore = await getSenderSeqno(provider);
    await senderWallet.sendTransfer(provider.sender(), {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: sender,
        value: attachNano,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    const senderAfter = await readJettonWalletBalance(provider, jettonMaster, sender);
    const recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);

    return checkInsufficientGasOutcome({
        recipientDelta: recipientAfter - recipientBefore,
        senderJettonDelta: senderAfter - senderBefore,
        attachNano,
    });
}

export const scenario: Scenario = {
    id: 'fs-jetton-excluded-insufficient-gas',
    title: 'Excluded-path insufficient gas (F11/F16 gate)',
    description:
        'Excluded sender attach at minTonFeePath (2.05 TON). Pass only when transfer is rejected and balances unchanged.',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-ops-deployment-fingerprint'],
    naWhen,
    run: runChecks,
};

export default scenario;
