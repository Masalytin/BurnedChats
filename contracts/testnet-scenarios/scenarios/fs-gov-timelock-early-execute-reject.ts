/**
 * fs-gov-timelock-early-execute-reject — TimelockExecutePending before delay rejected.
 * Expected reject → pending retained / not Executed; wrong accept → fail.
 */
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    EXECUTE_ATTACH_TON,
    checkEarlyExecuteRejected,
    naWhenGovEarlyExecute,
    openProposal,
    openTimelock,
    resolveLatestProposalAddr,
    timelockContract,
} from '../lib/gov';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovEarlyExecute(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const latest = await resolveLatestProposalAddr(ctx);
    if (!latest) {
        throw new Error('No proposal found — run fs-gov-vote-happy / queue path first.');
    }

    const timelock = openTimelock(ctx);
    const pending = await timelock.getGetPending(latest.id);
    if (!pending) {
        throw new Error(
            `No timelock pending for id=${latest.id} — queue a proposal before early-execute probe.`,
        );
    }

    const scheduledUnix = Number(pending.scheduledTime);
    const nowUnix = Math.floor(Date.now() / 1000);
    if (nowUnix >= scheduledUnix) {
        throw new Error(
            `Pending already executable (now=${nowUnix} >= scheduled=${scheduledUnix}) — cannot assert early reject.`,
        );
    }

    const proposal = openProposal(provider, latest.addr);
    const { contract, contractProvider } = timelockContract(ctx);
    const seqnoBefore = await getSenderSeqno(provider);
    await contract.send(
        contractProvider,
        provider.sender(),
        { value: EXECUTE_ATTACH_TON },
        { $$type: 'TimelockExecutePending', queryId: 0n, proposalId: latest.id },
    );
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(5_000);

    const pendingAfter = await timelock.getGetPending(latest.id);
    const stateAfter = await proposal.getGetState();

    return checkEarlyExecuteRejected({
        pendingStillPresent: pendingAfter != null,
        stateAfter,
        nowUnix, // pre-attempt clock — must still be before scheduled
        scheduledUnix,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-timelock-early-execute-reject',
    title: 'Timelock early execute reject',
    description: 'TimelockExecutePending before scheduledTime must leave pending intact.',
    tags: ['governance', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-gov-vote-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
