import { Address, toNano } from '@ton/core';
import { resolveJettonMaster } from '../../scripts/deploy/manifest';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { checkPlainTonCashback } from '../lib/tep89-cashback-checks';
import {
    fetchAccountBalanceNano,
    resolvePlainTonCashbackHops,
    waitForCashbackBalance,
} from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/** Minimal accidental plain-TON probe — matches sandbox IMP-RELAY-04 (0.05 TON). */
const PLAIN_TON_PROBE = toNano('0.05');

/**
 * Live: send empty-body TON to the jetton master; expect cashback to sender
 * without a Master↔wallet relay loop (IMP-RELAY-04).
 */
async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const jettonMaster = Address.parse(resolveJettonMaster(ctx.deployment));
    const sender = ctx.provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const balanceBefore = await fetchAccountBalanceNano(sender);
    if (balanceBefore < PLAIN_TON_PROBE + toNano('0.05')) {
        throw new Error(
            `Sender TON balance ${balanceBefore} nano too low for plain-TON cashback probe ` +
                `(need ≥ ${PLAIN_TON_PROBE + toNano('0.05')} nano).`,
        );
    }

    console.log(
        `[plain-ton-cashback-master] sending ${PLAIN_TON_PROBE} nano empty-body to master (expect cashback)…`,
    );
    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await ctx.provider.sender().send({
        to: jettonMaster,
        value: PLAIN_TON_PROBE,
        bounce: true,
    });
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);

    const balanceAfter = await waitForCashbackBalance({
        sender,
        balanceBefore,
        sentNano: PLAIN_TON_PROBE,
    });
    const hopCount = await resolvePlainTonCashbackHops(jettonMaster, sender);

    return checkPlainTonCashback({
        sentNano: PLAIN_TON_PROBE,
        balanceBefore,
        balanceAfter,
        hopCount,
    });
}

const scenario: Scenario = {
    id: 'plain-ton-cashback-master',
    title: 'Plain-TON cashback on master (no relay loop)',
    description:
        'Sends a minimal empty-body TON amount to the jetton master; asserts the sender receives cashback and related hops stay within the sandbox relay-loop bound (≤5).',
    tags: ['burn'],
    needsLiveTx: true,
    run,
};

export default scenario;
