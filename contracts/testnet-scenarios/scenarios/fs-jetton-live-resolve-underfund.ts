/**
 * fs-jetton-live-resolve-underfund — mid-band attach between excluded and fee
 * floors with forwardTonAmount ≥ 1 TON → wallet exit 32113, balances unchanged
 * (IMP-MNAUD-F10 / IMP-TNFS-F20). Distinct from exact-gate
 * `fs-jetton-transfer-insufficient-gas` (attach == minTonFeePath, no forward).
 */
import { Address, toNano } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { MIN_TON_FEE_PATH_NANO } from '../../scripts/lib/estimateJettonTransferTon';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    MIN_SENDER_BALANCE,
    readFeeConfigActive,
    readJettonWalletBalance,
    TRANSFER_AMOUNT,
} from '../lib/balances';
import {
    checkInsufficientGasOutcome,
    requireFeeTestRecipient,
    resolveFeeTestSender,
} from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/** forwardTonAmount that triggers the live-resolve / mid-band path (F10). */
export const LIVE_RESOLVE_FORWARD_TON = toNano('1');
/**
 * Mid-band attach: above excluded floor (~0.58) but well below fee-path gate
 * (2.05 + forward + hops). Card: ≈1.7 TON after F16.
 */
export const LIVE_RESOLVE_UNDERFUND_ATTACH = toNano('1.7');

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    const sender = resolveFeeTestSender(ctx);
    const active = await readFeeConfigActive(ctx.provider, jettonMaster, sender);
    if (!active) {
        return 'fee config inactive — run sync:fee:testnet or redeploy';
    }
    // Guard: mid-band must stay strictly below the fee-path gate + forward.
    if (LIVE_RESOLVE_UNDERFUND_ATTACH >= MIN_TON_FEE_PATH_NANO + LIVE_RESOLVE_FORWARD_TON) {
        return 'live-resolve underfund attach no longer mid-band vs F16 floors — update scenario constants';
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
        throw new Error('FEE_TEST_RECIPIENT must differ from sender for live-resolve underfund.');
    }

    const senderBefore = await readJettonWalletBalance(provider, jettonMaster, sender);
    if (senderBefore < MIN_SENDER_BALANCE) {
        throw new Error(
            `Sender balance ${senderBefore} nano < ${MIN_SENDER_BALANCE} nano (need margin even though transfer should reject).`,
        );
    }
    const recipientBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);

    const senderWalletAddr = await master.getGetWalletAddress(sender);
    const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

    const attachNano = LIVE_RESOLVE_UNDERFUND_ATTACH;
    console.log(
        `[fs-jetton-live-resolve-underfund] probing attach=${attachNano} nano ` +
            `forward=${LIVE_RESOLVE_FORWARD_TON} nano (mid-band; expect reject / 32113)…`,
    );

    const seqnoBefore = await getSenderSeqno(provider);
    await senderWallet.sendTransfer(provider.sender(), {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: sender,
        forwardTonAmount: LIVE_RESOLVE_FORWARD_TON,
        value: attachNano,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    const senderAfter = await readJettonWalletBalance(provider, jettonMaster, sender);
    const recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);

    return checkInsufficientGasOutcome({
        recipientDelta: recipientAfter - recipientBefore,
        senderJettonDelta: senderAfter - senderBefore,
        attachNano,
    }).map((c) =>
        c.name === 'insufficient-gas-rejected'
            ? {
                  ...c,
                  name: 'live-resolve-underfund-rejected',
                  message: `${c.message} (F10 mid-band forward=1 TON)`,
              }
            : c,
    );
}

export const scenario: Scenario = {
    id: 'fs-jetton-live-resolve-underfund',
    title: 'Jetton live-resolve mid-band underfund (F10)',
    description:
        'Non-excluded transfer with forwardTonAmount=1 TON and attach≈1.7 TON must reject (32113); balances unchanged.',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-ops-deployment-fingerprint'],
    naWhen,
    run: runChecks,
};

export default scenario;
