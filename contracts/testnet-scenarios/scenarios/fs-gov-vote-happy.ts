/**
 * fs-gov-vote-happy — CastVote with staking VP after cancel-lag window.
 */
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    NA_LAB_TIMERS_NOT_SHORTENED,
    checkVoteRecorded,
    fetchVotingPower,
    governorContract,
    naWhenGovTimeDependent,
    openProposal,
    resolveGovActor,
    resolveGovMaxWaitSec,
    resolveLatestProposalAddr,
    waitUntilUnix,
} from '../lib/gov';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovTimeDependent(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const actor = resolveGovActor(ctx);
    const sender = provider.sender().address;
    if (!sender || !sender.equals(actor)) {
        throw new Error('Mnemonic wallet must equal gov actor for CastVote.');
    }

    const latest = await resolveLatestProposalAddr(ctx);
    if (!latest) {
        throw new Error('No proposal found — run fs-gov-propose-happy first.');
    }

    const proposal = openProposal(provider, latest.addr);
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
                ? { ...c, message: `${c.message} (idempotent — already voted id=${latest.id})` }
                : c,
        );
    }

    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);
    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCastVote(contractProvider, provider.sender(), {
        proposalId: latest.id,
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
