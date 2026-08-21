/**
 * fs-gov-payload-treasury-spend — payload targets canonical treasury (happy path).
 * Wrong-treasury reject is IMP-TNFS-09B.
 *
 * IMP-TNFS-F32: type-aware selection. The blind latest pickup failed under
 * `--all` interleaving when a neighbouring scenario (against-defeated
 * ParamChange, cancel probe, …) created a newer non-Treasury proposal —
 * scan for the newest TreasurySpend proposal instead (any state: the probe
 * only reads the payload).
 */
import { Address } from '@ton/core';
import {
    TYPE_TREASURY,
    checkPayloadTargetsTreasury,
    naWhenGovTimeDependent,
    openProposal,
    parseTreasurySpendPayload,
    resolveProposalMatching,
} from '../lib/gov';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovTimeDependent(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const canonical = Address.parse(manifest.addresses.treasury);

    const latest = await resolveProposalMatching(ctx, { proposalType: TYPE_TREASURY });
    if (!latest) {
        throw new Error(
            'No TreasurySpend proposal found within scan depth — run fs-gov-propose-happy first.',
        );
    }

    const proposal = openProposal(provider, latest.addr);
    const payload = await proposal.getGetPayload();
    const parsed = parseTreasurySpendPayload(payload);

    return checkPayloadTargetsTreasury({
        payloadTreasury: parsed.treasury,
        canonicalTreasury: canonical,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-payload-treasury-spend',
    title: 'Gov payload targets treasury',
    description: 'TreasurySpend proposal payload targets canonical treasury from manifest.',
    tags: ['governance', 'treasury'],
    needsLiveTx: true,
    depends_on: ['fs-gov-queue-execute-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
