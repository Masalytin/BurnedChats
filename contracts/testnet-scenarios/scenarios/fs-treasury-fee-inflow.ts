/**
 * fs-treasury-fee-inflow — after 1 BURN fee transfer, treasury JW / total_received ↑ by 0.2% leg.
 * Tolerance: exact match (see lib/treasury.ts + decision log).
 */
import { Address, toNano } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    EXIT_FEE_CONFIG_INACTIVE,
    TRANSFER_AMOUNT,
    assertSenderFeePreflight,
    parseEnvAddress,
    readFeeConfigActive,
    readJettonWalletBalance,
} from '../lib/balances';
import {
    NA_NO_FEE_RECIPIENT,
    NA_NO_FEE_SENDER,
    TRANSFER_TON,
    TREASURY_LEG_ON_1_BURN,
    checkFeeInflow,
    readTreasuryJettonBalance,
    readTreasuryReceived,
    requireFeeRecipient,
    resolveFeeSender,
    waitForTreasuryInflow,
} from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    if (
        !ctx.manifest.addresses.airdropHolder &&
        !parseEnvAddress('FEE_TEST_SENDER', 'BURN_SMOKE_TEST_OWNER')
    ) {
        return NA_NO_FEE_SENDER;
    }
    if (!parseEnvAddress('FEE_TEST_RECIPIENT')) {
        return NA_NO_FEE_RECIPIENT;
    }
    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    const sender = resolveFeeSender(ctx);
    const active = await readFeeConfigActive(ctx.provider, jettonMaster, sender);
    if (!active) {
        return `fee config inactive (exit ${EXIT_FEE_CONFIG_INACTIVE}) — run sync:fee:testnet or redeploy`;
    }
    return null;
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const treasuryAddr = Address.parse(manifest.addresses.treasury);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));

    const sender = resolveFeeSender(ctx);
    const recipient = requireFeeRecipient();

    const walletSender = provider.sender().address;
    if (!walletSender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }
    if (!walletSender.equals(sender)) {
        throw new Error(
            `Mnemonic wallet ${walletSender.toString()} must equal FEE_TEST_SENDER ${sender.toString()} for live transfer.`,
        );
    }

    const recipientExcluded = await master.getGetIsExcluded(recipient);
    if (recipientExcluded) {
        throw new Error(`FEE_TEST_RECIPIENT ${recipient.toString()} must be non-excluded.`);
    }

    const senderBalance = await readJettonWalletBalance(provider, jettonMaster, sender);
    await assertSenderFeePreflight(provider, jettonMaster, sender, senderBalance);

    const receivedBefore = await readTreasuryReceived(provider, treasuryAddr);
    const walletBefore = await readTreasuryJettonBalance(provider, jettonMaster, treasuryAddr);

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

    const receivedAfter = await waitForTreasuryInflow(
        provider,
        treasuryAddr,
        receivedBefore,
        TREASURY_LEG_ON_1_BURN,
    );
    const walletAfter = await readTreasuryJettonBalance(provider, jettonMaster, treasuryAddr);

    return checkFeeInflow({
        receivedBefore,
        receivedAfter,
        walletBefore,
        walletAfter,
        expectedLeg: TREASURY_LEG_ON_1_BURN,
        transferAmount: TRANSFER_AMOUNT,
    });
}

export const scenario: Scenario = {
    id: 'fs-treasury-fee-inflow',
    title: 'Treasury fee inflow (0.2% leg)',
    description:
        'Send 1 BURN fee-bearing transfer; assert treasury jetton wallet and get_total_received increase by exact FEE_SPLIT_EXPECTED.treasury (0.002 BURN).',
    tags: ['treasury', 'fee'],
    needsLiveTx: true,
    // IMP-TNFS-F32: 3.5 TON fee-path attach — V5R1 silently skipped the
    // transfer on a 2.01 TON actor balance (live 2026-08-21, Δ=0 false FAIL).
    // The IMP-TNFS-F10 runner preflight turns that into honest N/A with the
    // top-up amount.
    budget: { signer: 'actor', minTon: TRANSFER_TON + toNano('0.2') },
    depends_on: ['fs-jetton-fee-split'],
    naWhen,
    run: runChecks,
};

export default scenario;
