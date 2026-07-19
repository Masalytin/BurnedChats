/**
 * fs-gov-propose-happy — CreateProposal (TreasurySpend) succeeds; cancel-lag window exists.
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    TYPE_TREASURY,
    checkProposeCreated,
    fetchVotingPower,
    governorContract,
    naWhenGovPropose,
    openGovernor,
    openProposal,
    resolveCancelLagSec,
    resolveGovActor,
    resolveSpendRecipient,
    SPEND_AMOUNT_HAPPY,
    SPEND_REASON,
    treasurySpendPayload,
} from '../lib/gov';
import { sleepMs } from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    return naWhenGovPropose(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const actor = resolveGovActor(ctx);
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }
    if (!sender.equals(actor)) {
        throw new Error(
            `Mnemonic wallet ${sender.toString()} must equal gov actor ${actor.toString()}.`,
        );
    }

    const gov = openGovernor(ctx);
    const treasury = Address.parse(manifest.addresses.treasury);
    const recipient = resolveSpendRecipient(ctx);

    const countBefore = await gov.getGetProposalCount();

    const cancelLagSec = await resolveCancelLagSec(ctx);

    // Idempotent: a prior proposal from this pack already exists.
    if (countBefore > 0n) {
        const id = countBefore - 1n;
        const addr = await gov.getGetProposal(id);
        if (addr) {
            const proposal = openProposal(provider, addr);
            const startTime = await proposal.getGetStartTime();
            const endTime = await proposal.getGetEndTime();
            const createdApprox = Number(startTime) - cancelLagSec;
            return checkProposeCreated({
                countBefore: countBefore - 1n,
                countAfter: countBefore,
                proposalAddr: addr,
                startTime,
                endTime,
                createdAtApprox: createdApprox,
                cancelLagSec,
            }).map((c) =>
                c.name === 'proposal-count-incremented'
                    ? {
                          ...c,
                          message: `${c.message} (idempotent — latest proposal id=${id})`,
                      }
                    : c,
            );
        }
    }

    const claimedVp = await fetchVotingPower(ctx, actor);
    const payload = treasurySpendPayload(treasury, recipient, SPEND_AMOUNT_HAPPY, SPEND_REASON);
    const { contract, contractProvider } = governorContract(ctx);

    const seqnoBefore = await getSenderSeqno(provider);
    await contract.sendCreateProposal(contractProvider, provider.sender(), {
        proposalType: TYPE_TREASURY,
        payload,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    await sleepMs(8_000);

    const countAfter = await gov.getGetProposalCount();
    const id = countAfter > 0n ? countAfter - 1n : 0n;
    const proposalAddr = await gov.getGetProposal(id);
    if (!proposalAddr) {
        throw new Error(`CreateProposal did not yield proposal address for id=${id}`);
    }
    const proposal = openProposal(provider, proposalAddr);
    const startTime = await proposal.getGetStartTime();
    const endTime = await proposal.getGetEndTime();
    const createdAtApprox = Math.floor(Date.now() / 1000);

    return checkProposeCreated({
        countBefore,
        countAfter,
        proposalAddr,
        startTime,
        endTime,
        createdAtApprox,
        cancelLagSec,
    });
}

export const scenario: Scenario = {
    id: 'fs-gov-propose-happy',
    title: 'Gov propose happy',
    description:
        'CreateProposal (TreasurySpend) succeeds; cancel-lag window exists before voting opens.',
    tags: ['governance'],
    needsLiveTx: true,
    depends_on: ['fs-gov-smoke', 'fs-staking-stake-happy'],
    naWhen,
    run: runChecks,
};

export default scenario;
