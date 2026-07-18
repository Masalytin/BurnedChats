import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { resolveJettonMaster } from '../../scripts/deploy/manifest';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    MIN_SENDER_BALANCE,
    TRANSFER_AMOUNT,
    TRANSFER_TON,
    checkLiveBurnBalances,
    parseRecipientAddress,
    readJettonWalletBalance,
} from '../lib/balances';
import { fetchLatestJettonTransferEvent, verifyBurnEvent } from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const jettonMaster = Address.parse(resolveJettonMaster(ctx.deployment));
    const master = ctx.provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const recipient = parseRecipientAddress();
    const walletSender = ctx.provider.sender().address;
    if (!walletSender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }
    if (!recipient) {
        throw new Error(
            'Set VERIFY_RECIPIENT or BURN_TEST_RECIPIENT to a TON owner address (distinct from sender) in .env.testnet.',
        );
    }
    if (recipient.equals(walletSender)) {
        throw new Error(
            'VERIFY_RECIPIENT / BURN_TEST_RECIPIENT must differ from the mnemonic wallet (self-transfer hides the net leg).',
        );
    }

    const senderBalance = await readJettonWalletBalance(ctx.provider, jettonMaster, walletSender);
    if (senderBalance < MIN_SENDER_BALANCE) {
        throw new Error(
            `Sender balance ${senderBalance} nano < ${MIN_SENDER_BALANCE} nano (need >= 2 BURN for 1 BURN transfer + margin).`,
        );
    }

    const recipientBalanceBefore = await readJettonWalletBalance(ctx.provider, jettonMaster, recipient);
    const supplyBefore = (await master.getGetJettonData()).totalSupply;

    const senderWalletAddr = await master.getGetWalletAddress(walletSender);
    const senderWallet = ctx.provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

    console.log('[transfer-burn-1pct] sending 1 BURN transfer…');
    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await senderWallet.sendTransfer(ctx.provider.sender(), {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: walletSender,
        value: TRANSFER_TON,
    });
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);

    const latest = await fetchLatestJettonTransferEvent(walletSender);
    if (!latest?.event_id) {
        throw new Error('Could not resolve tonapi event after transfer (indexing lag?).');
    }
    console.log(`[transfer-burn-1pct] burn event_id=${latest.event_id}`);

    const recipientBalanceAfter = await readJettonWalletBalance(ctx.provider, jettonMaster, recipient);
    const supplyAfter = (await master.getGetJettonData()).totalSupply;
    const netReceived = recipientBalanceAfter - recipientBalanceBefore;
    const supplyDelta = supplyAfter - supplyBefore;

    const checks: CheckResult[] = [
        ...checkLiveBurnBalances({ netReceived, supplyDelta }),
        ...(await verifyBurnEvent(latest.event_id)),
    ];
    return checks;
}

const scenario: Scenario = {
    id: 'transfer-burn-1pct',
    title: 'Live 1% burn transfer',
    description:
        'Sends 1 BURN on testnet; expects recipient +0.99, supply −0.01, burn-only out_msg legs (former verify-burn-testnet live path).',
    tags: ['burn'],
    needsLiveTx: true,
    run,
};

export default scenario;
