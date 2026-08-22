/**
 * fs-jetton-transfer-insufficient-gas — attach at fee-path gate → reject/bounce.
 * Pass ONLY if transfer rejected; balances unchanged (no false-pass if recipient credited).
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
        throw new Error('FEE_TEST_RECIPIENT must differ from sender for insufficient-gas.');
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

    // Strict `>` gate: attach exactly MIN_TON_FEE_PATH_NANO (1.0 TON after F17) must reject.
    const attachNano = MIN_TON_FEE_PATH_NANO;
    console.log(
        `[fs-jetton-transfer-insufficient-gas] probing attach=${attachNano} nano (fee-path gate; expect reject)…`,
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
    id: 'fs-jetton-transfer-insufficient-gas',
    title: 'Insufficient-gas transfer (expected reject)',
    description:
        'Attach at fee-path gate (1.0 TON, F17). Passes only when transfer is rejected/bounced and balances unchanged — never if recipient is credited.',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    // IMP-TNFS-F32: gate-level probe attach. Without the preflight a drained
    // actor makes V5R1 skip the send entirely — balances unchanged would
    // FALSE-PASS the "reject" assert without any transfer ever attempted.
    budget: { signer: 'actor', minTon: MIN_TON_FEE_PATH_NANO + toNano('0.2') },
    depends_on: ['fs-jetton-transfer-ok'],
    naWhen,
    run: runChecks,
};

export default scenario;
