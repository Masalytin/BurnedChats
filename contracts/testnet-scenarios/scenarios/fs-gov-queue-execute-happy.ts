/**
 * fs-gov-queue-execute-happy — finalize → timelock queue → execute after delay.
 *
 * Timelock.governor is either the deploy EOA (ordinary lab) or a throwaway
 * multisig (lab §2 B rehearsal, IMP-MNAUD-F15). Queue/execute use
 * `resolveTimelockGovernorSender` — never Blueprint Actor A (IMP-TNFS-F16).
 * Finalize stays with Actor A.
 */
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { Treasury } from '../../wrappers/Treasury';
import {
    EXECUTE_ATTACH_TON,
    NA_LAB_TIMERS_NOT_SHORTENED,
    OP_TREASURY_SPEND,
    PS_ACTIVE,
    PS_EXECUTED,
    PS_SUCCEEDED,
    TYPE_TREASURY,
    assertTimelockGovernorSender,
    checkQueueExecute,
    naWhenGovTimeDependent,
    openProposal,
    parseTreasurySpendPayload,
    readPendingAction,
    readTimelockHighValueFloorSec,
    resolveGovMaxWaitSec,
    resolveHighValueQueueDelay,
    resolveUsableProposal,
    timelockAddress,
    timelockContract,
    waitForProposalState,
    waitUntilUnix,
} from '../lib/gov';
import { resolveTimelockGovernorSender } from '../lib/multisig';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovTimeDependent(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    // IMP-TNFS-F13: state-aware selection — a Cancelled/Defeated latest (e.g.
    // left behind by fs-gov-cancel) must not fail the scenario when an earlier
    // Executed/Succeeded/Active proposal exists.
    const latest = await resolveUsableProposal(ctx, 'executable');
    if (!latest) {
        throw new Error(
            'No usable (non-terminal) proposal found — run fs-gov-propose-happy → fs-gov-vote-happy first.',
        );
    }

    const proposal = openProposal(provider, latest.addr);
    const timelockAddr = timelockAddress(ctx);
    const maxWait = resolveGovMaxWaitSec();

    let state = await proposal.getGetState();
    if (state === PS_EXECUTED) {
        return checkQueueExecute({ stateAfter: PS_EXECUTED, pendingCleared: true }).map((c) => ({
            ...c,
            message: `${c.message} (idempotent — already executed id=${latest.id})`,
        }));
    }

    if (state === PS_ACTIVE) {
        const endTime = Number(await proposal.getGetEndTime());
        const ready = await waitUntilUnix(endTime + 1, maxWait);
        if (!ready) {
            throw new Error(
                `${NA_LAB_TIMERS_NOT_SHORTENED}: voting ends at ${endTime}, maxWait=${maxWait}s`,
            );
        }
        const seqnoBefore = await getSenderSeqno(provider);
        // OpenedContract binds provider for Proposal.sendFinalize(provider, via).
        await proposal.sendFinalize(provider.sender());
        await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        state = await waitForProposalState(provider, latest.addr, PS_SUCCEEDED);
        if (state !== PS_SUCCEEDED) {
            throw new Error(`Finalize did not reach Succeeded (state=${state})`);
        }
    }

    if (state === PS_SUCCEEDED) {
        // IMP-TNFS-F16 / F15: TimelockQueue requires sender() == Timelock.governor
        // (deploy EOA or multisig). Gate before sending — missing env / mismatch
        // is a loud fail, not a silent skip.
        const deployer = await resolveTimelockGovernorSender(ctx);
        await assertTimelockGovernorSender(ctx, deployer.address);

        let pending = await readPendingAction(provider, timelockAddr, latest.id);
        if (!pending) {
            // IMP-MNAUD-F03: TreasurySpend is a high-value method — on a floor
            // tip the queue delay must be > 0 and ≥ the on-chain floor (lab
            // deploys use a short floor, so the wait below fits GOV_MAX_WAIT).
            // On a pre-floor tip this falls back to the F17 clamp (60 → 0).
            const floorSec = await readTimelockHighValueFloorSec(provider, timelockAddr);
            const delay = resolveHighValueQueueDelay(
                await proposal.getGetTimelockDelay(),
                floorSec,
            );
            const proposalType = await proposal.getGetProposalType();
            const payload = await proposal.getGetPayload();
            if (Number(proposalType) !== TYPE_TREASURY) {
                throw new Error(
                    `queue-execute happy expects TreasurySpend proposal type ${TYPE_TREASURY}, got ${proposalType}`,
                );
            }
            const parsed = parseTreasurySpendPayload(payload);
            const args = Treasury.packTimelockSpendBody({
                recipient: parsed.recipient,
                amount: parsed.amount,
                reason: parsed.reason,
                proposalId: latest.id,
            });

            const { contract, contractProvider } = timelockContract(ctx);
            const seqnoQ = await deployer.getSeqno();
            await contract.sendQueue(contractProvider, deployer.sender, {
                proposalId: latest.id,
                proposalContract: latest.addr,
                target: parsed.treasury,
                method: BigInt(OP_TREASURY_SPEND),
                args,
                delay,
            });
            await deployer.waitSeqnoIncrement(seqnoQ);
            // State-based verification: seqno growth alone proves nothing
            // (V5R1 silent skip / "Only governor" bounce — IMP-TNFS-F10/F16).
            await sleepMs(3_000);
            pending = await readPendingAction(provider, timelockAddr, latest.id);
            for (let attempt = 0; attempt < 5 && !pending; attempt += 1) {
                await sleepMs(5_000);
                pending = await readPendingAction(provider, timelockAddr, latest.id);
            }
            if (!pending) {
                throw new Error(`TimelockQueue did not create pending for id=${latest.id}`);
            }
        }

        const scheduled = Number(pending.scheduledTime);
        const readyExec = await waitUntilUnix(scheduled, maxWait);
        if (!readyExec) {
            throw new Error(
                `${NA_LAB_TIMERS_NOT_SHORTENED}: execute at ${scheduled}, maxWait=${maxWait}s`,
            );
        }

        const { contract, contractProvider } = timelockContract(ctx);
        const seqnoE = await deployer.getSeqno();
        // Treasury spend needs PREMNT-07-sized attach (wrapper default 0.25 is too low).
        await contract.send(
            contractProvider,
            deployer.sender,
            { value: EXECUTE_ATTACH_TON },
            { $$type: 'TimelockExecutePending', queryId: 0n, proposalId: latest.id },
        );
        await deployer.waitSeqnoIncrement(seqnoE);
        await sleepMs(8_000);
    }

    const stateAfter = await waitForProposalState(provider, latest.addr, PS_EXECUTED);
    const pendingAfter = await readPendingAction(provider, timelockAddr, latest.id);

    return checkQueueExecute({
        stateAfter,
        // IMP-MNAUD-F08: on a post-F08 tip a successful high-value execute keeps
        // the pending entry as a non-re-executable (executed=true) tombstone;
        // pre-F08 tips delete it. Both shapes mean "consumed".
        pendingCleared: pendingAfter == null || pendingAfter.executed,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-queue-execute-happy',
    title: 'Gov queue→execute happy',
    description: 'Finalize succeeded proposal; timelock queue → execute after delay.',
    tags: ['governance'],
    needsLiveTx: true,
    depends_on: ['fs-gov-vote-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
