/**
 * fs-gov-payload-treasury-spend — payload targets canonical treasury (happy path).
 * Wrong-treasury reject is IMP-TNFS-09B.
 */
import { Address } from '@ton/core';
import {
    TYPE_TREASURY,
    checkPayloadTargetsTreasury,
    naWhenGovTimeDependent,
    openProposal,
    parseTreasurySpendPayload,
    resolveLatestProposalAddr,
} from '../lib/gov';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovTimeDependent(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const canonical = Address.parse(manifest.addresses.treasury);

    const latest = await resolveLatestProposalAddr(ctx);
    if (!latest) {
        throw new Error('No proposal found — run fs-gov-propose-happy first.');
    }

    const proposal = openProposal(provider, latest.addr);
    const proposalType = await proposal.getGetProposalType();
    if (Number(proposalType) !== TYPE_TREASURY) {
        throw new Error(
            `Expected TreasurySpend proposal type ${TYPE_TREASURY}, got ${proposalType}`,
        );
    }

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
