import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { resolveJettonMaster } from '../../scripts/deploy/manifest';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    MIN_SENDER_BALANCE,
    TRANSFER_AMOUNT,
    TRANSFER_TON,
    parseRecipientAddress,
    readJettonWalletBalance,
} from '../lib/balances';
import { burnOf, checkBurnSupplyDelta } from '../lib/matrix-checks';
import { fetchLatestJettonTransferEvent, verifyBurnEvent } from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/**
 * Live burn-notification path: transfer triggers JettonBurnNotification → totalSupply drops by burnOf(amount).
 */
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
            'VERIFY_RECIPIENT / BURN_TEST_RECIPIENT must differ from the mnemonic wallet (self-transfer hides the burn/net split for supply spot-checks).',
        );
    }

    const senderBalance = await readJettonWalletBalance(ctx.provider, jettonMaster, walletSender);
    if (senderBalance < MIN_SENDER_BALANCE) {
        throw new Error(
            `Sender balance ${senderBalance} nano < ${MIN_SENDER_BALANCE} nano (need >= 2 BURN).`,
        );
    }

    const amount = TRANSFER_AMOUNT;
    const supplyBefore = (await master.getGetJettonData()).totalSupply;
    const senderWalletAddr = await master.getGetWalletAddress(walletSender);
    const senderWallet = ctx.provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

    console.log(
        `[burn-notification-supply] transferring ${amount} nano (expect supply −${burnOf(amount)})…`,
    );
    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await senderWallet.sendTransfer(ctx.provider.sender(), {
        jettonAmount: amount,
        destinationOwner: recipient,
        responseDestination: walletSender,
        value: TRANSFER_TON,
    });
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);

    let supplyAfter = (await master.getGetJettonData()).totalSupply;
    for (let attempt = 0; attempt < 5 && supplyAfter === supplyBefore; attempt += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        supplyAfter = (await master.getGetJettonData()).totalSupply;
    }

    const checks: CheckResult[] = [
        ...checkBurnSupplyDelta({
            supplyDelta: supplyAfter - supplyBefore,
            amount,
        }),
    ];

    const latest = await fetchLatestJettonTransferEvent(walletSender);
    if (latest?.event_id) {
        console.log(`[burn-notification-supply] burn event_id=${latest.event_id}`);
        checks.push(...(await verifyBurnEvent(latest.event_id)));
    } else {
        checks.push({
            ok: false,
            message:
                'could not resolve tonapi JettonTransfer event after burn-notification transfer (indexing lag?)',
        });
    }

    return checks;
}

const scenario: Scenario = {
    id: 'burn-notification-supply',
    title: 'Burn notification reduces totalSupply',
    description:
        'Live transfer through the burn-notification path; asserts totalSupply decreases by burnOf(amount) and burn-only out_msg shape.',
    tags: ['burn'],
    needsLiveTx: true,
    run,
};

export default scenario;
