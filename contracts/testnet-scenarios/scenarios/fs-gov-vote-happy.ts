/**
 * fs-gov-vote-happy — CastVote with staking VP after cancel-lag window.
 *
 * IMP-TNFS-F13: the target proposal is selected state-aware (skip Cancelled/
 * Executed/Defeated); when no votable proposal exists on the tip (e.g.
 * fs-gov-cancel left the latest Cancelled), the scenario creates a fresh one
 * itself — mirroring fs-gov-cancel's ensureCancellableProposal pattern — so
 * the governance tag stays re-runnable regardless of scenario ordering.
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    NA_LAB_TIMERS_NOT_SHORTENED,
    SPEND_AMOUNT_HAPPY,
    TYPE_TREASURY,
    checkVoteRecorded,
    fetchVotingPower,
    governorContract,
    naWhenGovTimeDependent,
    openProposal,
    resolveGovActor,
    resolveGovMaxWaitSec,
    resolveSpendRecipient,
    resolveUsableProposal,
    treasurySpendPayload,
    waitUntilUnix,
    type UsableProposal,
} from '../lib/gov';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovTimeDependent(ctx);
}

/**
 * Find a votable proposal; when none exists, create a fresh one
 * (propose → caller waits cancel lag → vote).
 */
async function ensureVotableProposal(ctx: ScenarioContext): Promise<UsableProposal> {
    const { provider, manifest } = ctx;
    const existing = await resolveUsableProposal(ctx, 'votable');
    if (existing) {
        return existing;
    }

    const actor = resolveGovActor(ctx);
    const treasury = Address.parse(manifest.addresses.treasury);
    const recipient = resolveSpendRecipient(ctx);
    const payload = treasurySpendPayload(
        treasury,
        recipient,
        SPEND_AMOUNT_HAPPY,
        'tnfs-f13-vote-happy',
    );
    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);
    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCreateProposal(contractProvider, provider.sender(), {
        proposalType: TYPE_TREASURY,
        payload,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(8_000);

    const created = await resolveUsableProposal(ctx, 'votable');
    if (!created) {
        throw new Error(
            'CreateProposal for vote-happy did not yield a votable proposal (check actor VP / cancel lag).',
        );
    }
    return created;
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const actor = resolveGovActor(ctx);
    const sender = provider.sender().address;
    if (!sender || !sender.equals(actor)) {
        throw new Error('Mnemonic wallet must equal gov actor for CastVote.');
    }

    const target = await ensureVotableProposal(ctx);

    const proposal = openProposal(provider, target.addr);
    const startTime = Number(await proposal.getGetStartTime());
    const maxWait = resolveGovMaxWaitSec();
    const ready = await waitUntilUnix(startTime, maxWait);
    if (!ready) {
        throw new Error(
            `${NA_LAB_TIMERS_NOT_SHORTENED}: voting opens at ${startTime}, maxWait=${maxWait}s`,
        );
    }

    const already = await proposal.getHasVoted(actor);
    const forBefore = await proposal.getGetForVotes();
    if (already) {
        return checkVoteRecorded({
            forVotesBefore: forBefore > 0n ? forBefore - 1n : 0n,
            forVotesAfter: forBefore,
            hasVoted: true,
        }).map((c) =>
            c.name === 'has-voted'
                ? { ...c, message: `${c.message} (idempotent — already voted id=${target.id})` }
                : c,
        );
    }

    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);
    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCastVote(contractProvider, provider.sender(), {
        proposalId: target.id,
        support: true,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    // Allow staking relay + ProposalVoteApply to settle.
    let hasVoted = await proposal.getHasVoted(actor);
    let forAfter = await proposal.getGetForVotes();
    for (let i = 0; i < 10 && !hasVoted; i += 1) {
        await new Promise((r) => setTimeout(r, 3_000));
        hasVoted = await proposal.getHasVoted(actor);
        forAfter = await proposal.getGetForVotes();
    }

    return checkVoteRecorded({
        forVotesBefore: forBefore,
        forVotesAfter: forAfter,
        hasVoted,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-vote-happy',
    title: 'Gov vote happy',
    description: 'CastVote with staking VP after cancel-lag; assert vote recorded.',
    tags: ['governance'],
    needsLiveTx: true,
    depends_on: ['fs-gov-propose-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
