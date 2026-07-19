/**
 * fs-gov-cancel — proposer cancel inside CANCEL_LAG succeeds; late cancel fails.
 * Shared → N/A needs-lab-short-timers. Lab: prefer in-window cancel on fresh propose.
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    PS_ACTIVE,
    PS_CANCELLED,
    TYPE_TREASURY,
    checkCancelOutcome,
    fetchVotingPower,
    governorContract,
    naWhenGovCancel,
    openProposal,
    resolveGovActor,
    resolveLatestProposalAddr,
    resolveSpendRecipient,
    SPEND_AMOUNT_HAPPY,
    treasurySpendPayload,
} from '../lib/gov';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovCancel(ctx);
}

async function ensureCancellableProposal(ctx: ScenarioContext): Promise<{
    id: bigint;
    addr: Address;
    mode: 'in-window' | 'late';
}> {
    const { provider, manifest } = ctx;
    const actor = resolveGovActor(ctx);
    const latest = await resolveLatestProposalAddr(ctx);
    const now = Math.floor(Date.now() / 1000);

    if (latest) {
        const proposal = openProposal(provider, latest.addr);
        const state = await proposal.getGetState();
        if (state === PS_CANCELLED) {
            return { id: latest.id, addr: latest.addr, mode: 'in-window' };
        }
        if (state === PS_ACTIVE) {
            const start = Number(await proposal.getGetStartTime());
            const proposer = await proposal.getGetProposer();
            if (now < start && proposer.equals(actor)) {
                return { id: latest.id, addr: latest.addr, mode: 'in-window' };
            }
            if (now >= start) {
                return { id: latest.id, addr: latest.addr, mode: 'late' };
            }
        }
    }

    // Create a fresh proposal to exercise in-window cancel.
    const treasury = Address.parse(manifest.addresses.treasury);
    const recipient = resolveSpendRecipient(ctx);
    const payload = treasurySpendPayload(treasury, recipient, SPEND_AMOUNT_HAPPY, 'tnfs-09b-cancel');
    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);
    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCreateProposal(contractProvider, provider.sender(), {
        proposalType: TYPE_TREASURY,
        payload,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(8_000);

    const created = await resolveLatestProposalAddr(ctx);
    if (!created) {
        throw new Error('CreateProposal for cancel probe did not yield a proposal address.');
    }
    return { id: created.id, addr: created.addr, mode: 'in-window' };
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const actor = resolveGovActor(ctx);
    const sender = provider.sender().address;
    if (!sender || !sender.equals(actor)) {
        throw new Error('Mnemonic wallet must equal gov actor (proposer) for cancel.');
    }

    const target = await ensureCancellableProposal(ctx);
    const proposal = openProposal(provider, target.addr);
    const stateBefore = await proposal.getGetState();

    if (stateBefore === PS_CANCELLED) {
        return checkCancelOutcome({
            mode: 'in-window',
            stateBefore: PS_ACTIVE,
            stateAfter: PS_CANCELLED,
        }).map((c) => ({
            ...c,
            message: `${c.message} (idempotent — already cancelled id=${target.id})`,
        }));
    }

    const seqnoBefore = await getSenderSeqno(provider);
    await proposal.sendCancel(provider.sender());
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(5_000);

    const stateAfter = await proposal.getGetState();
    return checkCancelOutcome({
        mode: target.mode,
        stateBefore,
        stateAfter,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-cancel',
    title: 'Gov cancel in-window / late',
    description:
        'Proposer cancel inside CANCEL_LAG → Cancelled; after voting opens → stay Active (Too late).',
    tags: ['governance'],
    needsLiveTx: true,
    depends_on: ['fs-gov-propose-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
