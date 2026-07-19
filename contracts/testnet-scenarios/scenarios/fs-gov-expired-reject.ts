/**
 * fs-gov-expired-reject — vote after voting window ends must not record the voter.
 * Shared / long lab timers → N/A (09A policy). Expected reject → pass.
 */
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    NA_LAB_TIMERS_NOT_SHORTENED,
    checkExpiredVoteRejected,
    fetchVotingPower,
    governorContract,
    naWhenGovExpired,
    openProposal,
    resolveGovActor,
    resolveGovMaxWaitSec,
    resolveLatestProposalAddr,
    waitUntilUnix,
} from '../lib/gov';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovExpired(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const actor = resolveGovActor(ctx);
    const sender = provider.sender().address;
    if (!sender || !sender.equals(actor)) {
        throw new Error('Mnemonic wallet must equal gov actor for expired-vote probe.');
    }

    const latest = await resolveLatestProposalAddr(ctx);
    if (!latest) {
        throw new Error('No proposal found — run fs-gov-propose-happy first.');
    }

    const proposal = openProposal(provider, latest.addr);
    const endTime = Number(await proposal.getGetEndTime());
    const maxWait = resolveGovMaxWaitSec();
    const ready = await waitUntilUnix(endTime + 1, maxWait);
    if (!ready) {
        throw new Error(
            `${NA_LAB_TIMERS_NOT_SHORTENED}: voting ends at ${endTime}, maxWait=${maxWait}s`,
        );
    }

    const hasVotedBefore = await proposal.getHasVoted(actor);
    const forBefore = await proposal.getGetForVotes();
    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);

    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCastVote(contractProvider, provider.sender(), {
        proposalId: latest.id,
        support: true,
        claimedVp: claimedVp > 0n ? claimedVp : 1n,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(8_000);

    const forAfter = await proposal.getGetForVotes();
    const hasVotedAfter = await proposal.getHasVoted(actor);
    const nowUnix = Math.floor(Date.now() / 1000);

    return checkExpiredVoteRejected({
        hasVotedBefore,
        hasVotedAfter,
        forVotesBefore: forBefore,
        forVotesAfter: forAfter,
        nowUnix,
        endTimeUnix: endTime,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-expired-reject',
    title: 'Gov expired vote reject',
    description: 'CastVote after endTime must not record the voter (window closed).',
    tags: ['governance', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-gov-propose-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
