import { SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { expect } from '@jest/globals';
import '@ton/test-utils';

import { Governor } from '../wrappers/Governor';
import { Proposal } from '../wrappers/Proposal';
import { Timelock } from '../wrappers/Timelock';
import { Treasury } from '../wrappers/Treasury';
import { StakingMaster_errors_backward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { NANO_PER_BURN } from './helpers';
import { advanceTime, mintAndSyncUser, setupStakingEnvironment, stakeAs, StakingTestEnv } from './staking-helpers';

const DAY = 86_400;
const CANCEL_LAG = 3600;

const PS_DEFEATED = 2n;
const PS_SUCCEEDED = 1n;

// ProposalType enum (governance-payload.tact).
const TYPE_PARAM = 0;

// Tier ids (StakingLock defaultStakingTierConfigs).
const TIER_FLEXIBLE = 0;
const TIER_DIAMOND = 3;

type GovEnv = StakingTestEnv & {
    timelock: SandboxContract<Timelock>;
    governor: SandboxContract<Governor>;
};

/**
 * IMP-FAUDIT-F01 — regression for finding F-2 (post-snapshot flash-stake governance capture).
 *
 * The Governor snapshots the quorum denominator when the proposal is created, but the vote
 * weight used to be read LIVE at relay time from `computeOwnerVotingPower`. A voter who staked
 * into the Flexible tier (0-lock, instant unstake) AFTER the snapshot could inflate `forVotes`
 * against a frozen quorum denominator, then unstake — a capital-efficient governance takeover.
 *
 * The fix gates the relayed vote by lock: a stake only counts if it stays locked past the
 * proposal's voting window (`stake.unlockTime > proposal.endTime`). Flexible-tier stake can
 * never satisfy this, so the flash path is closed.
 */
async function setupGovernance(uri: string, minProposalVp = 1n): Promise<GovEnv> {
    const env = await setupStakingEnvironment(uri);
    const { blockchain, deployer, stakingLock, stakingMaster } = env;

    const timelock = blockchain.openContract(await Timelock.prepareInit(deployer.address));
    await timelock.send(deployer.getSender(), { value: toNano('0.2') }, null);

    const treasuryInit = await Treasury.prepareInit(timelock.address, env.jettonMaster.address);

    const governor = blockchain.openContract(
        await Governor.prepareInit({
            minProposalVp,
            stakingMaster: stakingMaster.address,
            stakingLock: stakingLock.address,
            timelock: timelock.address,
            timelockDelaySec: BigInt(DAY),
            treasury: treasuryInit.address,
        }),
    );
    await governor.send(deployer.getSender(), { value: toNano('1') }, null);

    const setGov = await stakingMaster.sendSetGovernor(deployer.getSender(), governor.address);
    expect(setGov.transactions).toHaveTransaction({ success: true });

    return { ...env, timelock, governor };
}

async function stakeForVp(
    env: StakingTestEnv,
    user: SandboxContract<TreasuryContract>,
    tier: number,
    amountNano: bigint,
): Promise<void> {
    await mintAndSyncUser(env, user, amountNano);
    const tx = await stakeAs(env, user, tier, amountNano);
    expect(tx.transactions).toHaveTransaction({ success: true });
}

function paramPayload(target: Address, method: number, args: Cell = beginCell().endCell()): Cell {
    return beginCell().storeAddress(target).storeUint(method, 32).storeRef(args).endCell();
}

async function createProposal(
    env: GovEnv,
    proposer: SandboxContract<TreasuryContract>,
    payload: Cell,
): Promise<{ id: bigint; proposal: SandboxContract<Proposal> }> {
    const totalVp = await env.stakingMaster.getGetTotalVotingPower();
    const id = await env.governor.getGetProposalCount();

    const createTx = await env.governor.sendCreateProposal(proposer.getSender(), {
        proposalType: TYPE_PARAM,
        payload,
        claimedVp: totalVp,
    });
    expect(createTx.transactions).toHaveTransaction({ on: env.governor.address, success: true });

    const addr = await env.governor.getGetProposal(id);
    expect(addr).not.toBeNull();
    const proposal = env.blockchain.openContract(new Proposal(addr!));
    advanceTime(env.blockchain, CANCEL_LAG + 1);
    return { id, proposal };
}

async function castVote(
    env: GovEnv,
    voter: SandboxContract<TreasuryContract>,
    id: bigint,
    support: boolean,
) {
    return env.governor.sendCastVote(voter.getSender(), { proposalId: id, support, claimedVp: 10n ** 30n });
}

describe('Governance flash-stake regression (IMP-FAUDIT-F01 / F-2)', () => {
    it('post-snapshot Flexible-tier stake → vote → unstake is rejected (vote not counted)', async () => {
        const env = await setupGovernance('https://example.com/gov-flash-flex.json');

        // Honest baseline stake so a quorum denominator exists at snapshot time.
        const honest = await env.blockchain.treasury('flash-honest');
        await stakeForVp(env, honest, TIER_DIAMOND, 100n * NANO_PER_BURN);

        const target = await env.blockchain.treasury('flash-target');
        const { id, proposal } = await createProposal(env, honest, paramPayload(target.address, 1));

        // Attacker stakes AFTER the snapshot into the Flexible tier (0-lock, instant unstake).
        // Amount is sized to clear the frozen quorum alone (~5–10% of snapshot VP for Parameter).
        // Diamond 100 BURN → VP = 300 BURN-units; Flexible 50 BURN → VP = 50 (≥ 10% of 300).
        const attacker = await env.blockchain.treasury('flash-attacker');
        const flashAmount = 50n * NANO_PER_BURN;
        await mintAndSyncUser(env, attacker, flashAmount + NANO_PER_BURN);
        const stakeTx = await stakeAs(env, attacker, TIER_FLEXIBLE, flashAmount);
        expect(stakeTx.transactions).toHaveTransaction({ on: env.stakingMaster.address, success: true });
        expect(await env.stakingMaster.getGetStake(attacker.address, BigInt(TIER_FLEXIBLE))).not.toBeNull();

        // Sanity: the attacker really holds live VP (the flash setup is real).
        expect(await env.stakingMaster.getGetVotingPower(attacker.address)).toBeGreaterThan(0n);

        // Attacker attempts to relay their post-snapshot Flexible VP into the proposal.
        const voteTx = await castVote(env, attacker, id, true);

        // The relay must be rejected on StakingMaster: no lockable VP → zero effective vp.
        expect(voteTx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: false,
            exitCode: StakingMaster_errors_backward['Zero effective vp'],
        });

        // The attacker's vote is NOT recorded on the proposal.
        expect(await proposal.getHasVoted(attacker.address)).toBe(false);
        expect(await proposal.getGetForVotes()).toBe(0n);

        // Attacker can still immediately unstake the Flexible stake (proving the flash path
        // existed) — but it bought them no governance weight.
        const unstakeTx = await env.stakingMaster.sendUnstakeJetton(attacker.getSender(), {
            tier: TIER_FLEXIBLE,
            amount: flashAmount,
        });
        expect(unstakeTx.transactions).toHaveTransaction({ on: env.stakingMaster.address, success: true });

        // Without the attacker's inflated "for" votes, participation stays under the frozen
        // quorum denominator → proposal is Defeated, not captured.
        advanceTime(env.blockchain, 3 * DAY + 1);
        await proposal.sendFinalize(env.deployer.getSender());
        expect(await proposal.getGetState()).toBe(PS_DEFEATED);
    });

    it('locked stake past the voting window still votes (honest Diamond-tier path unaffected)', async () => {
        const env = await setupGovernance('https://example.com/gov-flash-locked.json');

        const voter = await env.blockchain.treasury('flash-locked-voter');
        await stakeForVp(env, voter, TIER_DIAMOND, 100n * NANO_PER_BURN);

        const target = await env.blockchain.treasury('flash-locked-target');
        const { id, proposal } = await createProposal(env, voter, paramPayload(target.address, 1));

        const voteTx = await castVote(env, voter, id, true);
        expect(voteTx.transactions).toHaveTransaction({ on: env.stakingMaster.address, success: true });
        expect(voteTx.transactions).toHaveTransaction({ on: proposal.address, success: true });
        expect(await proposal.getHasVoted(voter.address)).toBe(true);
        expect(await proposal.getGetForVotes()).toBeGreaterThan(0n);

        advanceTime(env.blockchain, 3 * DAY + 1);
        await proposal.sendFinalize(env.deployer.getSender());
        expect(await proposal.getGetState()).toBe(PS_SUCCEEDED);
    });
});
