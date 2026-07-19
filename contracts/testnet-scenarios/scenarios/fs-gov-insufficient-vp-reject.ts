/**
 * fs-gov-insufficient-vp-reject — CreateProposal with claimedVp < minProposalVp rejected.
 * Expected reject → pass; wrong accept (count++) → fail.
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    CLAIMED_VP_BELOW_MIN,
    TYPE_TREASURY,
    checkInsufficientVpRejected,
    governorContract,
    openGovernor,
    resolveSpendRecipient,
    SPEND_AMOUNT_HAPPY,
    SPEND_REASON,
    treasurySpendPayload,
} from '../lib/gov';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const gov = openGovernor(ctx);
    const minProposalVp = await gov.getGetMinProposalVp();
    const countBefore = await gov.getGetProposalCount();

    const treasury = Address.parse(manifest.addresses.treasury);
    const recipient = resolveSpendRecipient(ctx);
    const payload = treasurySpendPayload(treasury, recipient, SPEND_AMOUNT_HAPPY, SPEND_REASON);
    const { contract, contractProvider } = governorContract(ctx);

    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCreateProposal(contractProvider, provider.sender(), {
        proposalType: TYPE_TREASURY,
        payload,
        claimedVp: CLAIMED_VP_BELOW_MIN,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(5_000);

    const countAfter = await gov.getGetProposalCount();

    return checkInsufficientVpRejected({
        countBefore,
        countAfter,
        claimedVp: CLAIMED_VP_BELOW_MIN,
        minProposalVp,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-insufficient-vp-reject',
    title: 'Gov insufficient VP reject',
    description:
        'CreateProposal with claimedVp below minProposalVp must not increment proposal_count.',
    tags: ['governance', 'edge'],
    needsLiveTx: true,
    depends_on: ['fs-gov-smoke'],
    run: runChecks,
};

export default scenario;
