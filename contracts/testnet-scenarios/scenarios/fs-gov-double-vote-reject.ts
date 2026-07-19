/**
 * fs-gov-double-vote-reject — second CastVote rejected / no double count.
 * Expected reject → pass; wrong accept (forVotes↑) → fail.
 */
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    checkDoubleVoteRejected,
    fetchVotingPower,
    governorContract,
    naWhenGovTimeDependent,
    openProposal,
    resolveGovActor,
    resolveLatestProposalAddr,
} from '../lib/gov';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovTimeDependent(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const actor = resolveGovActor(ctx);
    const sender = provider.sender().address;
    if (!sender || !sender.equals(actor)) {
        throw new Error('Mnemonic wallet must equal gov actor for double-vote probe.');
    }

    const latest = await resolveLatestProposalAddr(ctx);
    if (!latest) {
        throw new Error('No proposal found — run fs-gov-vote-happy first.');
    }

    const proposal = openProposal(provider, latest.addr);
    const hasVoted = await proposal.getHasVoted(actor);
    if (!hasVoted) {
        throw new Error(
            `Voter ${actor.toString()} has not voted yet — run fs-gov-vote-happy first.`,
        );
    }

    const forBefore = await proposal.getGetForVotes();
    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);

    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCastVote(contractProvider, provider.sender(), {
        proposalId: latest.id,
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
