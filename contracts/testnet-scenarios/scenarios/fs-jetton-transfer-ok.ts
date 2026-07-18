/**
 * fs-jetton-transfer-ok — happy-path balances after full-stack fee (recipient 0.99 on 1 BURN).
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
    checkTransferOkBalances,
    requireFeeTestRecipient,
    resolveFeeTestSender,
    TRANSFER_TON,
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
        throw new Error('FEE_TEST_RECIPIENT must differ from sender for transfer-ok.');
    }

    const senderBefore = await readJettonWalletBalance(provider, jettonMaster, sender);
    await assertSenderFeePreflight(provider, jettonMaster, sender, senderBefore);
    const recipientBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);
    const supplyBefore = (await master.getGetJettonData()).totalSupply;

    const senderWalletAddr = await master.getGetWalletAddress(sender);
    const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

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
    for (
        let attempt = 0;
        attempt < 5 && recipientAfter === recipientBefore;
        attempt += 1
    ) {
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
    id: 'fs-jetton-transfer-ok',
    title: 'Happy-path fee transfer balances',
    description:
        'Send 1 BURN fee-bearing transfer; assert recipient 0.99, sender −1, supply −0.005 (0.5/0.3/0.2).',
    tags: ['jetton'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-master-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
