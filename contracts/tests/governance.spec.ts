import { SandboxContract, SendMessageResult, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { expect } from '@jest/globals';
import '@ton/test-utils';

import { Governor } from '../wrappers/Governor';
import { Proposal } from '../wrappers/Proposal';
import { Timelock } from '../wrappers/Timelock';
import { Treasury } from '../wrappers/Treasury';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { loadTimelockQueue } from '../build/Governor/Governor_Governor';
import { Proposal_errors_backward } from '../build/Governor/Governor_Proposal';
import { Timelock_errors_backward } from '../build/Timelock/Timelock_Timelock';
import { Treasury_errors_backward } from '../build/Treasury/Treasury_Treasury';
import { StakingMaster_errors_backward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { NANO_PER_BURN } from './helpers';
import {
    assertRelayFlowClean,
    countEmptyGovernorStakingHops,
    countEmptyProposalStakingHops,
} from './helpers/cashbackLoopAssert';
import { advanceTime, mintAndSyncUser, setupStakingEnvironment, stakeAs, StakingTestEnv } from './staking-helpers';

const DAY = 86_400;

// Pre-vote / cancel window before voting opens (governor.tact CANCEL_LAG, IMP-PREMNT-08).
const CANCEL_LAG = 3600;

// Proposal state machine (proposal.tact constants).
const PS_ACTIVE = 0n;
const PS_SUCCEEDED = 1n;
const PS_DEFEATED = 2n;
const PS_EXECUTED = 4n;
const PS_CANCELLED = 5n;

// Canonical opcodes (governance-messages.tact / treasury.tact).
const OP_TIMELOCK_QUEUE = 0x5a040201;
const OP_TREASURY_SPEND = 0x5a1c9010;
const OP_JETTON_TRANSFER = 0xf8a7ea5;

// ProposalType enum (governance-payload.tact).
const TYPE_PARAM = 0;
const TYPE_FEATURE = 1;
const TYPE_TREASURY = 2;
const TYPE_EMERGENCY = 3;

type GovEnv = StakingTestEnv & {
    timelock: SandboxContract<Timelock>;
    governor: SandboxContract<Governor>;
};

/**
 * Full governance stack on top of the staking environment.
 *
 * Wiring note (architectural constraint): `Governor.timelock` and
 * `Timelock.governor` are immutable init fields, so a mutual fixed point
 * (Timelock trusting the Governor while the Governor points at that Timelock)
 * is unsolvable for deterministic Tact addresses. Bootstrap resolves this by
 * deploying `Timelock.governor = deployer`; we mirror that here. The Governor
 * still emits a real `TimelockQueue` on finalize — tests capture those exact
 * bytes and replay them through the deployer-governed Timelock, exercising the
 * full pipeline including the IMP-PREMNT-01 TreasurySpend decode.
 */
async function setupGovernance(uri: string, minProposalVp = 1n): Promise<GovEnv> {
    const env = await setupStakingEnvironment(uri);
    const { blockchain, deployer, stakingLock, stakingMaster } = env;

    const timelock = blockchain.openContract(await Timelock.prepareInit(deployer.address));
    await timelock.send(deployer.getSender(), { value: toNano('0.2') }, null);

    const governor = blockchain.openContract(
        await Governor.prepareInit({
            minProposalVp,
            stakingMaster: stakingMaster.address,
            stakingLock: stakingLock.address,
            timelock: timelock.address,
            timelockDelaySec: BigInt(DAY),
        }),
    );
    await governor.send(deployer.getSender(), { value: toNano('1') }, null);

    // One-shot re-point of StakingMaster.governorAddr from the bootstrap
    // placeholder (deployer) to the real Governor so vote relays are accepted.
    const setGov = await stakingMaster.sendSetGovernor(deployer.getSender(), governor.address);
    expect(setGov.transactions).toHaveTransaction({ success: true });
    expect((await stakingMaster.getGetGovernorAddr()).equals(governor.address)).toBe(true);

    return { ...env, timelock, governor };
}

/**
 * Governance stack without the one-shot `SetGovernor` wire. StakingMaster still trusts
 * `deployer` as `governorAddr`, so the real Governor's `RequestTotalVpSnapshot` is
 * rejected and bounces — used by IMP-AUDIT-18.
 */
async function setupGovernanceUnwired(uri: string, minProposalVp = 1n): Promise<GovEnv> {
    const env = await setupStakingEnvironment(uri);
    const { blockchain, deployer, stakingLock, stakingMaster } = env;

    const timelock = blockchain.openContract(await Timelock.prepareInit(deployer.address));
    await timelock.send(deployer.getSender(), { value: toNano('0.2') }, null);

    const governor = blockchain.openContract(
        await Governor.prepareInit({
            minProposalVp,
            stakingMaster: stakingMaster.address,
            stakingLock: stakingLock.address,
            timelock: timelock.address,
            timelockDelaySec: BigInt(DAY),
        }),
    );
    await governor.send(deployer.getSender(), { value: toNano('1') }, null);

    expect((await stakingMaster.getGetGovernorAddr()).equals(deployer.address)).toBe(true);
    return { ...env, timelock, governor };
}

/** Mint + stake a user so they carry on-chain voting power. */
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

function treasurySpendPayload(treasury: Address, recipient: Address, amount: bigint, reason: string): Cell {
    return beginCell()
        .storeAddress(treasury)
        .storeAddress(recipient)
        .storeCoins(amount)
        .storeRef(beginCell().storeStringTail(reason).endCell())
        .endCell();
}

function emergencyPayload(target: Address, method: number, args: Cell, reason: string): Cell {
    return beginCell()
        .storeAddress(target)
        .storeUint(method, 32)
        .storeRef(args)
        .storeRef(beginCell().storeStringTail(reason).endCell())
        .endCell();
}

function featurePayload(description: string, cid: Cell = beginCell().endCell()): Cell {
    return beginCell().storeRef(beginCell().storeStringTail(description).endCell()).storeRef(cid).endCell();
}

type CreatedProposal = {
    id: bigint;
    proposal: SandboxContract<Proposal>;
    createTx: SendMessageResult;
};

async function createProposal(
    env: GovEnv,
    proposer: SandboxContract<TreasuryContract>,
    proposalType: number,
    payload: Cell,
    options: { openVoting?: boolean } = {},
): Promise<CreatedProposal> {
    const totalVp = await env.stakingMaster.getGetTotalVotingPower();
    expect(totalVp).toBeGreaterThan(0n);
    const id = await env.governor.getGetProposalCount();

    // IMP-AUDIT-02: quorum denominator is snapshotted on-chain from StakingMaster (no
    // proposer-supplied field in CreateProposal since IMP-AUDIT-19).
    const createTx = await env.governor.sendCreateProposal(proposer.getSender(), {
        proposalType,
        payload,
        claimedVp: totalVp,
    });
    expect(createTx.transactions).toHaveTransaction({ on: env.governor.address, success: true });

    const addr = await env.governor.getGetProposal(id);
    expect(addr).not.toBeNull();
    const proposal = env.blockchain.openContract(new Proposal(addr!));

    // Voting opens only after the CANCEL_LAG pre-vote window (IMP-PREMNT-08).
    // Advance past it by default so callers can vote immediately; pass
    // `{ openVoting: false }` to stay inside the cancel window.
    if (options.openVoting !== false) {
        advanceTime(env.blockchain, CANCEL_LAG + 1);
    }
    return { id, proposal, createTx };
}

async function castVote(
    env: GovEnv,
    voter: SandboxContract<TreasuryContract>,
    id: bigint,
    support: boolean,
): Promise<SendMessageResult> {
    return env.governor.sendCastVote(voter.getSender(), { proposalId: id, support, claimedVp: 10n ** 30n });
}

function assertNoOutOfGas(transactions: SendMessageResult['transactions']): void {
    for (const tx of transactions) {
        if (tx.description.type !== 'generic') {
            continue;
        }
        const phase = tx.description.computePhase;
        if (phase.type === 'vm') {
            expect(phase.exitCode).not.toBe(-14);
        }
    }
}

/** Pull the exact `TimelockQueue` body the Governor emitted on finalize. */
function extractQueue(result: SendMessageResult, timelockAddr: Address) {
    for (const tx of result.transactions) {
        const inMsg = tx.inMessage;
        if (!inMsg || inMsg.info.type !== 'internal') {
            continue;
        }
        if (!inMsg.info.dest.equals(timelockAddr)) {
            continue;
        }
        const probe = inMsg.body.beginParse();
        if (probe.remainingBits < 32 || probe.preloadUint(32) !== OP_TIMELOCK_QUEUE) {
            continue;
        }
        return loadTimelockQueue(inMsg.body.beginParse());
    }
    return undefined;
}

/** Fund the treasury: credit `total_received` (mint forward → JettonNotification) and activate its wallet fee config. */
async function fundTreasury(
    env: GovEnv,
    treasury: SandboxContract<Treasury>,
    amountNano: bigint,
): Promise<void> {
    await env.jettonMaster.sendAddExcluded(env.deployer.getSender(), treasury.address);
    await env.jettonMaster.sendMint(
        env.deployer.getSender(),
        treasury.address,
        amountNano,
        toNano('0.1'),
        toNano('0.5'),
    );
    await env.jettonMaster.sendSyncFeeConfigToWallet(env.deployer.getSender(), treasury.address);
    expect(await treasury.getGetTotalReceived()).toBe(amountNano);
}

describe('Governance E2E (IMP-PREMNT-02)', () => {
    describe('Parameter proposal lifecycle (type 0)', () => {
        it('create → vote → finalize → succeeded, and Governor emits a TimelockQueue', async () => {
            const env = await setupGovernance('https://example.com/gov-param.json');
            const voter = await env.blockchain.treasury('gov-param-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const target = await env.blockchain.treasury('param-target');
            const { id, proposal } = await createProposal(
                env,
                voter,
                TYPE_PARAM,
                paramPayload(target.address, 0x1234),
            );

            const voteTx = await castVote(env, voter, id, true);
            expect(voteTx.transactions).toHaveTransaction({ on: env.stakingMaster.address, success: true });
            expect(voteTx.transactions).toHaveTransaction({ on: proposal.address, success: true });
            expect(await proposal.getHasVoted(voter.address)).toBe(true);
            expect(await proposal.getGetForVotes()).toBeGreaterThan(0n);

            advanceTime(env.blockchain, 3 * DAY + 1);
            const finalizeTx = await proposal.sendFinalize(env.deployer.getSender());
            expect(finalizeTx.transactions).toHaveTransaction({ on: proposal.address, success: true });
            expect(await proposal.getGetState()).toBe(PS_SUCCEEDED);

            const queued = extractQueue(finalizeTx, env.timelock.address);
            expect(queued).toBeDefined();
            expect(queued!.target.equals(target.address)).toBe(true);
            expect(queued!.method).toBe(0x1234n);
            expect(queued!.delay).toBe(BigInt(DAY));
        });

        it('queue → wait → execute marks the proposal Executed', async () => {
            const env = await setupGovernance('https://example.com/gov-param-exec.json');
            const voter = await env.blockchain.treasury('gov-pexec-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const target = await env.blockchain.treasury('pexec-target');
            const { id, proposal } = await createProposal(
                env,
                voter,
                TYPE_PARAM,
                paramPayload(target.address, 0x42),
            );
            await castVote(env, voter, id, true);
            advanceTime(env.blockchain, 3 * DAY + 1);
            const finalizeTx = await proposal.sendFinalize(env.deployer.getSender());
            const queued = extractQueue(finalizeTx, env.timelock.address)!;

            // Replay the Governor-built queue via the deployer-governed Timelock.
            const queueTx = await env.timelock.sendQueue(env.deployer.getSender(), {
                proposalId: queued.proposalId,
                proposalContract: queued.proposalContract,
                target: queued.target,
                method: queued.method,
                args: queued.args,
                delay: queued.delay,
            });
            expect(queueTx.transactions).toHaveTransaction({ on: env.timelock.address, success: true });
            expect(await env.timelock.getGetPending(id)).not.toBeNull();

            advanceTime(env.blockchain, DAY + 1);
            const execTx = await env.timelock.sendExecutePending(env.deployer.getSender(), id);
            expect(execTx.transactions).toHaveTransaction({ on: env.timelock.address, success: true });
            expect(execTx.transactions).toHaveTransaction({ on: proposal.address, success: true });
            expect(await proposal.getGetState()).toBe(PS_EXECUTED);
            expect(await env.timelock.getGetPending(id)).toBeNull();
        });

        it('against-only vote past quorum is Defeated by threshold', async () => {
            const env = await setupGovernance('https://example.com/gov-defeat.json');
            const voter = await env.blockchain.treasury('gov-defeat-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const target = await env.blockchain.treasury('defeat-target');
            const { id, proposal } = await createProposal(
                env,
                voter,
                TYPE_PARAM,
                paramPayload(target.address, 1),
            );
            await castVote(env, voter, id, false);
            expect(await proposal.getGetAgainstVotes()).toBeGreaterThan(0n);

            advanceTime(env.blockchain, 3 * DAY + 1);
            await proposal.sendFinalize(env.deployer.getSender());
            expect(await proposal.getGetState()).toBe(PS_DEFEATED);
        });
    });

    describe('Treasury spend proposal (type 2) — IMP-PREMNT-01 / IMP-PREMNT-07', () => {
        it('Treasury pays the recipient when gas flows Timelock → Treasury → jetton-wallet', async () => {
            const env = await setupGovernance('https://example.com/gov-treasury.json');
            const voter = await env.blockchain.treasury('gov-treas-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const treasury = env.blockchain.openContract(
                await Treasury.prepareInit(env.timelock.address, env.jettonMaster.address),
            );
            await treasury.send(env.deployer.getSender(), { value: toNano('0.2') }, null);

            const spendAmount = 5n * NANO_PER_BURN;
            await fundTreasury(env, treasury, 50n * NANO_PER_BURN);

            const recipient = await env.blockchain.treasury('treas-recipient');
            const { id, proposal } = await createProposal(
                env,
                voter,
                TYPE_TREASURY,
                treasurySpendPayload(treasury.address, recipient.address, spendAmount, 'audit grant'),
            );
            await castVote(env, voter, id, true);

            advanceTime(env.blockchain, 7 * DAY + 1);
            const finalizeTx = await proposal.sendFinalize(env.deployer.getSender());
            expect(await proposal.getGetState()).toBe(PS_SUCCEEDED);

            const queued = extractQueue(finalizeTx, env.timelock.address)!;
            expect(queued.target.equals(treasury.address)).toBe(true);
            expect(queued.method).toBe(BigInt(OP_TREASURY_SPEND));

            await env.timelock.sendQueue(env.deployer.getSender(), {
                proposalId: queued.proposalId,
                proposalContract: queued.proposalContract,
                target: queued.target,
                method: queued.method,
                args: queued.args,
                delay: queued.delay,
            });
            advanceTime(env.blockchain, 2 * DAY + 1);
            // IMP-PREMNT-07: Timelock relays the executor-provided budget to the
            // treasury-spend target so the payout clears the jetton-wallet excluded
            // gate end-to-end. The wrapper's default 0.25 TON is intentionally
            // bypassed with a treasury-sized budget (relay source of gas).
            const execTx = await env.timelock.send(
                env.deployer.getSender(),
                { value: toNano('1.6') },
                { $$type: 'TimelockExecutePending', queryId: 0n, proposalId: id },
            );

            // Core regression: Treasury accepts and decodes opcode 0x5a1c9010 (pre-fix this
            // was an opcode/schema mismatch that silently never decoded). The decoded body
            // carries the recipient/amount/proposalId built by proposal.tact.
            expect(execTx.transactions).toHaveTransaction({
                on: treasury.address,
                op: OP_TREASURY_SPEND,
                success: true,
            });
            // Timelock also marks the proposal executed (ProposalMarkExecuted → Proposal).
            expect(await proposal.getGetState()).toBe(PS_EXECUTED);

            // IMP-PREMNT-07: the payout now SETTLES. The outbound JettonTransfer clears the
            // wallet's excluded-path gate (no bounce), so the spend accounting persists.
            expect(execTx.transactions).toHaveTransaction({ op: OP_JETTON_TRANSFER, success: true });
            expect(await treasury.getGetTotalSpent()).toBe(spendAmount);
            expect(await treasury.getGetSpendingCount()).toBe(1n);

            const rec = (await treasury.getGetSpendingHistory()).get(0n);
            expect(rec).toBeDefined();
            expect(rec!.recipient.equals(recipient.address)).toBe(true);
            expect(rec!.amount).toBe(spendAmount);
            expect(rec!.proposalId).toBe(id);

            // The recipient actually received the BURN jettons (excluded path → full amount).
            const recipientWallet = env.blockchain.openContract(
                BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(recipient.address)),
            );
            expect((await recipientWallet.getGetWalletData()).balance).toBe(spendAmount);
        });

        it('Treasury rejects a TreasurySpend not coming from the Timelock', async () => {
            const env = await setupGovernance('https://example.com/gov-treasury-auth.json');
            const treasury = env.blockchain.openContract(
                await Treasury.prepareInit(env.timelock.address, env.jettonMaster.address),
            );
            await treasury.send(env.deployer.getSender(), { value: toNano('0.2') }, null);
            await fundTreasury(env, treasury, 10n * NANO_PER_BURN);

            const rogue = await env.blockchain.treasury('rogue-spender');
            const recipient = await env.blockchain.treasury('rogue-recipient');
            const tx = await treasury.sendTreasurySpend(rogue.getSender(), {
                recipient: recipient.address,
                amount: NANO_PER_BURN,
                reason: 'theft',
                proposalId: 0n,
            });
            expect(tx.transactions).toHaveTransaction({
                on: treasury.address,
                success: false,
                exitCode: Treasury_errors_backward['Only timelock'],
            });
        });
    });

    describe('Emergency proposal (type 3, delay 0)', () => {
        it('executes immediately through the Timelock with zero delay', async () => {
            const env = await setupGovernance('https://example.com/gov-emergency.json');
            const voter = await env.blockchain.treasury('gov-emerg-voter');
            // Emergency needs 30% quorum / 75% threshold — single full-VP "for" vote clears both.
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const target = await env.blockchain.treasury('emerg-target');
            const { id, proposal } = await createProposal(
                env,
                voter,
                TYPE_EMERGENCY,
                emergencyPayload(target.address, 0x99, beginCell().endCell(), 'halt'),
            );
            await castVote(env, voter, id, true);

            advanceTime(env.blockchain, DAY + 1);
            const finalizeTx = await proposal.sendFinalize(env.deployer.getSender());
            expect(await proposal.getGetState()).toBe(PS_SUCCEEDED);

            const queued = extractQueue(finalizeTx, env.timelock.address)!;
            expect(queued.delay).toBe(0n);

            await env.timelock.sendQueue(env.deployer.getSender(), {
                proposalId: queued.proposalId,
                proposalContract: queued.proposalContract,
                target: queued.target,
                method: queued.method,
                args: queued.args,
                delay: queued.delay,
            });
            // delay 0 → executable in the same logical time.
            const execTx = await env.timelock.sendExecutePending(env.deployer.getSender(), id);
            expect(execTx.transactions).toHaveTransaction({ on: proposal.address, success: true });
            expect(await proposal.getGetState()).toBe(PS_EXECUTED);
        });
    });

    describe('Feature-priority proposal (type 1, off-chain execute)', () => {
        it('finalizes without a Timelock queue and executes via Governor', async () => {
            const env = await setupGovernance('https://example.com/gov-feature.json');
            const voter = await env.blockchain.treasury('gov-feat-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const { id, proposal } = await createProposal(
                env,
                voter,
                TYPE_FEATURE,
                featurePayload('ship dark mode'),
            );
            await castVote(env, voter, id, true);

            advanceTime(env.blockchain, 7 * DAY + 1);
            const finalizeTx = await proposal.sendFinalize(env.deployer.getSender());
            expect(await proposal.getGetState()).toBe(PS_SUCCEEDED);
            // Feature priority never queues into the Timelock.
            expect(extractQueue(finalizeTx, env.timelock.address)).toBeUndefined();

            const execTx = await env.governor.sendExecuteProposal(env.deployer.getSender(), { proposalId: id });
            expect(execTx.transactions).toHaveTransaction({ on: proposal.address, success: true });
            expect(await proposal.getGetState()).toBe(PS_EXECUTED);
        });
    });

    describe('Negative cases', () => {
        it('rejects a ProposalVoteRelay not coming from the staking relay', async () => {
            const env = await setupGovernance('https://example.com/gov-neg-relay.json');
            const voter = await env.blockchain.treasury('gov-neg-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const target = await env.blockchain.treasury('neg-relay-target');
            const { proposal } = await createProposal(env, voter, TYPE_PARAM, paramPayload(target.address, 1));

            const attacker = await env.blockchain.treasury('vote-attacker');
            const tx = await proposal.send(
                attacker.getSender(),
                { value: toNano('0.1') },
                { $$type: 'ProposalVoteRelay', voter: attacker.address, support: true, vp: 10n ** 18n },
            );
            expect(tx.transactions).toHaveTransaction({
                on: proposal.address,
                success: false,
                exitCode: Proposal_errors_backward['Only vote relay'],
            });
            expect(await proposal.getGetForVotes()).toBe(0n);
        });

        it('rejects relayed vote with zero effective VP (unstaked voter)', async () => {
            const env = await setupGovernance('https://example.com/gov-neg-novp.json');
            const staker = await env.blockchain.treasury('gov-novp-staker');
            await stakeForVp(env, staker, 3, 100n * NANO_PER_BURN);

            const target = await env.blockchain.treasury('neg-novp-target');
            const { id, proposal } = await createProposal(env, staker, TYPE_PARAM, paramPayload(target.address, 1));

            const unstaked = await env.blockchain.treasury('gov-unstaked');
            const tx = await castVote(env, unstaked, id, true);
            expect(tx.transactions).toHaveTransaction({
                on: env.stakingMaster.address,
                success: false,
                exitCode: StakingMaster_errors_backward['Zero effective vp'],
            });
            expect(await proposal.getHasVoted(unstaked.address)).toBe(false);
        });

        it('rejects finalize before the voting window closes', async () => {
            const env = await setupGovernance('https://example.com/gov-neg-early.json');
            const voter = await env.blockchain.treasury('gov-early-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const target = await env.blockchain.treasury('neg-early-target');
            const { proposal } = await createProposal(env, voter, TYPE_PARAM, paramPayload(target.address, 1));

            const tx = await proposal.sendFinalize(env.deployer.getSender());
            expect(tx.transactions).toHaveTransaction({
                on: proposal.address,
                success: false,
                exitCode: Proposal_errors_backward['Still voting'],
            });
        });

        it('rejects Timelock execution before the delay elapses', async () => {
            const env = await setupGovernance('https://example.com/gov-neg-tl.json');
            const voter = await env.blockchain.treasury('gov-tl-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const target = await env.blockchain.treasury('neg-tl-target');
            const { id, proposal } = await createProposal(env, voter, TYPE_PARAM, paramPayload(target.address, 7));
            await castVote(env, voter, id, true);
            advanceTime(env.blockchain, 3 * DAY + 1);
            const finalizeTx = await proposal.sendFinalize(env.deployer.getSender());
            const queued = extractQueue(finalizeTx, env.timelock.address)!;

            await env.timelock.sendQueue(env.deployer.getSender(), {
                proposalId: queued.proposalId,
                proposalContract: queued.proposalContract,
                target: queued.target,
                method: queued.method,
                args: queued.args,
                delay: queued.delay,
            });
            // No time advance: ETA not reached yet.
            const execTx = await env.timelock.sendExecutePending(env.deployer.getSender(), id);
            expect(execTx.transactions).toHaveTransaction({
                on: env.timelock.address,
                success: false,
                exitCode: Timelock_errors_backward['Not yet executable'],
            });
        });

        it('cancel: proposer can cancel inside the pre-vote window; outsider cannot; too late after voting opens', async () => {
            const env = await setupGovernance('https://example.com/gov-neg-cancel.json');
            const proposer = await env.blockchain.treasury('gov-cancel-proposer');
            await stakeForVp(env, proposer, 3, 100n * NANO_PER_BURN);

            const target = await env.blockchain.treasury('neg-cancel-target');

            // Inside the CANCEL_LAG window (voting not yet open): an outsider is rejected.
            const inWindow = await createProposal(env, proposer, TYPE_PARAM, paramPayload(target.address, 1), {
                openVoting: false,
            });
            const outsider = await env.blockchain.treasury('cancel-outsider');
            const badAuth = await inWindow.proposal.sendCancel(outsider.getSender());
            expect(badAuth.transactions).toHaveTransaction({
                on: inWindow.proposal.address,
                success: false,
                exitCode: Proposal_errors_backward['Only proposer'],
            });
            expect(await inWindow.proposal.getGetState()).toBe(PS_ACTIVE);

            // The proposer cancels within the reachable window → Cancelled, mirrored on the Governor.
            const cancelled = await inWindow.proposal.sendCancel(proposer.getSender());
            expect(cancelled.transactions).toHaveTransaction({ on: inWindow.proposal.address, success: true });
            expect(await inWindow.proposal.getGetState()).toBe(PS_CANCELLED);
            expect(await env.governor.getGetProposalState(inWindow.id)).toBe(PS_CANCELLED);

            // A fresh proposal whose voting has opened: cancellation is now "Too late".
            const opened = await createProposal(env, proposer, TYPE_PARAM, paramPayload(target.address, 2));
            const tooLate = await opened.proposal.sendCancel(proposer.getSender());
            expect(tooLate.transactions).toHaveTransaction({
                on: opened.proposal.address,
                success: false,
                exitCode: Proposal_errors_backward['Too late'],
            });
            expect(await opened.proposal.getGetState()).toBe(PS_ACTIVE);
        });
    });

    describe('quorum denominator is snapshotted on-chain from StakingMaster (IMP-AUDIT-02)', () => {
        // Quorum percent for Parameter proposals (type 0) — defaultGovernorProposalConfigs.
        const PARAM_QUORUM_PCT = 10n;

        it('stores the on-chain total VP from StakingMaster on the deployed proposal', async () => {
            const env = await setupGovernance('https://example.com/gov-vp-snapshot.json');
            const voter = await env.blockchain.treasury('gov-vp-snapshot-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const trueTotalVp = await env.stakingMaster.getGetTotalVotingPower();
            expect(trueTotalVp).toBeGreaterThan(0n);

            const target = await env.blockchain.treasury('vp-snapshot-target');
            const { proposal, createTx } = await createProposal(
                env,
                voter,
                TYPE_PARAM,
                paramPayload(target.address, 1),
            );

            // Phase-2 snapshot round-trip ran on the StakingMaster and deployed the proposal.
            expect(createTx.transactions).toHaveTransaction({
                on: env.stakingMaster.address,
                success: true,
            });

            expect(await proposal.getGetTotalVpSnapshot()).toBe(trueTotalVp);
            expect(await proposal.getGetQuorumRequired()).toBe((trueTotalVp * PARAM_QUORUM_PCT) / 100n);
        });

        it('honest voting flow gates on the trusted on-chain quorum denominator', async () => {
            const env = await setupGovernance('https://example.com/gov-vp-e2e.json');
            const voter = await env.blockchain.treasury('gov-vp-e2e-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const trueTotalVp = await env.stakingMaster.getGetTotalVotingPower();

            const target = await env.blockchain.treasury('vp-e2e-target');
            const { id, proposal } = await createProposal(
                env,
                voter,
                TYPE_PARAM,
                paramPayload(target.address, 1),
            );
            expect(await proposal.getGetQuorumRequired()).toBe((trueTotalVp * PARAM_QUORUM_PCT) / 100n);

            await castVote(env, voter, id, true);
            advanceTime(env.blockchain, 3 * DAY + 1);
            await proposal.sendFinalize(env.deployer.getSender());
            expect(await proposal.getGetState()).toBe(PS_SUCCEEDED);
        });
    });

    describe('RequestTotalVpSnapshot bounce (IMP-AUDIT-18)', () => {
        it('cancels reserved id when snapshot bounces and subsequent creation succeeds after wire', async () => {
            const env = await setupGovernanceUnwired('https://example.com/gov-snap-bounce.json');
            const proposer = await env.blockchain.treasury('gov-bounce-proposer');
            await stakeForVp(env, proposer, 3, 100n * NANO_PER_BURN);

            const idBefore = await env.governor.getGetProposalCount();
            const totalVp = await env.stakingMaster.getGetTotalVotingPower();
            const target = await env.blockchain.treasury('bounce-target');

            const createTx = await env.governor.sendCreateProposal(proposer.getSender(), {
                proposalType: TYPE_PARAM,
                payload: paramPayload(target.address, 1),
                claimedVp: totalVp,
            });

            expect(createTx.transactions).toHaveTransaction({
                on: env.stakingMaster.address,
                success: false,
                exitCode: StakingMaster_errors_backward['Only governor'],
            });
            expect(createTx.transactions).toHaveTransaction({
                on: env.governor.address,
                success: true,
            });

            expect(await env.governor.getGetProposalCount()).toBe(idBefore + 1n);
            expect(await env.governor.getGetProposal(idBefore)).toBeNull();
            expect(await env.governor.getGetProposalState(idBefore)).toBe(PS_CANCELLED);

            const wire = await env.stakingMaster.sendSetGovernor(
                env.deployer.getSender(),
                env.governor.address,
            );
            expect(wire.transactions).toHaveTransaction({ success: true });
            expect((await env.stakingMaster.getGetGovernorAddr()).equals(env.governor.address)).toBe(
                true,
            );

            const { id, proposal } = await createProposal(
                env,
                proposer,
                TYPE_PARAM,
                paramPayload(target.address, 2),
            );
            expect(id).toBe(idBefore + 1n);
            expect(await env.governor.getGetProposal(id)).not.toBeNull();
            expect(await env.governor.getGetProposalState(id)).toBe(PS_ACTIVE);
            expect(await proposal.getGetState()).toBe(PS_ACTIVE);
        });
    });
});

describe('Vote regressions (IMP-GOVOTE-05 / AD-3)', () => {
    it('relayed vote does not create Governor⇄StakingMaster cashback loop (RC-2)', async () => {
        const env = await setupGovernance('https://example.com/gov-no-loop.json');
        const voter = await env.blockchain.treasury('gov-no-loop-voter');
        await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

        const target = await env.blockchain.treasury('no-loop-target');
        const { id, proposal } = await createProposal(env, voter, TYPE_PARAM, paramPayload(target.address, 1));

        const voteTx = await castVote(env, voter, id, true);
        expect(voteTx.transactions).toHaveTransaction({ on: proposal.address, success: true });
        expect(await proposal.getGetForVotes()).toBeGreaterThan(0n);

        // Original RC-2 bug: 354 tx / ~349 empty hops; IMP-GOVOTE-08 RC-3: ~170 tx / ~164 Proposal↔SM hops.
        expect(voteTx.transactions.length).toBeLessThan(15);
        assertNoOutOfGas(voteTx.transactions);
        expect(
            countEmptyGovernorStakingHops(voteTx.transactions, env.governor.address, env.stakingMaster.address),
        ).toBe(0);
        expect(
            countEmptyProposalStakingHops(voteTx.transactions, proposal.address, env.stakingMaster.address),
        ).toBe(0);
    });

    it('rejects vote inside CANCEL_LAG window with Not started and does not record the vote (RC-1)', async () => {
        const env = await setupGovernance('https://example.com/gov-prevote.json');
        const voter = await env.blockchain.treasury('gov-prevote-voter');
        await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

        const target = await env.blockchain.treasury('prevote-target');
        const { id, proposal } = await createProposal(env, voter, TYPE_PARAM, paramPayload(target.address, 1), {
            openVoting: false,
        });

        const voteTx = await castVote(env, voter, id, true);
        expect(voteTx.transactions).toHaveTransaction({
            on: proposal.address,
            success: false,
            exitCode: Proposal_errors_backward['Not started'],
        });
        expect(await proposal.getGetForVotes()).toBe(0n);
        expect(await proposal.getHasVoted(voter.address)).toBe(false);

        // IMP-GOVOTE-03: bounced ProposalVoteRelay is handled on StakingMaster (not silently dropped).
        expect(voteTx.transactions).toHaveTransaction({
            on: env.stakingMaster.address,
            inMessageBounced: true,
            success: true,
        });
        assertNoOutOfGas(voteTx.transactions);
        expect(
            countEmptyGovernorStakingHops(voteTx.transactions, env.governor.address, env.stakingMaster.address),
        ).toBe(0);
    });

    it('handles bounced GovernorVoteRelay on Governor when StakingMaster rejects relay (IMP-GOVOTE-03)', async () => {
        const env = await setupGovernance('https://example.com/gov-bounce-gov-relay.json');
        const staker = await env.blockchain.treasury('gov-bounce-gov-staker');
        await stakeForVp(env, staker, 3, 100n * NANO_PER_BURN);

        const target = await env.blockchain.treasury('bounce-gov-target');
        const { id, proposal } = await createProposal(env, staker, TYPE_PARAM, paramPayload(target.address, 1));

        const unstaked = await env.blockchain.treasury('gov-bounce-unstaked');
        const voteTx = await castVote(env, unstaked, id, true);
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
        assertNoOutOfGas(voteTx.transactions);
        expect(
            countEmptyGovernorStakingHops(voteTx.transactions, env.governor.address, env.stakingMaster.address),
        ).toBe(0);
    });
});

describe('Execution relay audit (IMP-RELAY-02)', () => {
    it('param proposal finalize → queue → execute has no partner cashback loops', async () => {
        const env = await setupGovernance('https://example.com/gov-relay-param.json');
        const voter = await env.blockchain.treasury('gov-relay-param-voter');
        await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

        const target = await env.blockchain.treasury('relay-param-target');
        const { id, proposal } = await createProposal(
            env,
            voter,
            TYPE_PARAM,
            paramPayload(target.address, 0xabcd),
        );
        await castVote(env, voter, id, true);

        advanceTime(env.blockchain, 3 * DAY + 1);
        const finalizeTx = await proposal.sendFinalize(env.deployer.getSender());
        expect(await proposal.getGetState()).toBe(PS_SUCCEEDED);
        assertRelayFlowClean(finalizeTx.transactions, {
            partnerPairs: [
                [env.governor.address, proposal.address],
                [env.timelock.address, env.governor.address],
            ],
        });

        const queued = extractQueue(finalizeTx, env.timelock.address)!;
        const queueTx = await env.timelock.sendQueue(env.deployer.getSender(), {
            proposalId: queued.proposalId,
            proposalContract: queued.proposalContract,
            target: queued.target,
            method: queued.method,
            args: queued.args,
            delay: queued.delay,
        });
        assertRelayFlowClean(queueTx.transactions, {
            partnerPairs: [[env.timelock.address, env.governor.address]],
        });

        advanceTime(env.blockchain, DAY + 1);
        const execTx = await env.timelock.sendExecutePending(env.deployer.getSender(), id);
        expect(await proposal.getGetState()).toBe(PS_EXECUTED);
        assertRelayFlowClean(execTx.transactions, {
            partnerPairs: [
                [env.timelock.address, proposal.address],
                [env.governor.address, proposal.address],
            ],
        });
    });

    it('FeaturePriority off-chain execute has no Governor↔Proposal cashback loop', async () => {
        const env = await setupGovernance('https://example.com/gov-relay-feature.json');
        const voter = await env.blockchain.treasury('gov-relay-feat-voter');
        await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

        const { id, proposal } = await createProposal(
            env,
            voter,
            TYPE_FEATURE,
            featurePayload('relay audit feature'),
        );
        await castVote(env, voter, id, true);

        advanceTime(env.blockchain, 7 * DAY + 1);
        const finalizeTx = await proposal.sendFinalize(env.deployer.getSender());
        expect(extractQueue(finalizeTx, env.timelock.address)).toBeUndefined();
        assertRelayFlowClean(finalizeTx.transactions, {
            partnerPairs: [[env.governor.address, proposal.address]],
        });

        const execTx = await env.governor.sendExecuteProposal(env.deployer.getSender(), { proposalId: id });
        expect(await proposal.getGetState()).toBe(PS_EXECUTED);
        assertRelayFlowClean(execTx.transactions, {
            partnerPairs: [[env.governor.address, proposal.address]],
        });
    });

    it('TreasurySpend execute preserves PREMNT-07 payout and has no Timelock↔Proposal loop', async () => {
        const env = await setupGovernance('https://example.com/gov-relay-treasury.json');
        const voter = await env.blockchain.treasury('gov-relay-treas-voter');
        await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

        const treasury = env.blockchain.openContract(
            await Treasury.prepareInit(env.timelock.address, env.jettonMaster.address),
        );
        await treasury.send(env.deployer.getSender(), { value: toNano('0.2') }, null);

        const spendAmount = 5n * NANO_PER_BURN;
        await fundTreasury(env, treasury, 50n * NANO_PER_BURN);

        const recipient = await env.blockchain.treasury('relay-treas-recipient');
        const { id, proposal } = await createProposal(
            env,
            voter,
            TYPE_TREASURY,
            treasurySpendPayload(treasury.address, recipient.address, spendAmount, 'relay grant'),
        );
        await castVote(env, voter, id, true);

        advanceTime(env.blockchain, 7 * DAY + 1);
        const finalizeTx = await proposal.sendFinalize(env.deployer.getSender());
        assertRelayFlowClean(finalizeTx.transactions, {
            partnerPairs: [
                [env.governor.address, proposal.address],
                [env.timelock.address, env.governor.address],
            ],
        });

        const queued = extractQueue(finalizeTx, env.timelock.address)!;
        await env.timelock.sendQueue(env.deployer.getSender(), {
            proposalId: queued.proposalId,
            proposalContract: queued.proposalContract,
            target: queued.target,
            method: queued.method,
            args: queued.args,
            delay: queued.delay,
        });
        advanceTime(env.blockchain, 2 * DAY + 1);

        const execTx = await env.timelock.send(
            env.deployer.getSender(),
            { value: toNano('1.6') },
            { $$type: 'TimelockExecutePending', queryId: 0n, proposalId: id },
        );

        expect(execTx.transactions).toHaveTransaction({
            on: treasury.address,
            op: OP_TREASURY_SPEND,
            success: true,
        });
        expect(execTx.transactions).toHaveTransaction({ op: OP_JETTON_TRANSFER, success: true });
        expect(await treasury.getGetTotalSpent()).toBe(spendAmount);
        expect(await proposal.getGetState()).toBe(PS_EXECUTED);
        assertRelayFlowClean(execTx.transactions, {
            partnerPairs: [[env.timelock.address, proposal.address]],
        });
    });
});
