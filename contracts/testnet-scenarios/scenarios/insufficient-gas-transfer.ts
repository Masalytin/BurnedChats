import { Address } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { resolveJettonMaster } from '../../scripts/deploy/manifest';
import { MIN_TON_BURN_PATH_NANO } from '../../scripts/lib/estimateJettonTransferTon';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    MIN_SENDER_BALANCE,
    TRANSFER_AMOUNT,
    parseRecipientAddress,
    readJettonWalletBalance,
} from '../lib/balances';
import { checkInsufficientGasOutcome } from '../lib/matrix-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/**
 * Live expected-fail: attach exactly at the burn-path gate (strict `>` → reject).
 * Passes only when jettons do not move — never a false-pass if value reaches the recipient.
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
            'VERIFY_RECIPIENT / BURN_TEST_RECIPIENT must differ from the mnemonic wallet for insufficient-gas-transfer.',
        );
    }

    const senderBefore = await readJettonWalletBalance(ctx.provider, jettonMaster, walletSender);
    if (senderBefore < MIN_SENDER_BALANCE) {
        throw new Error(
            `Sender balance ${senderBefore} nano < ${MIN_SENDER_BALANCE} nano (need margin even though transfer should reject).`,
        );
    }

    const recipientBefore = await readJettonWalletBalance(ctx.provider, jettonMaster, recipient);
    const senderWalletAddr = await master.getGetWalletAddress(walletSender);
    const senderWallet = ctx.provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

    const attachNano = MIN_TON_BURN_PATH_NANO;
    console.log(
        `[insufficient-gas-transfer] probing attach=${attachNano} nano (burn-path gate; expect reject)…`,
    );

    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await senderWallet.sendTransfer(ctx.provider.sender(), {
        jettonAmount: TRANSFER_AMOUNT,
        destinationOwner: recipient,
        responseDestination: walletSender,
        value: attachNano,
    });
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);

    const senderAfter = await readJettonWalletBalance(ctx.provider, jettonMaster, walletSender);
    const recipientAfter = await readJettonWalletBalance(ctx.provider, jettonMaster, recipient);

    return checkInsufficientGasOutcome({
        recipientDelta: recipientAfter - recipientBefore,
        senderJettonDelta: senderAfter - senderBefore,
        attachNano,
    });
}

const scenario: Scenario = {
    id: 'insufficient-gas-transfer',
    title: 'Insufficient-gas transfer (expected reject)',
    description:
        'Sends a 1 BURN transfer with attach at the burn-path gate (0.66 TON). Expects on-chain reject/bounce; fails if the recipient is credited.',
    tags: ['burn'],
    needsLiveTx: true,
    run,
};

export default scenario;
