/**
 * fs-gov-against-defeated — against vote → finalize Defeated; no Timelock queue.
 *
 * IMP-TNFS-F25: invents a fresh Param proposal (lower quorum than Treasury),
 * CastVote support=false with locked VP, finalize after endTime → PS_DEFEATED.
 * Does not reuse for-voted Treasury proposals (Already voted / Succeeded).
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    NA_LAB_TIMERS_NOT_SHORTENED,
    PS_DEFEATED,
    TYPE_PARAM,
    checkAgainstDefeated,
    ensureLockedVotingPower,
    fetchVotingPower,
    governorContract,
    naWhenGovTimeDependent,
    naWhenLockedVpUnfundable,
    openGovernor,
    openProposal,
    parameterChangePayload,
    pendingAbsentForProposal,
    readPendingAction,
    resolveGovActor,
    resolveGovMaxWaitSec,
    timelockAddress,
    waitForProposalState,
    waitUntilUnix,
} from '../lib/gov';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const time = await naWhenGovTimeDependent(ctx);
    if (time) {
        return time;
    }
    return naWhenLockedVpUnfundable(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const actor = resolveGovActor(ctx);
    const sender = provider.sender().address;
    if (!sender || !sender.equals(actor)) {
        throw new Error('Mnemonic wallet must equal gov actor for against-vote.');
    }

    await ensureLockedVotingPower(ctx);

    const timelock = Address.parse(manifest.addresses.timelock);
    // Harmless ParamChange: target Timelock + dummy method (never executed on Defeated).
    const payload = parameterChangePayload(timelock, 0x99);
    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);

    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCreateProposal(contractProvider, provider.sender(), {
        proposalType: TYPE_PARAM,
        payload,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(8_000);

    const gov = openGovernor(ctx);
    const count = await gov.getGetProposalCount();
    if (count <= 0n) {
        throw new Error('CreateProposal did not increment proposal_count');
    }
    const id = count - 1n;
    const addr = await gov.getGetProposal(id);
    if (!addr) {
        throw new Error(
            `get_proposal(${id}) is null — CreateProposal soft-cancelled (check locked VP / totalVp)`,
        );
    }

    const proposal = openProposal(provider, addr);
    const startTime = Number(await proposal.getGetStartTime());
    const maxWait = resolveGovMaxWaitSec();
    const ready = await waitUntilUnix(startTime, maxWait);
    if (!ready) {
        throw new Error(
            `${NA_LAB_TIMERS_NOT_SHORTENED}: voting opens at ${startTime}, maxWait=${maxWait}s`,
        );
    }

    const againstBefore = await proposal.getGetAgainstVotes();
    const already = await proposal.getHasVoted(actor);
    if (!already) {
        const vp = await fetchVotingPower(ctx, actor);
        const seqnoV = await getSenderSeqno(provider);
        await contract.sendCastVote(contractProvider, provider.sender(), {
            proposalId: id,
            support: false,
            claimedVp: vp,
        });
        await waitForSenderSeqnoIncrement(provider, seqnoV);

        let hasVoted = await proposal.getHasVoted(actor);
        for (let i = 0; i < 10 && !hasVoted; i += 1) {
            await sleepMs(3_000);
            hasVoted = await proposal.getHasVoted(actor);
        }
        if (!hasVoted) {
            throw new Error(`Against CastVote did not record hasVoted for id=${id}`);
        }
    }

    const againstVotes = await proposal.getGetAgainstVotes();
    if (againstVotes <= againstBefore) {
        throw new Error(
            `againstVotes did not increase (${againstBefore} → ${againstVotes}) for id=${id}`,
        );
    }

    const endTime = Number(await proposal.getGetEndTime());
    const endReady = await waitUntilUnix(endTime + 1, maxWait);
    if (!endReady) {
        throw new Error(
            `${NA_LAB_TIMERS_NOT_SHORTENED}: voting ends at ${endTime}, maxWait=${maxWait}s`,
        );
    }

    const seqnoF = await getSenderSeqno(provider);
    await proposal.sendFinalize(provider.sender());
    await waitForSenderSeqnoIncrement(provider, seqnoF);

    const stateAfter = await waitForProposalState(provider, addr, PS_DEFEATED);
    const pending = await readPendingAction(provider, timelockAddress(ctx), id);

    return checkAgainstDefeated({
        stateAfter,
        againstVotes: await proposal.getGetAgainstVotes(),
        // IMP-TNFS-F32: attribute by proposal address — the Timelock survives
        // lab redeploys and a stale pending from an OLD Governor's proposal can
        // collide with this fresh Governor's small sequential id.
        pendingAbsent: pendingAbsentForProposal(pending, addr),
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-against-defeated',
    title: 'Gov against → Defeated',
    description:
        'Fresh Param proposal; CastVote against with locked VP; finalize → Defeated; no Timelock pending.',
    tags: ['governance'],
    needsLiveTx: true,
    depends_on: ['fs-gov-vote-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
