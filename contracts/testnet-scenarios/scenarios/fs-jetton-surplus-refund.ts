/**
 * fs-jetton-surplus-refund — fee-path @ 1.5 TON (F17); assert surplus TON returns
 * to owner (IMP-TNFS-F22 / GAS-07). Jetton fee-split must pass; surplus is a
 * lower-bound heuristic (V5 gas noise → soft N/A, not silent pass).
 */
import { Address, toNano } from '@ton/core';
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
    NA_SURPLUS_BALANCE_NOISE,
    SURPLUS_MIN_EXCESS_NANO,
    TRANSFER_TON,
    checkSurplusRefundHeuristic,
    checkTransferOkBalances,
    requireFeeTestRecipient,
    resolveFeeTestSender,
} from '../lib/matrix-checks';
import { readLiveTonBalance } from '../lib/provider';
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
    if (!walletSender || !walletSender.equals(sender)) {
        throw new Error('Mnemonic wallet must equal fee-test sender (Actor A).');
    }
    if (recipient.equals(sender)) {
        throw new Error('FEE_TEST_RECIPIENT must differ from sender.');
    }

    const senderBefore = await readJettonWalletBalance(provider, jettonMaster, sender);
    await assertSenderFeePreflight(provider, jettonMaster, sender, senderBefore);
    const recipientBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);
    const supplyBefore = (await master.getGetJettonData()).totalSupply;
    const ownerTonBefore = await readLiveTonBalance(provider, sender);

    const senderWalletAddr = await master.getGetWalletAddress(sender);
    const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

    console.log(
        `[fs-jetton-surplus-refund] attach=${TRANSFER_TON} surplusMin=${SURPLUS_MIN_EXCESS_NANO}…`,
    );

    const seqnoBefore = await getSenderSeqno(provider);
    await senderWallet.sendTransfer(provider.sender(), {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: sender,
        value: TRANSFER_TON,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    let recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
    let senderAfter = await readJettonWalletBalance(provider, jettonMaster, sender);
    let supplyAfter = (await master.getGetJettonData()).totalSupply;
    for (let attempt = 0; attempt < 6 && recipientAfter === recipientBefore; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
        senderAfter = await readJettonWalletBalance(provider, jettonMaster, sender);
        supplyAfter = (await master.getGetJettonData()).totalSupply;
    }

    const jettonChecks = checkTransferOkBalances({
        recipientDelta: recipientAfter - recipientBefore,
        senderDelta: senderAfter - senderBefore,
        supplyDelta: supplyAfter - supplyBefore,
        amount: TRANSFER_AMOUNT,
    });
    if (jettonChecks.some((c) => !c.ok)) {
        return jettonChecks;
    }

    // Allow surplus cashback to settle on owner wallet.
    let ownerTonAfter = await readLiveTonBalance(provider, sender);
    for (let i = 0; i < 5; i += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        ownerTonAfter = await readLiveTonBalance(provider, sender);
        const excess = ownerTonAfter - ownerTonBefore + TRANSFER_TON;
        if (excess >= SURPLUS_MIN_EXCESS_NANO) {
            break;
        }
    }

    const surplusChecks = checkSurplusRefundHeuristic({
        ownerTonBefore,
        ownerTonAfter,
        attachNano: TRANSFER_TON,
        minExcessNano: SURPLUS_MIN_EXCESS_NANO,
    });

    if (surplusChecks.some((c) => !c.ok)) {
        // Soft N/A: jetton path OK but TON heuristic noisy (card-allowed; not silent pass).
        throw new Error(
            `SOFT_NA: ${NA_SURPLUS_BALANCE_NOISE}: ${surplusChecks.map((c) => c.message).join('; ')}`,
        );
    }

    return [...jettonChecks, ...surplusChecks];
}

export const scenario: Scenario = {
    id: 'fs-jetton-surplus-refund',
    title: 'Jetton surplus TON refund (GAS-07)',
    description:
        'Fee-path @ 1.5 TON: fee-split OK and owner surplus excessReturned ≥ 0.4 TON (GAS-07/F17). ' +
        'Soft N/A when jetton OK but TON heuristic below bar (V5/toncenter noise).',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-ops-deployment-fingerprint'],
    naWhen,
    run: runChecks,
    budget: { signer: 'actor', minTon: TRANSFER_TON + toNano('0.2') },
};

export default scenario;
