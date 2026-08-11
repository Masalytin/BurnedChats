/**
 * fs-gov-flexible-vp-vote-reject — Flexible-only stake cannot CastVote
 * (IMP-TNFS-F24 / IMP-FAUDIT-F01 flash-stake gate).
 *
 * Invert of fs-gov-vote-happy: do NOT open locked-tier stake. Prefer Actor A when
 * locked-beyond VP is 0; otherwise lab deployer whale Flexible stake.
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    NA_LAB_TIMERS_NOT_SHORTENED,
    SPEND_AMOUNT_HAPPY,
    TYPE_TREASURY,
    checkFlexibleVpVoteRejected,
    computeLockedBeyondVp,
    ensureLockedVotingPower,
    estimateFreshVoteEndTime,
    fetchVotingPower,
    governorContract,
    naWhenFlexibleVpVoteReject,
    openProposal,
    readActorStakeRecords,
    readTierMultipliers,
    resolveDeployerSender,
    resolveFlexibleOnlyVoter,
    resolveGovActor,
    resolveGovMaxWaitSec,
    resolveSpendRecipient,
    resolveStakingLockAddr,
    resolveUsableProposal,
    treasurySpendPayload,
    waitUntilUnix,
    type UsableProposal,
} from '../lib/gov';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export const naWhen = naWhenFlexibleVpVoteReject;

/**
 * Reuse an existing votable proposal; otherwise create one with Blueprint
 * Actor A after ensuring locked-tier VP (CreateProposal needs it — F07/F15).
 * Flexible-only voter casts afterward and must not be the proposer path.
 */
async function ensureVotableProposal(ctx: ScenarioContext): Promise<UsableProposal> {
    const existing = await resolveUsableProposal(ctx, 'votable');
    if (existing) {
        return existing;
    }

    // Proposer needs locked-beyond VP; Flexible-only voter was already resolved
    // separately (usually deployer whale Flexible).
    await ensureLockedVotingPower(ctx);

    const actor = resolveGovActor(ctx);
    const treasury = Address.parse(ctx.manifest.addresses.treasury);
    const recipient = resolveSpendRecipient(ctx);
    const payload = treasurySpendPayload(
        treasury,
        recipient,
        SPEND_AMOUNT_HAPPY,
        'tnfs-f24-flexible-reject',
    );
    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);
    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await contract.sendCreateProposal(contractProvider, ctx.provider.sender(), {
        proposalType: TYPE_TREASURY,
        payload,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);

    for (let attempt = 0; attempt < 12; attempt += 1) {
        await sleepMs(5_000);
        const created = await resolveUsableProposal(ctx, 'votable');
        if (created) {
            return created;
        }
    }

    throw new Error(
        'CreateProposal for flexible-vp-reject did not yield a votable proposal ' +
            'after locked-VP stake + poll — check Actor A eligibility / tip timers.',
    );
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const voter = await resolveFlexibleOnlyVoter(ctx);
    if (!voter) {
        throw new Error('Flexible-only voter unresolved after naWhen passed');
    }

    const voteEndTime = await estimateFreshVoteEndTime(ctx);
    const stakingLock = await resolveStakingLockAddr(ctx);
    const multipliers = await readTierMultipliers(ctx, stakingLock);
    const lockedBeyondVp = computeLockedBeyondVp(
        await readActorStakeRecords(ctx, voter.address),
        multipliers,
        voteEndTime,
    );
    const claimedVp = await fetchVotingPower(ctx, voter.address);

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

    const already = await proposal.getHasVoted(voter.address);
    if (already) {
        throw new Error(
            `Flexible-only voter already voted on proposal id=${target.id} — pick a fresh proposal.`,
        );
    }

    const forBefore = await proposal.getGetForVotes();
    const { contract, contractProvider } = governorContract(ctx);

    console.log(
        `[fs-gov-flexible-vp-vote-reject] voter=${voter.address.toString({
            urlSafe: true,
            bounceable: true,
        })} via=${voter.via} claimedVp=${claimedVp} lockedBeyond=${lockedBeyondVp}`,
    );

    if (voter.via === 'blueprint') {
        const sender = provider.sender().address;
        if (!sender || !sender.equals(voter.address)) {
            throw new Error('Mnemonic wallet must equal Flexible-only Blueprint actor.');
        }
        const seqnoBefore = await getSenderSeqno(provider);
        await contract.sendCastVote(contractProvider, provider.sender(), {
            proposalId: target.id,
            support: true,
            claimedVp,
        });
        await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    } else {
        const deployer = await resolveDeployerSender(ctx);
        const seqnoBefore = await deployer.getSeqno();
        await contract.sendCastVote(contractProvider, deployer.sender, {
            proposalId: target.id,
            support: true,
            claimedVp,
        });
        await deployer.waitSeqnoIncrement(seqnoBefore);
    }

    // Allow staking relay settle; vote must NOT land.
    let hasVoted = await proposal.getHasVoted(voter.address);
    let forAfter = await proposal.getGetForVotes();
    for (let i = 0; i < 8; i += 1) {
        await sleepMs(3_000);
        hasVoted = await proposal.getHasVoted(voter.address);
        forAfter = await proposal.getGetForVotes();
        if (hasVoted) {
            break;
        }
    }

    return checkFlexibleVpVoteRejected({
        lockedBeyondVp,
        claimedVp,
        hasVoted,
        forVotesBefore: forBefore,
        forVotesAfter: forAfter,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-flexible-vp-vote-reject',
    title: 'Gov Flexible-only VP vote reject',
    description:
        'CastVote with Flexible-only stake must leave hasVoted=false and forVotes unchanged ' +
        '(flash-stake gate). Lab short timers; shared → N/A.',
    tags: ['governance', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-gov-vote-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
