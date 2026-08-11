/**
 * fs-gov-emergency-execute — Emergency (type 3) vote → finalize → Timelock
 * queue delay=0 → execute (IMP-TNFS-F26).
 *
 * Uses a non-high-value dummy method so MNAUD-F03 floor does not block delay 0.
 * Soft N/A when locked VP cannot meet Emergency quorum (Flexible whale inflates totalVp).
 */
import { Address, beginCell } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    EMERGENCY_DUMMY_METHOD,
    NA_LAB_TIMERS_NOT_SHORTENED,
    PS_EXECUTED,
    PS_SUCCEEDED,
    TYPE_EMERGENCY,
    assertTimelockGovernorSender,
    checkEmergencyExecuted,
    computeLockedBeyondVp,
    emergencyPayload,
    ensureLockedVotingPower,
    estimateFreshVoteEndTime,
    fetchVotingPower,
    governorContract,
    naWhenGovTimeDependent,
    naWhenLockedVpUnfundable,
    openGovernor,
    openProposal,
    readActorStakeRecords,
    readPendingAction,
    readTierMultipliers,
    resolveGovActor,
    resolveGovMaxWaitSec,
    resolveStakingLockAddr,
    timelockAddress,
    timelockContract,
    waitForProposalState,
    waitUntilUnix,
} from '../lib/gov';
import { resolveTimelockGovernorSender } from '../lib/multisig';
import { openStakingMaster } from '../lib/staking';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export const NA_EMERGENCY_QUORUM_UNREACHABLE =
    'insufficient locked VP for Emergency quorum (Flexible whale inflates totalVp)';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const time = await naWhenGovTimeDependent(ctx);
    if (time) {
        return time;
    }
    return naWhenLockedVpUnfundable(ctx);
}

/**
 * After ensureLockedVotingPower: Emergency quorum is 30% of totalVp.
 * Locked-beyond VP must clear that share or the finalize → Defeated path wins.
 */
async function assertEmergencyQuorumReachable(ctx: ScenarioContext): Promise<void> {
    const actor = resolveGovActor(ctx);
    const voteEnd = await estimateFreshVoteEndTime(ctx);
    const stakingLock = await resolveStakingLockAddr(ctx);
    const multipliers = await readTierMultipliers(ctx, stakingLock);
    const locked = computeLockedBeyondVp(
        await readActorStakeRecords(ctx, actor),
        multipliers,
        voteEnd,
    );
    const aggregate = await openStakingMaster(ctx).getGetTotalVotingPower();
    if (aggregate <= 0n) {
        return;
    }
    const need = (aggregate * 30n) / 100n;
    if (locked < need) {
        throw new Error(
            `${NA_EMERGENCY_QUORUM_UNREACHABLE}: locked=${locked} need≥${need} (30% of totalVp=${aggregate})`,
        );
    }
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const actor = resolveGovActor(ctx);
    const sender = provider.sender().address;
    if (!sender || !sender.equals(actor)) {
        throw new Error('Mnemonic wallet must equal gov actor for Emergency path.');
    }

    await ensureLockedVotingPower(ctx);
    await assertEmergencyQuorumReachable(ctx);

    const timelock = Address.parse(manifest.addresses.timelock);
    const payload = emergencyPayload(
        timelock,
        EMERGENCY_DUMMY_METHOD,
        beginCell().endCell(),
        'tnfs-f26-emergency',
    );
    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);

    const seqnoC = await getSenderSeqno(provider);
    await contract.sendCreateProposal(contractProvider, provider.sender(), {
        proposalType: TYPE_EMERGENCY,
        payload,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoC);
    await sleepMs(8_000);

    const gov = openGovernor(ctx);
    const id = (await gov.getGetProposalCount()) - 1n;
    const addr = await gov.getGetProposal(id);
    if (!addr) {
        throw new Error(`Emergency CreateProposal id=${id} has null address (soft-cancel?)`);
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
            throw new Error(`Emergency CastVote not recorded for id=${id}`);
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
            throw new Error(
                `Emergency finalize expected Succeeded (check quorum), got state=${state}`,
            );
        }
    }

    const timelockDelay = await proposal.getGetTimelockDelay();
    const timelockAddr = timelockAddress(ctx);
    const governorSender = await resolveTimelockGovernorSender(ctx);
    await assertTimelockGovernorSender(ctx, governorSender.address);

    let pending = await readPendingAction(provider, timelockAddr, id);
    if (!pending && state === PS_SUCCEEDED) {
        const { contract: tl, contractProvider: tlP } = timelockContract(ctx);
        const seqnoQ = await governorSender.getSeqno();
        await tl.sendQueue(tlP, governorSender.sender, {
            proposalId: id,
            proposalContract: addr,
            target: timelock,
            method: BigInt(EMERGENCY_DUMMY_METHOD),
            args: beginCell().endCell(),
            delay: 0n,
        });
        await governorSender.waitSeqnoIncrement(seqnoQ);
        await sleepMs(3_000);
        pending = await readPendingAction(provider, timelockAddr, id);
        for (let attempt = 0; attempt < 5 && !pending; attempt += 1) {
            await sleepMs(5_000);
            pending = await readPendingAction(provider, timelockAddr, id);
        }
        if (!pending) {
            throw new Error(`Emergency TimelockQueue did not create pending for id=${id}`);
        }
    }

    if (state !== PS_EXECUTED && pending) {
        const scheduled = Number(pending.scheduledTime);
        if (!(await waitUntilUnix(scheduled, maxWait))) {
            throw new Error(
                `${NA_LAB_TIMERS_NOT_SHORTENED}: emergency execute at ${scheduled}, maxWait=${maxWait}s`,
            );
        }
        const { contract: tl, contractProvider: tlP } = timelockContract(ctx);
        const seqnoE = await governorSender.getSeqno();
        await tl.sendExecutePending(tlP, governorSender.sender, id);
        await governorSender.waitSeqnoIncrement(seqnoE);
        await sleepMs(8_000);
    }

    const stateAfter = await waitForProposalState(provider, addr, PS_EXECUTED);
    const pendingAfter = await readPendingAction(provider, timelockAddr, id);
    const proposalType = await proposal.getGetProposalType();

    return checkEmergencyExecuted({
        proposalType,
        timelockDelay,
        stateAfter,
        pendingCleared: pendingAfter == null || pendingAfter.executed,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-emergency-execute',
    title: 'Gov Emergency delay-0 execute',
    description:
        'Emergency propose→vote→finalize→Timelock queue delay=0→execute (non-high-value method). ' +
        'Fails loudly when locked VP cannot clear 30% quorum under Flexible whale totalVp.',
    tags: ['governance'],
    needsLiveTx: true,
    depends_on: ['fs-gov-vote-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
