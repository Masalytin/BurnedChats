/**
 * fs-jetton-fee-near-floor-ok — non-excluded attach ≈ 1.01 TON (just above the
 * F17 fee gate 1.0) → fee-split success (IMP-MNAUD-F16/F17 / IMP-TNFS-F21).
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
    FEE_NEAR_FLOOR_ATTACH_NANO,
    checkTransferOkBalances,
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
        throw new Error('FEE_TEST_RECIPIENT must differ from sender for fee-near-floor-ok.');
    }

    const senderBefore = await readJettonWalletBalance(provider, jettonMaster, sender);
    await assertSenderFeePreflight(provider, jettonMaster, sender, senderBefore);
    const recipientBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);
    const supplyBefore = (await master.getGetJettonData()).totalSupply;

    const senderWalletAddr = await master.getGetWalletAddress(sender);
    const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

    const attachNano = FEE_NEAR_FLOOR_ATTACH_NANO;
    console.log(
        `[fs-jetton-fee-near-floor-ok] probing attach=${attachNano} nano (fee near-floor; expect fee-split credit)…`,
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
    let supplyAfter = (await master.getGetJettonData()).totalSupply;
    for (let attempt = 0; attempt < 5 && recipientAfter === recipientBefore; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
        senderAfter = await readJettonWalletBalance(provider, jettonMaster, sender);
        supplyAfter = (await master.getGetJettonData()).totalSupply;
    }

    return checkTransferOkBalances({
        recipientDelta: recipientAfter - recipientBefore,
        senderDelta: senderAfter - senderBefore,
        supplyDelta: supplyAfter - supplyBefore,
        amount: TRANSFER_AMOUNT,
    });
}

export const scenario: Scenario = {
    id: 'fs-jetton-fee-near-floor-ok',
    title: 'Fee-path near-floor ok (F16)',
    description:
        'Non-excluded attach ≈ 1.01 TON (above the 1.0 F17 gate) completes fee-split (0.5/0.3/0.2); not native DEX 0.05–0.3.',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-ops-deployment-fingerprint'],
    naWhen,
    run: runChecks,
};

export default scenario;
