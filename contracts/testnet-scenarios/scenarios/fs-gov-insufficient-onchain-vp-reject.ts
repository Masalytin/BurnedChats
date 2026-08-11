/**
 * fs-gov-insufficient-onchain-vp-reject — CreateProposal with claimedVp ≥ min but
 * on-chain proposerVp < min → reserved id CANCELLED, no Proposal (IMP-MNAUD-F07 / F19).
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    TYPE_TREASURY,
    checkInsufficientOnchainVpRejected,
    fetchVotingPower,
    governorContract,
    naWhenInsufficientOnchainVp,
    openGovernor,
    resolveSpendRecipient,
    SPEND_AMOUNT_HAPPY,
    SPEND_REASON,
    treasurySpendPayload,
} from '../lib/gov';
import { openStakingMaster } from '../lib/staking';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenInsufficientOnchainVp(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const gov = openGovernor(ctx);
    const master = openStakingMaster(ctx);
    const minProposalVp = await gov.getGetMinProposalVp();
    const proposerOnchainVp = await fetchVotingPower(ctx, sender);
    const totalVp = await master.getGetTotalVotingPower();
    const countBefore = await gov.getGetProposalCount();
    const reservedId = countBefore;

    // Cheap gate must pass: claim at least min (inflated relative to on-chain 0).
    const claimedVp = minProposalVp > 0n ? minProposalVp : 1n;

    const treasury = Address.parse(manifest.addresses.treasury);
    const recipient = resolveSpendRecipient(ctx);
    const payload = treasurySpendPayload(treasury, recipient, SPEND_AMOUNT_HAPPY, SPEND_REASON);
    const { contract, contractProvider } = governorContract(ctx);

    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCreateProposal(contractProvider, provider.sender(), {
        proposalType: TYPE_TREASURY,
        payload,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    // Phase-1 reserve + snapshot round-trip + phase-2 soft-cancel.
    await sleepMs(12_000);

    const countAfter = await gov.getGetProposalCount();
    const proposalAddr = await gov.getGetProposal(reservedId);
    let stateAfter: bigint | null = null;
    try {
        stateAfter = await gov.getGetProposalState(reservedId);
    } catch {
        stateAfter = null;
    }

    return checkInsufficientOnchainVpRejected({
        countBefore,
        countAfter,
        claimedVp,
        minProposalVp,
        proposerOnchainVp,
        totalVp,
        proposalAddr,
        stateAfter,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-insufficient-onchain-vp-reject',
    title: 'Gov insufficient on-chain VP reject (F07)',
    description:
        'CreateProposal with claimedVp ≥ min but on-chain proposerVp < min reserves id as CANCELLED and does not deploy Proposal.',
    tags: ['governance', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-gov-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
