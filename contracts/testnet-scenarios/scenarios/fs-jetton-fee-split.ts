/**
 * fs-jetton-fee-split — live 1 BURN fee split (0.5% burn / 0.3% staking / 0.2% treasury).
 */
import { Address, toNano } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { check } from '../lib/checks';
import {
    EXIT_FEE_CONFIG_INACTIVE,
    EXPECTED_BURN,
    EXPECTED_NET,
    FEE_SPLIT_EXPECTED,
    TRANSFER_AMOUNT,
    assertSenderFeePreflight,
    parseEnvAddress,
    readFeeConfigActive,
    readJettonWalletBalance,
} from '../lib/balances';
import { resolveFeeTestSender } from '../lib/matrix-checks';
import {
    naWhenMnemonicNotTestActor,
    NA_TEST_ACTOR_UNSET,
} from '../lib/test-actor';
import {
    fetchLatestJettonTransferEvent,
    tonapiHost,
    tonviewerTxUrl,
    verifyFeeSplitEventStructure,
} from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

const TRANSFER_TON = toNano('3.5');

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    let sender: Address;
    try {
        sender = resolveFeeTestSender(ctx);
    } catch {
        return NA_TEST_ACTOR_UNSET;
    }
    const senderNa = naWhenMnemonicNotTestActor(ctx, sender);
    if (senderNa) {
        return senderNa;
    }
    if (!parseEnvAddress('FEE_TEST_RECIPIENT')) {
        return 'FEE_TEST_RECIPIENT not set';
    }
    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    const active = await readFeeConfigActive(ctx.provider, jettonMaster, sender);
    if (!active) {
        return `fee config inactive (exit ${EXIT_FEE_CONFIG_INACTIVE}) — run sync:fee:testnet or redeploy`;
    }
    return null;
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const host = tonapiHost('testnet');
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const checks: CheckResult[] = [];

    const sender = resolveFeeTestSender(ctx);
    const recipient = parseEnvAddress('FEE_TEST_RECIPIENT');
    if (!recipient) {
        throw new Error(
            'Set FEE_TEST_RECIPIENT to a non-excluded TON owner (distinct from sender) in .env.testnet.',
        );
    }

    const walletSender = provider.sender().address;
    if (!walletSender || !walletSender.equals(sender)) {
        throw new Error(
            `Blueprint signer must equal Actor A FEE_TEST_SENDER ${sender.toString()} (set TEST_ACTOR_MNEMONIC).`,
        );
    }

    const recipientExcluded = await master.getGetIsExcluded(recipient);
    if (recipientExcluded) {
        throw new Error(`FEE_TEST_RECIPIENT ${recipient.toString()} must be non-excluded.`);
    }

    // Airdrop mint receiver fee config smoke (IMP-JETTON-FEE-03)
    const airdropRaw = manifest.addresses.airdropHolder;
    if (airdropRaw) {
        const airdrop = Address.parse(airdropRaw);
        const airdropExcluded = await master.getGetIsExcluded(airdrop);
        const airdropFeeActive = await readFeeConfigActive(provider, jettonMaster, airdrop);
        checks.push(
            check('airdrop-non-excluded', !airdropExcluded, 'airdrop holder is non-excluded'),
        );
        checks.push(
            check(
                'airdrop-fee-active',
                airdropFeeActive,
                'airdrop holder get_fee_config_active=true after bootstrap mint',
            ),
        );
    }

    const senderBalance = await readJettonWalletBalance(provider, jettonMaster, sender);
    await assertSenderFeePreflight(provider, jettonMaster, sender, senderBalance);

    const recipientBalanceBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);
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

    const latest = await fetchLatestJettonTransferEvent(host, sender);
    if (!latest?.event_id) {
        throw new Error('Could not resolve tonapi event after fee-bearing transfer (indexing lag?).');
    }
    const feeSplitEventId = latest.event_id;

    const recipientBalanceAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
    const supplyAfter = (await master.getGetJettonData()).totalSupply;
    const netReceived = recipientBalanceAfter - recipientBalanceBefore;
    const supplyDelta = supplyAfter - supplyBefore;

    checks.push(
        check(
            'recipient-net',
            netReceived === EXPECTED_NET,
            `recipient received ${netReceived} nano (expected ${EXPECTED_NET} = 0.99 BURN)`,
        ),
    );
    checks.push(
        check(
            'supply-burn',
            supplyDelta === -EXPECTED_BURN,
            `totalSupply decreased by ${-supplyDelta} nano (expected ${EXPECTED_BURN} = 0.005 BURN)`,
        ),
    );

    const recipientFeeActive = await readFeeConfigActive(provider, jettonMaster, recipient);
    checks.push(
        check(
            'propagate-fee-config',
            recipientFeeActive,
            'recipient get_fee_config_active=true after fee transfer (no manual sync:fee:testnet)',
        ),
    );

    const eventChecks = await verifyFeeSplitEventStructure(host, feeSplitEventId, FEE_SPLIT_EXPECTED);
    checks.push(...eventChecks);
    checks.push(
        check(
            'tonviewer-url',
            true,
            `fee-split tx: ${tonviewerTxUrl('testnet', feeSplitEventId)}`,
        ),
    );

    return checks;
}

export const scenario: Scenario = {
    id: 'fs-jetton-fee-split',
    title: 'Live jetton fee split 0.5/0.3/0.2',
    description:
        'Send 1 BURN fee-bearing transfer; assert recipient 0.99, burn 0.005, staking 0.003, treasury 0.002.',
    tags: ['jetton', 'fee'],
    needsLiveTx: true,
    depends_on: ['fs-ops-deployment-fingerprint'],
    naWhen,
    run: runChecks,
};

export default scenario;
