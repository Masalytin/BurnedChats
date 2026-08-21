/**
 * fs-gov-double-vote-reject — second CastVote rejected / no double count.
 * Expected reject → pass; wrong accept (forVotes↑) → fail.
 *
 * IMP-TNFS-F32: self-contained target selection. Blind latest-proposal pickup
 * broke under `--all` interleaving (other gov scenarios create proposals
 * between vote-happy and this probe). Preference order:
 * 1. an Active proposal the actor ALREADY voted on with ≥30s window left;
 * 2. otherwise ensure a votable proposal (reuse or fresh) and cast the first
 *    vote here, then probe the double vote.
 */
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    MIN_VOTE_WINDOW_REMAINING_SEC,
    NA_LAB_TIMERS_NOT_SHORTENED,
    PS_ACTIVE,
    checkDoubleVoteRejected,
    ensureLockedVotingPower,
    ensureVotableProposal,
    fetchVotingPower,
    governorContract,
    naWhenGovTimeDependent,
    naWhenLockedVpUnfundable,
    openProposal,
    resolveGovActor,
    resolveGovMaxWaitSec,
    resolveProposalMatching,
    waitUntilUnix,
} from '../lib/gov';
import { sleepMs } from '../lib/treasury';
import type { Address } from '@ton/core';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const time = await naWhenGovTimeDependent(ctx);
    if (time) {
        return time;
    }
    // Self-contained path may need a fresh proposal → locked VP must be fundable.
    return naWhenLockedVpUnfundable(ctx);
}

/** Active proposal already voted by the actor, or first-vote a votable one. */
async function ensureVotedProposal(
    ctx: ScenarioContext,
    actor: Address,
): Promise<{ id: bigint; addr: Address }> {
    const voted = await resolveProposalMatching(ctx, {
        states: [PS_ACTIVE],
        votedBy: actor,
        minWindowRemainingSec: MIN_VOTE_WINDOW_REMAINING_SEC,
    });
    if (voted) {
        return voted;
    }

    await ensureLockedVotingPower(ctx);
    const target = await ensureVotableProposal(ctx, 'tnfs-f32-double-vote');

    const { provider } = ctx;
    const proposal = openProposal(provider, target.addr);
    const startTime = Number(await proposal.getGetStartTime());
    const maxWait = resolveGovMaxWaitSec();
    const ready = await waitUntilUnix(startTime, maxWait);
    if (!ready) {
        throw new Error(
            `${NA_LAB_TIMERS_NOT_SHORTENED}: voting opens at ${startTime}, maxWait=${maxWait}s`,
        );
    }

    if (!(await proposal.getHasVoted(actor))) {
        const claimedVp = await fetchVotingPower(ctx, actor);
        const { contract, contractProvider } = governorContract(ctx);
        const seqnoBefore = await getSenderSeqno(provider);
        await contract.sendCastVote(contractProvider, provider.sender(), {
            proposalId: target.id,
            support: true,
            claimedVp,
        });
        await waitForSenderSeqnoIncrement(provider, seqnoBefore);

        let hasVoted = await proposal.getHasVoted(actor);
        for (let i = 0; i < 10 && !hasVoted; i += 1) {
            await sleepMs(3_000);
            hasVoted = await proposal.getHasVoted(actor);
        }
        if (!hasVoted) {
            throw new Error(`First CastVote did not record hasVoted for id=${target.id}`);
        }
    }
    return target;
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const actor = resolveGovActor(ctx);
    const sender = provider.sender().address;
    if (!sender || !sender.equals(actor)) {
        throw new Error('Mnemonic wallet must equal gov actor for double-vote probe.');
    }

    const target = await ensureVotedProposal(ctx, actor);
    const proposal = openProposal(provider, target.addr);

    const forBefore = await proposal.getGetForVotes();
    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);

    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCastVote(contractProvider, provider.sender(), {
        proposalId: target.id,
        support: true,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(8_000);

    const forAfter = await proposal.getGetForVotes();
    const stillVoted = await proposal.getHasVoted(actor);

    return checkDoubleVoteRejected({
        forVotesBefore: forBefore,
        forVotesAfter: forAfter,
        hasVoted: stillVoted,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-double-vote-reject',
    title: 'Gov double-vote reject',
    description: 'Second CastVote after hasVoted must not increase forVotes (Already voted).',
    tags: ['governance', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-gov-vote-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
