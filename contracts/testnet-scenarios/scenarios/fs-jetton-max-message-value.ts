/**
 * fs-jetton-max-message-value — large TON attach does not break fee accounting.
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
    checkMaxMessageValueAccounting,
    MAX_MESSAGE_VALUE_TON,
    requireFeeTestRecipient,
    resolveFeeTestSender,
} from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/** Margin beyond large attach for wallet fees / bounce reserve. */
const TON_MARGIN = toNano('0.1');

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    const sender = resolveFeeTestSender(ctx);
    const active = await readFeeConfigActive(ctx.provider, jettonMaster, sender);
    if (!active) {
        return 'fee config inactive — run sync:fee:testnet or redeploy';
    }
    const walletSender = ctx.provider.sender().address;
    if (!walletSender) {
        return 'mnemonic wallet unavailable';
    }
    // Soft N/A when TON balance looks drained — cannot attach 10 TON.
    try {
        const state = await ctx.provider.provider(walletSender).getState();
        if (state.balance < MAX_MESSAGE_VALUE_TON + TON_MARGIN) {
            return `wallet drained / low TON balance (${state.balance} nano) for large attach`;
        }
    } catch {
        // proceed; live send will fail loudly if TON is insufficient
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
        throw new Error('FEE_TEST_RECIPIENT must differ from sender for max-message-value.');
    }

    const senderBefore = await readJettonWalletBalance(provider, jettonMaster, sender);
    await assertSenderFeePreflight(provider, jettonMaster, sender, senderBefore);
    const recipientBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);
    const supplyBefore = (await master.getGetJettonData()).totalSupply;

    const senderWalletAddr = await master.getGetWalletAddress(sender);
    const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

    const attachNano = MAX_MESSAGE_VALUE_TON;
    console.log(
        `[fs-jetton-max-message-value] transfer 1 BURN with attach=${attachNano} nano…`,
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
    let supplyAfter = (await master.getGetJettonData()).totalSupply;
    for (
        let attempt = 0;
        attempt < 5 && recipientAfter === recipientBefore;
        attempt += 1
    ) {
        await new Promise((r) => setTimeout(r, 2_000));
        recipientAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
        supplyAfter = (await master.getGetJettonData()).totalSupply;
    }

    return checkMaxMessageValueAccounting({
        recipientDelta: recipientAfter - recipientBefore,
        supplyDelta: supplyAfter - supplyBefore,
        amount: TRANSFER_AMOUNT,
        attachNano,
    });
}

export const scenario: Scenario = {
    id: 'fs-jetton-max-message-value',
    title: 'Large attach value fee accounting',
    description:
        'Fee-bearing 1 BURN transfer with large TON attach (10 TON); jetton fee legs still 0.5/0.3/0.2.',
    tags: ['jetton', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-transfer-ok'],
    naWhen,
    run: runChecks,
};

export default scenario;
