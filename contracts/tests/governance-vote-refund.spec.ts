import { Blockchain, SandboxContract, SendMessageResult, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { expect } from '@jest/globals';
import '@ton/test-utils';

import { Governor, GOVERNOR_VOTE_ATTACH_NANO } from '../wrappers/Governor';
import { Proposal } from '../wrappers/Proposal';
import { Timelock } from '../wrappers/Timelock';
import { Treasury } from '../wrappers/Treasury';
import { StakingMaster_errors_backward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { NANO_PER_BURN } from './helpers';
import { advanceTime, mintAndSyncUser, setupStakingEnvironment, stakeAs, StakingTestEnv } from './staking-helpers';

const DAY = 86_400;
const CANCEL_LAG = 3600;
const TYPE_PARAM = 0;
const MAX_VOTE_TRACE_TX = 10;

/**
 * IMP-GOVREFUND-02 — balance-preservation regression for CastVote relay.
 *
 * Would FAIL on pre-fix code (SendPayGasSeparately + cashback / SendRemainingValue to voter
 * on each hop — see REPORT.md and IMP-GOVREFUND-01):
 * - voter net +≈0.1365 TON on 0.18 attached (testnet trace 5d48fbe9…)
 * - Governor −≈0.14 TON, StakingMaster −≈0.07 TON per accepted vote
 * - ~170 tx ping-pong (RC-2 / RC-3)
 */
type GovEnv = StakingTestEnv & {
    timelock: SandboxContract<Timelock>;
    governor: SandboxContract<Governor>;
};

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
            timelockDelaySec: BigInt(2 * DAY),
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

async function createActiveProposal(
    env: GovEnv,
    proposer: SandboxContract<TreasuryContract>,
): Promise<{ id: bigint; proposal: SandboxContract<Proposal> }> {
    const totalVp = await env.stakingMaster.getGetTotalVotingPower();
    expect(totalVp).toBeGreaterThan(0n);
    const id = await env.governor.getGetProposalCount();

    const createTx = await env.governor.sendCreateProposal(proposer.getSender(), {
        proposalType: TYPE_PARAM,
        payload: paramPayload((await env.blockchain.treasury('refund-target')).address, 1),
        claimedVp: totalVp,
    });
    expect(createTx.transactions).toHaveTransaction({ on: env.governor.address, success: true });

    const addr = await env.governor.getGetProposal(id);
    expect(addr).not.toBeNull();
    const proposal = env.blockchain.openContract(new Proposal(addr!));

    advanceTime(env.blockchain, CANCEL_LAG + 1);
    return { id, proposal };
}

async function contractBalance(blockchain: Blockchain, addr: Address): Promise<bigint> {
    return (await blockchain.getContract(addr)).balance;
}

async function governanceStackBalance(
    env: GovEnv,
    proposal: SandboxContract<Proposal>,
): Promise<bigint> {
    const gov = await contractBalance(env.blockchain, env.governor.address);
    const sm = await contractBalance(env.blockchain, env.stakingMaster.address);
    const prop = await contractBalance(env.blockchain, proposal.address);
    return gov + sm + prop;
}

function sumTraceFees(transactions: SendMessageResult['transactions']): bigint {
    let total = 0n;
    for (const tx of transactions) {
        total += tx.totalFees.coins;
    }
    return total;
}

/** Net TON returned to the voter wallet from the vote trace (attached counted as spent). */
function voterRefund(attached: bigint, balanceBefore: bigint, balanceAfter: bigint): bigint {
    return balanceAfter - balanceBefore + attached;
}

describe('Governance vote refund regression (IMP-GOVREFUND-02)', () => {
    it('accepted CastVote preserves governance balances and does not over-refund the voter', async () => {
        const env = await setupGovernance('https://example.com/gov-refund-ok.json');
        const voter = await env.blockchain.treasury('gov-refund-voter');
        await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

        const { id, proposal } = await createActiveProposal(env, voter);

        const govBefore = await governanceStackBalance(env, proposal);
        const voterBefore = await voter.getBalance();

        const voteTx = await env.governor.sendCastVote(voter.getSender(), {
            proposalId: id,
            support: true,
            claimedVp: 10n ** 30n,
        });

        expect(voteTx.transactions).toHaveTransaction({ on: env.stakingMaster.address, success: true });
        expect(voteTx.transactions).toHaveTransaction({ on: proposal.address, success: true });
        expect(await proposal.getHasVoted(voter.address)).toBe(true);

        const totalGas = sumTraceFees(voteTx.transactions);
        const govAfter = await governanceStackBalance(env, proposal);
        const voterAfter = await voter.getBalance();
        const refund = voterRefund(GOVERNOR_VOTE_ATTACH_NANO, voterBefore, voterAfter);
        const govDrain = govBefore - govAfter;

        // Pre-fix: refund ≈0.3165 TON on 0.18 attached; post-fix: refund ≤ attached − gas.
        expect(refund).toBeLessThanOrEqual(GOVERNOR_VOTE_ATTACH_NANO - totalGas);
        expect(refund).toBeLessThanOrEqual(GOVERNOR_VOTE_ATTACH_NANO);

        // Pre-fix: Governor −0.14 + StakingMaster −0.07 per vote; post-fix: only gas.
        expect(govDrain).toBeLessThanOrEqual(totalGas);

        // Pre-fix: ~170 tx ping-pong; post-fix: short relay chain.
        expect(voteTx.transactions.length).toBeLessThan(MAX_VOTE_TRACE_TX);
    });

    it('rejected vote (zero effective VP) bounces without governance drain or voter profit', async () => {
        const env = await setupGovernance('https://example.com/gov-refund-bounce.json');
        const staker = await env.blockchain.treasury('gov-refund-staker');
        await stakeForVp(env, staker, 3, 100n * NANO_PER_BURN);

        const { id, proposal } = await createActiveProposal(env, staker);

        const unstaked = await env.blockchain.treasury('gov-refund-unstaked');
        const govBefore = await governanceStackBalance(env, proposal);
        const voterBefore = await unstaked.getBalance();

        const voteTx = await env.governor.sendCastVote(unstaked.getSender(), {
            proposalId: id,
            support: true,
            claimedVp: 10n ** 30n,
        });

        expect(voteTx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            success: false,
            exitCode: StakingMaster_errors_backward['Zero effective vp'],
        });
        expect(voteTx.transactions).toHaveTransaction({
            on: env.governor.address,
            inMessageBounced: true,
            success: true,
        });
        expect(await proposal.getHasVoted(unstaked.address)).toBe(false);

        const totalGas = sumTraceFees(voteTx.transactions);
        const govAfter = await governanceStackBalance(env, proposal);
        const voterAfter = await unstaked.getBalance();
        const refund = voterRefund(GOVERNOR_VOTE_ATTACH_NANO, voterBefore, voterAfter);
        const govDrain = govBefore - govAfter;

        expect(refund).toBeLessThanOrEqual(GOVERNOR_VOTE_ATTACH_NANO - totalGas);
        expect(voterAfter - voterBefore).toBeLessThanOrEqual(0n);
        expect(govDrain).toBeLessThanOrEqual(totalGas);
        expect(voteTx.transactions.length).toBeLessThan(MAX_VOTE_TRACE_TX);
    });
});
