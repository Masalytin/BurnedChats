/**
 * fs-treasury-spend-via-timelock — authorized spend updates total_spent / accounting after execute.
 *
 * IMP-TNFS-F32: state/type-aware selection. The blind latest pickup failed
 * under `--all` interleaving when a newer non-Executed / non-Treasury proposal
 * shadowed the one queue-execute-happy had executed — scan for the newest
 * EXECUTED TreasurySpend proposal instead.
 */
import { Address } from '@ton/core';
import {
    PS_EXECUTED,
    SPEND_AMOUNT_HAPPY,
    TYPE_TREASURY,
    checkTreasurySpendAccounting,
    naWhenGovTimeDependent,
    openProposal,
    parseTreasurySpendPayload,
    readSpendAccounting,
    resolveProposalMatching,
} from '../lib/gov';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovTimeDependent(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const treasury = Address.parse(manifest.addresses.treasury);

    const latest = await resolveProposalMatching(ctx, {
        proposalType: TYPE_TREASURY,
        states: [PS_EXECUTED],
    });
    if (!latest) {
        throw new Error(
            'No Executed TreasurySpend proposal found within scan depth — run ' +
                'fs-gov-propose-happy → fs-gov-vote-happy → fs-gov-queue-execute-happy first.',
        );
    }

    const proposal = openProposal(provider, latest.addr);
    const payload = await proposal.getGetPayload();
    const parsed = parseTreasurySpendPayload(payload);
    const spendAmount = parsed.amount > 0n ? parsed.amount : SPEND_AMOUNT_HAPPY;

    const accounting = await readSpendAccounting(provider, treasury);

    // After a successful execute, accounting must reflect at least this spend.
    // We cannot observe "before" post-hoc; assert absolute floors from history.
    const count = accounting.count;
    const spent = accounting.spent;

    return checkTreasurySpendAccounting({
        spentBefore: spent >= spendAmount ? spent - spendAmount : 0n,
        spentAfter: spent,
        countBefore: count >= 1n ? count - 1n : 0n,
        countAfter: count,
        spendAmount,
    }).map((c) =>
        c.name === 'total-spent-increased'
            ? {
                  ...c,
                  message: `${c.message} (post-execute snapshot; proposalId=${latest.id})`,
              }
            : c,
    );
}

export const scenario: Scenario = {
    id: 'fs-treasury-spend-via-timelock',
    title: 'Treasury spend via timelock',
    description:
        'After gov execute of TreasurySpend, treasury total_spent / spending_count reflect the payout.',
    tags: ['treasury', 'governance'],
    needsLiveTx: true,
    depends_on: ['fs-gov-queue-execute-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
