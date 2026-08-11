/**
 * fs-gov-feature-priority-execute — FeaturePriority (type 1) vote → finalize →
 * Governor.executeProposal; never Timelock-queued (IMP-TNFS-F26).
 */
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    NA_LAB_TIMERS_NOT_SHORTENED,
    PS_EXECUTED,
    PS_SUCCEEDED,
    TYPE_FEATURE,
    checkFeaturePriorityExecuted,
    ensureLockedVotingPower,
    featurePriorityPayload,
    fetchVotingPower,
    governorContract,
    naWhenGovTimeDependent,
    naWhenLockedVpUnfundable,
    openGovernor,
    openProposal,
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
    const { provider } = ctx;
    const actor = resolveGovActor(ctx);
    const sender = provider.sender().address;
    if (!sender || !sender.equals(actor)) {
        throw new Error('Mnemonic wallet must equal gov actor for FeaturePriority path.');
    }

    await ensureLockedVotingPower(ctx);

    const payload = featurePriorityPayload('tnfs-f26-feature-priority');
    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);

    const seqnoC = await getSenderSeqno(provider);
    await contract.sendCreateProposal(contractProvider, provider.sender(), {
        proposalType: TYPE_FEATURE,
        payload,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoC);
    await sleepMs(8_000);

    const gov = openGovernor(ctx);
    const id = (await gov.getGetProposalCount()) - 1n;
    const addr = await gov.getGetProposal(id);
    if (!addr) {
        throw new Error(`Feature CreateProposal id=${id} has null address (soft-cancel?)`);
    }

    const proposal = openProposal(provider, addr);
    const maxWait = resolveGovMaxWaitSec();
    const startTime = Number(await proposal.getGetStartTime());
    if (!(await waitUntilUnix(startTime, maxWait))) {
        throw new Error(
            `${NA_LAB_TIMERS_NOT_SHORTENED}: voting opens at ${startTime}, maxWait=${maxWait}s`,
        );
    }

    if (!(await proposal.getHasVoted(actor))) {
        const vp = await fetchVotingPower(ctx, actor);
        const seqnoV = await getSenderSeqno(provider);
        await contract.sendCastVote(contractProvider, provider.sender(), {
            proposalId: id,
            support: true,
            claimedVp: vp,
        });
        await waitForSenderSeqnoIncrement(provider, seqnoV);
        let hasVoted = await proposal.getHasVoted(actor);
        for (let i = 0; i < 10 && !hasVoted; i += 1) {
            await sleepMs(3_000);
            hasVoted = await proposal.getHasVoted(actor);
        }
        if (!hasVoted) {
            throw new Error(`Feature CastVote not recorded for id=${id}`);
        }
    }

    const endTime = Number(await proposal.getGetEndTime());
    if (!(await waitUntilUnix(endTime + 1, maxWait))) {
        throw new Error(
            `${NA_LAB_TIMERS_NOT_SHORTENED}: voting ends at ${endTime}, maxWait=${maxWait}s`,
        );
    }

    let state = await proposal.getGetState();
    if (state !== PS_SUCCEEDED && state !== PS_EXECUTED) {
        const seqnoF = await getSenderSeqno(provider);
        await proposal.sendFinalize(provider.sender());
        await waitForSenderSeqnoIncrement(provider, seqnoF);
        state = await waitForProposalState(provider, addr, PS_SUCCEEDED);
        if (state !== PS_SUCCEEDED && state !== PS_EXECUTED) {
            throw new Error(`Feature finalize expected Succeeded, got state=${state}`);
        }
    }

    const timelockAddr = timelockAddress(ctx);
    let pending = await readPendingAction(provider, timelockAddr, id);
    if (pending) {
        throw new Error(`FeaturePriority must not Timelock-queue (pending present id=${id})`);
    }

    if (state !== PS_EXECUTED) {
        const seqnoE = await getSenderSeqno(provider);
        await contract.sendExecuteProposal(contractProvider, provider.sender(), {
            proposalId: id,
        });
        await waitForSenderSeqnoIncrement(provider, seqnoE);
        state = await waitForProposalState(provider, addr, PS_EXECUTED);
    }

    pending = await readPendingAction(provider, timelockAddr, id);
    const proposalType = await proposal.getGetProposalType();

    return checkFeaturePriorityExecuted({
        proposalType,
        stateAfter: state,
        pendingAbsent: pending == null,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-feature-priority-execute',
    title: 'Gov FeaturePriority execute',
    description:
        'FeaturePriority propose→vote→finalize→Governor.executeProposal; assert Executed with no Timelock pending.',
    tags: ['governance'],
    needsLiveTx: true,
    depends_on: ['fs-gov-vote-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
