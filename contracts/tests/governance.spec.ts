import { Blockchain, SandboxContract, SendMessageResult, TreasuryContract, internal } from '@ton/sandbox';
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
import {
    Treasury_errors_backward,
    storeJettonNotification,
    storeJettonTransfer,
    storeTreasurySpend,
} from '../build/Treasury/Treasury_Treasury';
import { StakingMaster_errors_backward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { NANO_PER_BURN, SANDBOX_NOW } from './helpers';
import {
    assertRelayFlowClean,
    countEmptyBodyHopsBetween,
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

// Canonical opcodes (governance-messages.tact / treasury.tact / vesting.tact).
const OP_TIMELOCK_QUEUE = 0x5a040201;
const OP_TREASURY_SPEND = 0x5a1c9010;
const OP_VEST_EMERGENCY_REVOKE = 0x5a060002;
const OP_JETTON_TRANSFER = 0xf8a7ea5;
// IMP-MNAUD-F18: wallet → owner commit-stage failure signal.
const OP_JETTON_TRANSFER_COMMIT_FAILED = 0x6a3b2c22;

// ProposalType enum (governance-payload.tact).
const TYPE_PARAM = 0;
const TYPE_FEATURE = 1;
const TYPE_TREASURY = 2;
const TYPE_EMERGENCY = 3;

type GovEnv = StakingTestEnv & {
    timelock: SandboxContract<Timelock>;
    governor: SandboxContract<Governor>;
    treasuryAddress: Address;
};

async function canonicalTreasuryAddress(timelock: Address, jettonMaster: Address): Promise<Address> {
    const init = await Treasury.prepareInit(timelock, jettonMaster);
    return init.address;
}

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

    const treasuryAddress = await canonicalTreasuryAddress(timelock.address, env.jettonMaster.address);

    const governor = blockchain.openContract(
        await Governor.prepareInit({
            minProposalVp,
            stakingMaster: stakingMaster.address,
            stakingLock: stakingLock.address,
            timelock: timelock.address,
            timelockDelaySec: BigInt(2 * DAY),
            treasury: treasuryAddress,
        }),
    );
    await governor.send(deployer.getSender(), { value: toNano('1') }, null);

    // One-shot re-point of StakingMaster.governorAddr from the bootstrap
    // placeholder (deployer) to the real Governor so vote relays are accepted.
    const setGov = await stakingMaster.sendSetGovernor(deployer.getSender(), governor.address);
    expect(setGov.transactions).toHaveTransaction({ success: true });
    expect((await stakingMaster.getGetGovernorAddr()).equals(governor.address)).toBe(true);

    return { ...env, timelock, governor, treasuryAddress };
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

    const treasuryAddress = await canonicalTreasuryAddress(timelock.address, env.jettonMaster.address);

    const governor = blockchain.openContract(
        await Governor.prepareInit({
            minProposalVp,
            stakingMaster: stakingMaster.address,
            stakingLock: stakingLock.address,
            timelock: timelock.address,
            timelockDelaySec: BigInt(2 * DAY),
            treasury: treasuryAddress,
        }),
    );
    await governor.send(deployer.getSender(), { value: toNano('1') }, null);

    expect((await stakingMaster.getGetGovernorAddr()).equals(deployer.address)).toBe(true);
    return { ...env, timelock, governor, treasuryAddress };
}

/**
 * Minimal Timelock-only sandbox (no staking/governor stack). The deployer acts
 * as `Timelock.governor` — same wiring as `setupGovernance` — so `sendQueue` /
 * `sendExecutePending` can be driven directly. Enough for the queue-delay and
 * eta gates (IMP-TNFS-F18 / IMP-MNAUD-F03), which never touch the Proposal
 * state machine. `highValueDelayFloorSec` defaults to the mainnet 48h floor;
 * pass a short value to mirror a lab short-timer deploy.
 */
async function setupTimelockOnly(highValueDelayFloorSec?: bigint): Promise<{
    blockchain: Blockchain;
    deployer: SandboxContract<TreasuryContract>;
    timelock: SandboxContract<Timelock>;
}> {
    const blockchain = await Blockchain.create();
    blockchain.now = SANDBOX_NOW;
    const deployer = await blockchain.treasury('deployer');
    const timelock = blockchain.openContract(
        await Timelock.prepareInit(deployer.address, highValueDelayFloorSec),
    );
    await timelock.send(deployer.getSender(), { value: toNano('0.2') }, null);
    return { blockchain, deployer, timelock };
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

/** Deliver `TreasurySpend` as if from the Timelock (sandbox `sender()` = timelock). */
async function deliverTreasurySpend(
    env: GovEnv,
    treasury: SandboxContract<Treasury>,
    p: {
        queryId: bigint;
        recipient: Address;
        amount: bigint;
        reason: string;
        proposalId: bigint;
        value?: bigint;
    },
): Promise<SendMessageResult> {
    return env.blockchain.sendMessage(
        internal({
            from: env.timelock.address,
            to: treasury.address,
            // IMP-MNAUD-F11: treasury is excluded → its payout JettonTransfer resolves via
            // master with the minTonFeePath (2.05) entry gate; 1.6 TON no longer clears it.
            value: p.value ?? toNano('4'),
            bounce: true,
            body: beginCell()
                .store(
                    storeTreasurySpend({
                        $$type: 'TreasurySpend',
                        queryId: p.queryId,
                        recipient: p.recipient,
                        amount: p.amount,
                        reason: p.reason,
                        proposalId: p.proposalId,
                    }),
                )
                .endCell(),
        }),
    );
}

/**
 * Inject a bounced `JettonTransfer` into Treasury (IMP-MNAUD-F12).
 * Body layout mirrors TON bounce truncation: `0xffffffff` + opcode + queryId + amount
 * (Tact `bounced<JettonTransfer>` only loads those prefix fields).
 */
async function bounceTreasuryJettonTransfer(
    env: GovEnv,
    treasury: SandboxContract<Treasury>,
    p: { queryId: bigint; amount: bigint; destination: Address },
): Promise<SendMessageResult> {
    const wallet = await env.jettonMaster.getGetWalletAddress(treasury.address);
    return env.blockchain.sendMessage(
        internal({
            from: wallet,
            to: treasury.address,
            value: toNano('0.05'),
            bounced: true,
            body: beginCell()
                .storeUint(0xffffffff, 32)
                .store(
                    storeJettonTransfer({
                        $$type: 'JettonTransfer',
                        queryId: p.queryId,
                        amount: p.amount,
                        destination: p.destination,
                        responseDestination: p.destination,
                        customPayload: null,
                        forwardTonAmount: 0n,
                        forwardPayload: beginCell().storeUint(0, 1).asSlice(),
                    }),
                )
                .endCell(),
        }),
    );
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
            expect(queued!.delay).toBe(BigInt(2 * DAY));
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

            advanceTime(env.blockchain, 2 * DAY + 1);
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
            // IMP-MNAUD-F11 raised the wallet entry gate to minTonFeePath (2.05),
            // so the budget is 4 TON (surplus refunds to the recipient).
            const execTx = await env.timelock.send(
                env.deployer.getSender(),
                { value: toNano('4') },
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

            const treasuryJw = await env.jettonMaster.getGetWalletAddress(treasury.address);
            assertRelayFlowClean(execTx.transactions, {
                partnerPairs: [
                    [env.timelock.address, treasury.address],
                    [treasury.address, treasuryJw],
                ],
            });
        });

        it('rejects TreasurySpend create when payload treasury is not canonical', async () => {
            const env = await setupGovernance('https://example.com/gov-treasury-mismatch.json');
            const voter = await env.blockchain.treasury('gov-treas-mismatch-voter');
            await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

            const wrongTreasury = await env.blockchain.treasury('wrong-treasury-target');
            const recipient = await env.blockchain.treasury('treas-mismatch-recipient');
            const totalVp = await env.stakingMaster.getGetTotalVotingPower();

            const createTx = await env.governor.sendCreateProposal(voter.getSender(), {
                proposalType: TYPE_TREASURY,
                payload: treasurySpendPayload(
                    wrongTreasury.address,
                    recipient.address,
                    1n * NANO_PER_BURN,
                    'mismatched treasury',
                ),
                claimedVp: totalVp,
            });
            expect(createTx.transactions).toHaveTransaction({ on: env.governor.address, success: false });
            expect((await env.governor.getGetProposalCount())).toBe(0n);
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

        // IMP-MNAUD-F12: bounce must key rollback by queryId (not LIFO last log entry).
        it('interleaved bounce of first JettonTransfer rolls back that spend (different amounts)', async () => {
            const env = await setupGovernance('https://example.com/gov-treasury-bounce-diff.json');
            const treasury = env.blockchain.openContract(
                await Treasury.prepareInit(env.timelock.address, env.jettonMaster.address),
            );
            await treasury.send(env.deployer.getSender(), { value: toNano('0.2') }, null);
            await fundTreasury(env, treasury, 50n * NANO_PER_BURN);

            const recipientA = await env.blockchain.treasury('bounce-diff-a');
            const recipientB = await env.blockchain.treasury('bounce-diff-b');
            const amountA = 3n * NANO_PER_BURN;
            const amountB = 5n * NANO_PER_BURN;
            const queryA = 111n;
            const queryB = 222n;

            const spendA = await deliverTreasurySpend(env, treasury, {
                queryId: queryA,
                recipient: recipientA.address,
                amount: amountA,
                reason: 'first',
                proposalId: queryA,
            });
            expect(spendA.transactions).toHaveTransaction({
                on: treasury.address,
                op: OP_TREASURY_SPEND,
                success: true,
            });

            const spendB = await deliverTreasurySpend(env, treasury, {
                queryId: queryB,
                recipient: recipientB.address,
                amount: amountB,
                reason: 'second',
                proposalId: queryB,
            });
            expect(spendB.transactions).toHaveTransaction({
                on: treasury.address,
                op: OP_TREASURY_SPEND,
                success: true,
            });
            expect(await treasury.getGetTotalSpent()).toBe(amountA + amountB);
            expect(await treasury.getGetSpendingCount()).toBe(2n);

            // Bounce the FIRST transfer after the second spend is already logged (LIFO would mismatch).
            const bounceTx = await bounceTreasuryJettonTransfer(env, treasury, {
                queryId: queryA,
                amount: amountA,
                destination: recipientA.address,
            });
            expect(bounceTx.transactions).toHaveTransaction({
                on: treasury.address,
                inMessageBounced: true,
                success: true,
            });

            expect(await treasury.getGetTotalSpent()).toBe(amountB);
            expect(await treasury.getGetSpendingCount()).toBe(1n);
            const remaining = (await treasury.getGetSpendingHistory()).get(0n);
            expect(remaining).toBeDefined();
            expect(remaining!.recipient.equals(recipientB.address)).toBe(true);
            expect(remaining!.amount).toBe(amountB);
            expect(remaining!.proposalId).toBe(queryB);
            expect(remaining!.queryId).toBe(queryB);
        });

        it('interleaved equal-amount bounce removes the matching queryId entry (not LIFO)', async () => {
            const env = await setupGovernance('https://example.com/gov-treasury-bounce-eq.json');
            const treasury = env.blockchain.openContract(
                await Treasury.prepareInit(env.timelock.address, env.jettonMaster.address),
            );
            await treasury.send(env.deployer.getSender(), { value: toNano('0.2') }, null);
            await fundTreasury(env, treasury, 50n * NANO_PER_BURN);

            const recipientA = await env.blockchain.treasury('bounce-eq-a');
            const recipientB = await env.blockchain.treasury('bounce-eq-b');
            const amount = 5n * NANO_PER_BURN;
            const queryA = 333n;
            const queryB = 444n;

            await deliverTreasurySpend(env, treasury, {
                queryId: queryA,
                recipient: recipientA.address,
                amount,
                reason: 'eq-first',
                proposalId: queryA,
            });
            await deliverTreasurySpend(env, treasury, {
                queryId: queryB,
                recipient: recipientB.address,
                amount,
                reason: 'eq-second',
                proposalId: queryB,
            });
            expect(await treasury.getGetSpendingCount()).toBe(2n);

            const bounceTx = await bounceTreasuryJettonTransfer(env, treasury, {
                queryId: queryA,
                amount,
                destination: recipientA.address,
            });
            expect(bounceTx.transactions).toHaveTransaction({
                on: treasury.address,
                inMessageBounced: true,
                success: true,
            });

            // LIFO would delete B and leave A; queryId match must leave B.
            expect(await treasury.getGetTotalSpent()).toBe(amount);
            expect(await treasury.getGetSpendingCount()).toBe(1n);
            const remaining = (await treasury.getGetSpendingHistory()).get(0n);
            expect(remaining).toBeDefined();
            expect(remaining!.recipient.equals(recipientB.address)).toBe(true);
            expect(remaining!.reason).toBe('eq-second');
            expect(remaining!.queryId).toBe(queryB);
        });

        // IMP-MNAUD-F18: after F11 the treasury payout always resolves via master —
        // a balance failure must still roll back total_spent/spending_log (F12
        // invariant on the resolve path).
        it('spend exceeding real wallet balance bounces at the wallet and rolls back accounting (IMP-MNAUD-F18)', async () => {
            const env = await setupGovernance('https://example.com/gov-treasury-f18-entry.json');
            const treasury = env.blockchain.openContract(
                await Treasury.prepareInit(env.timelock.address, env.jettonMaster.address),
            );
            await treasury.send(env.deployer.getSender(), { value: toNano('0.2') }, null);
            await fundTreasury(env, treasury, 10n * NANO_PER_BURN);

            // Desync accounting from reality: forge a JettonNotification from the
            // treasury wallet crediting BURN that never physically arrived.
            const treasuryJw = await env.jettonMaster.getGetWalletAddress(treasury.address);
            const phantom = 500n * NANO_PER_BURN;
            await env.blockchain.sendMessage(
                internal({
                    from: treasuryJw,
                    to: treasury.address,
                    value: toNano('0.05'),
                    body: beginCell()
                        .store(
                            storeJettonNotification({
                                $$type: 'JettonNotification',
                                queryId: 1n,
                                amount: phantom,
                                sender: env.deployer.address,
                                forwardPayload: beginCell().storeUint(0, 1).asSlice(),
                            }),
                        )
                        .endCell(),
                }),
            );
            expect(await treasury.getGetTotalReceived()).toBe(10n * NANO_PER_BURN + phantom);

            const recipient = await env.blockchain.treasury('f18-entry-recipient');
            const spendAmount = 100n * NANO_PER_BURN; // > real wallet balance of 10 BURN
            const spendTx = await deliverTreasurySpend(env, treasury, {
                queryId: 555n,
                recipient: recipient.address,
                amount: spendAmount,
                reason: 'f18-entry',
                proposalId: 555n,
            });

            // The outbound JettonTransfer must abort at the wallet itself (natural
            // bounce), not hop to master and die silently at CommitJettonTransfer.
            expect(spendTx.transactions).toHaveTransaction({
                from: treasury.address,
                to: treasuryJw,
                op: OP_JETTON_TRANSFER,
                success: false,
            });
            expect(spendTx.transactions).toHaveTransaction({
                on: treasury.address,
                inMessageBounced: true,
                success: true,
            });
            expect(await treasury.getGetTotalSpent()).toBe(0n);
            expect(await treasury.getGetSpendingCount()).toBe(0n);
        });

        // IMP-MNAUD-F18: commit-stage race window — the wallet reports the failure
        // with an explicit JettonTransferCommitFailed; Treasury must roll back the
        // matching queryId entry.
        it('JettonTransferCommitFailed from the treasury wallet rolls back the matching spend (IMP-MNAUD-F18)', async () => {
            const env = await setupGovernance('https://example.com/gov-treasury-f18-commit.json');
            const treasury = env.blockchain.openContract(
                await Treasury.prepareInit(env.timelock.address, env.jettonMaster.address),
            );
            await treasury.send(env.deployer.getSender(), { value: toNano('0.2') }, null);
            await fundTreasury(env, treasury, 50n * NANO_PER_BURN);

            const recipientA = await env.blockchain.treasury('f18-commit-a');
            const recipientB = await env.blockchain.treasury('f18-commit-b');
            const amountA = 3n * NANO_PER_BURN;
            const amountB = 5n * NANO_PER_BURN;
            const queryA = 555n;
            const queryB = 666n;

            await deliverTreasurySpend(env, treasury, {
                queryId: queryA,
                recipient: recipientA.address,
                amount: amountA,
                reason: 'f18-first',
                proposalId: queryA,
            });
            await deliverTreasurySpend(env, treasury, {
                queryId: queryB,
                recipient: recipientB.address,
                amount: amountB,
                reason: 'f18-second',
                proposalId: queryB,
            });
            expect(await treasury.getGetTotalSpent()).toBe(amountA + amountB);
            expect(await treasury.getGetSpendingCount()).toBe(2n);

            // Inject the wallet's commit-stage failure signal for spend A.
            // Body layout: opcode 0x6a3b2c22 + queryId (uint64) + amount (coins).
            const treasuryJw = await env.jettonMaster.getGetWalletAddress(treasury.address);
            const failTx = await env.blockchain.sendMessage(
                internal({
                    from: treasuryJw,
                    to: treasury.address,
                    value: toNano('0.05'),
                    body: beginCell()
                        .storeUint(OP_JETTON_TRANSFER_COMMIT_FAILED, 32)
                        .storeUint(queryA, 64)
                        .storeCoins(amountA)
                        .endCell(),
                }),
            );
            expect(failTx.transactions).toHaveTransaction({
                on: treasury.address,
                success: true,
            });
            expect(await treasury.getGetTotalSpent()).toBe(amountB);
            expect(await treasury.getGetSpendingCount()).toBe(1n);
            const remaining = (await treasury.getGetSpendingHistory()).get(0n);
            expect(remaining).toBeDefined();
            expect(remaining!.queryId).toBe(queryB);
            expect(remaining!.recipient.equals(recipientB.address)).toBe(true);

            // Rogue sender must not be able to fake rollbacks.
            const rogue = await env.blockchain.treasury('f18-commit-rogue');
            const rogueTx = await env.blockchain.sendMessage(
                internal({
                    from: rogue.address,
                    to: treasury.address,
                    value: toNano('0.05'),
                    body: beginCell()
                        .storeUint(OP_JETTON_TRANSFER_COMMIT_FAILED, 32)
                        .storeUint(queryB, 64)
                        .storeCoins(amountB)
                        .endCell(),
                }),
            );
            expect(rogueTx.transactions).toHaveTransaction({
                on: treasury.address,
                success: false,
            });
            expect(await treasury.getGetTotalSpent()).toBe(amountB);
            expect(await treasury.getGetSpendingCount()).toBe(1n);
        });

        // IMP-MNAUD-F19: MIN_SPEND_FORWARD must cover the post-F11 wallet entry gate
        // (minTonFeePath 2.05 + fwd fee). Attach in the 1.0–2.05 gap must fail loudly
        // at the Treasury require — before any accounting mutation — instead of
        // logging a spend that bounces at the wallet.
        it('TreasurySpend attach below the post-F11 wallet gate is rejected up front (IMP-MNAUD-F19)', async () => {
            const env = await setupGovernance('https://example.com/gov-treasury-f19-floor.json');
            const treasury = env.blockchain.openContract(
                await Treasury.prepareInit(env.timelock.address, env.jettonMaster.address),
            );
            await treasury.send(env.deployer.getSender(), { value: toNano('0.2') }, null);
            await fundTreasury(env, treasury, 50n * NANO_PER_BURN);

            const recipient = await env.blockchain.treasury('f19-floor-recipient');
            const spendTx = await deliverTreasurySpend(env, treasury, {
                queryId: 777n,
                recipient: recipient.address,
                amount: 5n * NANO_PER_BURN,
                reason: 'f19-floor',
                proposalId: 777n,
                value: toNano('1.5'), // old floor 1.0 < 1.5 < post-F11 gate ~2.06
            });

            expect(spendTx.transactions).toHaveTransaction({
                on: treasury.address,
                success: false,
                exitCode: Treasury_errors_backward['Insufficient gas for spend'],
            });
            // Fail loudly BEFORE any accounting mutation: no outbound transfer, no log entry.
            expect(spendTx.transactions).not.toHaveTransaction({ op: OP_JETTON_TRANSFER });
            expect(await treasury.getGetTotalSpent()).toBe(0n);
            expect(await treasury.getGetSpendingCount()).toBe(0n);
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

        advanceTime(env.blockchain, 2 * DAY + 1);
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

        // IMP-MNAUD-F11: treasury payout resolves via master (minTonFeePath gate) — 4 TON budget.
        const execTx = await env.timelock.send(
            env.deployer.getSender(),
            { value: toNano('4') },
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
        const treasuryJw = await env.jettonMaster.getGetWalletAddress(treasury.address);
        assertRelayFlowClean(execTx.transactions, {
            partnerPairs: [
                [env.timelock.address, proposal.address],
                [env.timelock.address, treasury.address],
                [treasury.address, treasuryJw],
            ],
        });
    });
});

/**
 * IMP-TNFS-F18 — sandbox coverage of the Timelock delay-wait path.
 *
 * The lab governor declares timelockDelaySec=60, which the scenario harness
 * historically clamped 60→0 (IMP-TNFS-F17; since IMP-MNAUD-F03 the clamp only
 * applies to non-high-value methods / pre-floor tips), so LIVE runs never
 * exercise the 24h wait. These tests are the only place the real delay
 * semantics are verified:
 *  - full queue → early-reject → execute flow on the production Timelock delay (48h);
 *  - the `Delay too short` gate (0 < delay < TIMELOCK_MIN_DELAY_SEC) that broke
 *    the 2026-07-25 live run and motivated the F17 clamp;
 *  - the eta boundary: `now() >= scheduledTime` admits execution at exactly eta.
 */
describe('Timelock delay gates (IMP-TNFS-F18)', () => {
    it('single flow: queue (48h) → early execute bounces keeping pending → execute past eta succeeds', async () => {
        const env = await setupGovernance('https://example.com/gov-tnfs-f18-flow.json');
        const voter = await env.blockchain.treasury('tnfs-f18-voter');
        await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

        const target = await env.blockchain.treasury('tnfs-f18-target');
        const { id, proposal } = await createProposal(env, voter, TYPE_PARAM, paramPayload(target.address, 0x18));
        await castVote(env, voter, id, true);
        advanceTime(env.blockchain, 3 * DAY + 1);
        const finalizeTx = await proposal.sendFinalize(env.deployer.getSender());
        expect(await proposal.getGetState()).toBe(PS_SUCCEEDED);
        const queued = extractQueue(finalizeTx, env.timelock.address)!;
        expect(queued.delay).toBe(BigInt(2 * DAY));

        const queueTx = await env.timelock.sendQueue(env.deployer.getSender(), {
            proposalId: queued.proposalId,
            proposalContract: queued.proposalContract,
            target: queued.target,
            method: queued.method,
            args: queued.args,
            delay: queued.delay,
        });
        expect(queueTx.transactions).toHaveTransaction({ on: env.timelock.address, success: true });
        const pendingBefore = await env.timelock.getGetPending(id);
        expect(pendingBefore).not.toBeNull();

        // Immediate execute attempt: eta is two days away.
        const earlyTx = await env.timelock.sendExecutePending(env.deployer.getSender(), id);
        expect(earlyTx.transactions).toHaveTransaction({
            on: env.timelock.address,
            success: false,
            exitCode: Timelock_errors_backward['Not yet executable'],
        });
        // The bounce must not consume the pending action or move the proposal.
        const pendingAfter = await env.timelock.getGetPending(id);
        expect(pendingAfter).not.toBeNull();
        expect(pendingAfter!.scheduledTime).toBe(pendingBefore!.scheduledTime);
        expect(await proposal.getGetState()).toBe(PS_SUCCEEDED);

        advanceTime(env.blockchain, 2 * DAY + 1);
        const execTx = await env.timelock.sendExecutePending(env.deployer.getSender(), id);
        expect(execTx.transactions).toHaveTransaction({ on: env.timelock.address, success: true });
        expect(execTx.transactions).toHaveTransaction({ on: proposal.address, success: true });
        expect(await proposal.getGetState()).toBe(PS_EXECUTED);
        expect(await env.timelock.getGetPending(id)).toBeNull();
    });

    it('queue gate: 0 < delay < 24h bounces with Delay too short and creates no pending; 24h is accepted', async () => {
        const { blockchain, deployer, timelock } = await setupTimelockOnly();
        const proposalStub = await blockchain.treasury('tnfs-f18-gate-proposal');
        const target = await blockchain.treasury('tnfs-f18-gate-target');
        const queueParams = {
            proposalId: 1n,
            proposalContract: proposalStub.address,
            target: target.address,
            method: 0x1234n,
            args: beginCell().endCell(),
        };

        // Lab value (60s, broke the 2026-07-25 live run) and the last invalid
        // value below TIMELOCK_MIN_DELAY_SEC.
        for (const delay of [60n, BigInt(DAY - 1)]) {
            const tx = await timelock.sendQueue(deployer.getSender(), { ...queueParams, delay });
            expect(tx.transactions).toHaveTransaction({
                on: timelock.address,
                success: false,
                exitCode: Timelock_errors_backward['Delay too short'],
            });
            expect(await timelock.getGetPending(queueParams.proposalId)).toBeNull();
        }

        // The contract minimum itself passes the gate.
        const okTx = await timelock.sendQueue(deployer.getSender(), { ...queueParams, delay: BigInt(DAY) });
        expect(okTx.transactions).toHaveTransaction({ on: timelock.address, success: true });
        const pending = await timelock.getGetPending(queueParams.proposalId);
        expect(pending).not.toBeNull();
        expect(pending!.scheduledTime).toBe(BigInt(SANDBOX_NOW + DAY));
    });

    it('eta boundary: execute at exactly now == scheduledTime succeeds', async () => {
        const { blockchain, deployer, timelock } = await setupTimelockOnly();
        const proposalStub = await blockchain.treasury('tnfs-f18-eta-proposal');
        const target = await blockchain.treasury('tnfs-f18-eta-target');

        const queueTx = await timelock.sendQueue(deployer.getSender(), {
            proposalId: 7n,
            proposalContract: proposalStub.address,
            target: target.address,
            method: 0x18n,
            args: beginCell().endCell(),
            delay: BigInt(DAY),
        });
        expect(queueTx.transactions).toHaveTransaction({ on: timelock.address, success: true });
        const pending = await timelock.getGetPending(7n);
        expect(pending).not.toBeNull();

        // Land the clock exactly on eta — the contract gate is now() >= scheduledTime.
        advanceTime(blockchain, DAY);
        expect(BigInt(blockchain.now!)).toBe(pending!.scheduledTime);

        const execTx = await timelock.sendExecutePending(deployer.getSender(), 7n);
        expect(execTx.transactions).toHaveTransaction({ on: timelock.address, success: true });
        expect(await timelock.getGetPending(7n)).toBeNull();
    });
});

/**
 * IMP-MNAUD-F03 — high-value delay floor (audit MNAUD-3/H-2, owner decision 2026-07-27).
 *
 * TimelockQueue distinguishes high-value methods (TreasurySpend / VestEmergencyRevoke):
 * their delay must be > 0 AND >= `highValueDelayFloorSec` (init param — mainnet 172800 /
 * 48h, lab short floor), so the zero-delay emergency path can never carry a treasury
 * drain or vesting revoke. Non-high-value methods keep the original semantics
 * (delay == 0 || delay >= TIMELOCK_MIN_DELAY_SEC).
 */
describe('Timelock high-value delay floor (IMP-MNAUD-F03)', () => {
    const HIGH_VALUE_METHODS: Array<[string, bigint]> = [
        ['TreasurySpend', BigInt(OP_TREASURY_SPEND)],
        ['VestEmergencyRevoke', BigInt(OP_VEST_EMERGENCY_REVOKE)],
    ];

    function queueParamsFor(
        proposalContract: Address,
        target: Address,
        method: bigint,
        proposalId: bigint,
    ) {
        return {
            proposalId,
            proposalContract,
            target,
            method,
            args: beginCell().endCell(),
        };
    }

    it('mainnet default floor (48h): delay 0 and 0 < delay < floor are rejected for high-value methods', async () => {
        const { blockchain, deployer, timelock } = await setupTimelockOnly();
        expect(await timelock.getGetHighValueDelayFloor()).toBe(BigInt(2 * DAY));

        const proposalStub = await blockchain.treasury('mnaud-f03-proposal');
        const target = await blockchain.treasury('mnaud-f03-target');

        let proposalId = 1n;
        for (const [, method] of HIGH_VALUE_METHODS) {
            for (const delay of [0n, 60n, BigInt(DAY), BigInt(2 * DAY - 1)]) {
                const tx = await timelock.sendQueue(deployer.getSender(), {
                    ...queueParamsFor(proposalStub.address, target.address, method, proposalId),
                    delay,
                });
                expect(tx.transactions).toHaveTransaction({
                    on: timelock.address,
                    success: false,
                    exitCode: Timelock_errors_backward['High-value delay below floor'],
                });
                expect(await timelock.getGetPending(proposalId)).toBeNull();
                proposalId += 1n;
            }
        }
    });

    it('mainnet default floor: delay == floor and delay > floor are accepted for high-value methods', async () => {
        const { blockchain, deployer, timelock } = await setupTimelockOnly();
        const proposalStub = await blockchain.treasury('mnaud-f03-ok-proposal');
        const target = await blockchain.treasury('mnaud-f03-ok-target');

        let proposalId = 10n;
        for (const [, method] of HIGH_VALUE_METHODS) {
            for (const delay of [BigInt(2 * DAY), BigInt(3 * DAY)]) {
                const tx = await timelock.sendQueue(deployer.getSender(), {
                    ...queueParamsFor(proposalStub.address, target.address, method, proposalId),
                    delay,
                });
                expect(tx.transactions).toHaveTransaction({ on: timelock.address, success: true });
                const pending = await timelock.getGetPending(proposalId);
                expect(pending).not.toBeNull();
                expect(pending!.scheduledTime).toBe(BigInt(blockchain.now!) + delay);
                proposalId += 1n;
            }
        }
    });

    it('non-high-value methods keep the original gate: delay 0 accepted, short non-zero rejected', async () => {
        const { blockchain, deployer, timelock } = await setupTimelockOnly();
        const proposalStub = await blockchain.treasury('mnaud-f03-other-proposal');
        const target = await blockchain.treasury('mnaud-f03-other-target');

        // Emergency-style zero delay is still legal for non-high-value methods.
        const zeroTx = await timelock.sendQueue(deployer.getSender(), {
            ...queueParamsFor(proposalStub.address, target.address, 0x1234n, 20n),
            delay: 0n,
        });
        expect(zeroTx.transactions).toHaveTransaction({ on: timelock.address, success: true });
        expect(await timelock.getGetPending(20n)).not.toBeNull();

        // And the pre-existing TIMELOCK_MIN_DELAY_SEC gate still applies to non-zero delays.
        const shortTx = await timelock.sendQueue(deployer.getSender(), {
            ...queueParamsFor(proposalStub.address, target.address, 0x1234n, 21n),
            delay: 60n,
        });
        expect(shortTx.transactions).toHaveTransaction({
            on: timelock.address,
            success: false,
            exitCode: Timelock_errors_backward['Delay too short'],
        });
        expect(await timelock.getGetPending(21n)).toBeNull();
    });

    it('lab short floor (60s): high-value queue respects the floor and the execute eta', async () => {
        const LAB_FLOOR = 60n;
        const { blockchain, deployer, timelock } = await setupTimelockOnly(LAB_FLOOR);
        expect(await timelock.getGetHighValueDelayFloor()).toBe(LAB_FLOOR);

        const proposalStub = await blockchain.treasury('mnaud-f03-lab-proposal');
        const target = await blockchain.treasury('mnaud-f03-lab-target');
        const method = BigInt(OP_TREASURY_SPEND);

        // Below-floor (including zero) still bounces on the lab tip.
        for (const [proposalId, delay] of [
            [30n, 0n],
            [31n, 30n],
        ] as Array<[bigint, bigint]>) {
            const tx = await timelock.sendQueue(deployer.getSender(), {
                ...queueParamsFor(proposalStub.address, target.address, method, proposalId),
                delay,
            });
            expect(tx.transactions).toHaveTransaction({
                on: timelock.address,
                success: false,
                exitCode: Timelock_errors_backward['High-value delay below floor'],
            });
            expect(await timelock.getGetPending(proposalId)).toBeNull();
        }

        // delay == lab floor is accepted; early execute bounces; past eta it runs.
        // IMP-MNAUD-F08: high-value args must be a well-formed op-prefixed body
        // (op + queryId), and a successful dispatch keeps the entry as a
        // non-re-executable tombstone instead of deleting it.
        const okTx = await timelock.sendQueue(deployer.getSender(), {
            ...queueParamsFor(proposalStub.address, target.address, method, 32n),
            args: beginCell().storeUint(OP_TREASURY_SPEND, 32).storeUint(0, 64).endCell(),
            delay: LAB_FLOOR,
        });
        expect(okTx.transactions).toHaveTransaction({ on: timelock.address, success: true });
        const pending = await timelock.getGetPending(32n);
        expect(pending).not.toBeNull();
        expect(pending!.scheduledTime).toBe(BigInt(SANDBOX_NOW) + LAB_FLOOR);

        const earlyTx = await timelock.sendExecutePending(deployer.getSender(), 32n);
        expect(earlyTx.transactions).toHaveTransaction({
            on: timelock.address,
            success: false,
            exitCode: Timelock_errors_backward['Not yet executable'],
        });
        expect(await timelock.getGetPending(32n)).not.toBeNull();

        advanceTime(blockchain, Number(LAB_FLOOR));
        const execTx = await timelock.sendExecutePending(
            deployer.getSender(),
            32n,
            0n,
            toNano('1.6'),
        );
        expect(execTx.transactions).toHaveTransaction({ on: timelock.address, success: true });
        const dispatched = await timelock.getGetPending(32n);
        expect(dispatched).not.toBeNull();
        expect(dispatched!.executed).toBe(true);
    });
});

/**
 * IMP-MNAUD-F08 — Timelock high-value dispatch re-arm (audit MNAUD-7/A-2).
 *
 * Pre-fix, TimelockExecutePending deleted the pending action and marked the
 * proposal PS_EXECUTED BEFORE dispatching the target with bounce:false — a
 * failed TreasurySpend / VestEmergencyRevoke (underfunded gate, downstream
 * throw) was silently and irrecoverably lost (re-queue needs a fresh SUCCEEDED
 * proposal, ProposalFinalize is once).
 *
 * Post-fix, a high-value pending entry is kept (flagged `executed`), the
 * dispatch goes out with bounce:true and its queryId rewritten to the
 * proposalId, and the bounce of a failed target transaction re-arms the entry
 * (`executed` back to false) so execute can simply be retried. No bounce
 * arrives when the target succeeded, so a dispatched entry can never re-arm
 * into a double execution.
 */
describe('Timelock high-value dispatch re-arm (IMP-MNAUD-F08)', () => {
    /** Well-formed high-value args: op-prefixed body with a queryId field. */
    function treasurySpendArgsStub(): Cell {
        return beginCell().storeUint(OP_TREASURY_SPEND, 32).storeUint(0, 64).endCell();
    }

    it('underfunded treasury-spend execute re-arms the pending action; retry pays out; success is replay-protected', async () => {
        const env = await setupGovernance('https://example.com/gov-mnaud-f08-rearm.json');
        const voter = await env.blockchain.treasury('mnaud-f08-voter');
        await stakeForVp(env, voter, 3, 100n * NANO_PER_BURN);

        const treasury = env.blockchain.openContract(
            await Treasury.prepareInit(env.timelock.address, env.jettonMaster.address),
        );
        await treasury.send(env.deployer.getSender(), { value: toNano('0.2') }, null);

        const spendAmount = 5n * NANO_PER_BURN;
        await fundTreasury(env, treasury, 50n * NANO_PER_BURN);

        const recipient = await env.blockchain.treasury('mnaud-f08-recipient');
        const { id, proposal } = await createProposal(
            env,
            voter,
            TYPE_TREASURY,
            treasurySpendPayload(treasury.address, recipient.address, spendAmount, 'rearm grant'),
        );
        await castVote(env, voter, id, true);

        advanceTime(env.blockchain, 7 * DAY + 1);
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
        advanceTime(env.blockchain, 2 * DAY + 1);
        const pendingBefore = await env.timelock.getGetPending(id);
        expect(pendingBefore).not.toBeNull();

        // Underfunded execute: 0.3 TON clears the Timelock bounce-payability
        // floor (0.1) but fails Treasury's MIN_SPEND_FORWARD (1.0) gate — the
        // permissionless-executor griefing shape from the audit finding.
        const failExec = await env.timelock.send(
            env.deployer.getSender(),
            { value: toNano('0.3') },
            { $$type: 'TimelockExecutePending', queryId: 0n, proposalId: id },
        );
        expect(failExec.transactions).toHaveTransaction({
            on: treasury.address,
            op: OP_TREASURY_SPEND,
            success: false,
            exitCode: Treasury_errors_backward['Insufficient gas for spend'],
        });
        // The failed dispatch bounced back to the Timelock and was processed.
        expect(failExec.transactions).toHaveTransaction({
            on: env.timelock.address,
            inMessageBounced: true,
            success: true,
        });
        // Nothing spent; the pending action was re-armed and stays re-executable.
        expect(await treasury.getGetTotalSpent()).toBe(0n);
        const rearmed = await env.timelock.getGetPending(id);
        expect(rearmed).not.toBeNull();
        expect(rearmed!.executed).toBe(false);
        expect(rearmed!.scheduledTime).toBe(pendingBefore!.scheduledTime);
        expect(rearmed!.args.equals(pendingBefore!.args)).toBe(true);
        // Proposal-side PS_EXECUTED means "execution authorized & dispatched";
        // the Timelock pending map is the source of truth for completion.
        expect(await proposal.getGetState()).toBe(PS_EXECUTED);

        // Retry the SAME pending with the PREMNT-07-sized budget → payout settles.
        // IMP-MNAUD-F11: budget raised to 4 TON (wallet entry gate is minTonFeePath 2.05).
        const okExec = await env.timelock.send(
            env.deployer.getSender(),
            { value: toNano('4') },
            { $$type: 'TimelockExecutePending', queryId: 0n, proposalId: id },
        );
        expect(okExec.transactions).toHaveTransaction({
            on: treasury.address,
            op: OP_TREASURY_SPEND,
            success: true,
        });
        expect(okExec.transactions).toHaveTransaction({ op: OP_JETTON_TRANSFER, success: true });
        // The re-sent ProposalMarkExecuted is rejected by the already-Executed
        // proposal — expected and harmless (bounce:false).
        expect(okExec.transactions).toHaveTransaction({
            on: proposal.address,
            success: false,
            exitCode: Proposal_errors_backward['Not succeeded'],
        });
        expect(await treasury.getGetTotalSpent()).toBe(spendAmount);
        expect(await treasury.getGetSpendingCount()).toBe(1n);
        const recipientWallet = env.blockchain.openContract(
            BurnJettonWallet.fromAddress(await env.jettonMaster.getGetWalletAddress(recipient.address)),
        );
        expect((await recipientWallet.getGetWalletData()).balance).toBe(spendAmount);

        // Success left a non-re-executable tombstone: replay bounces, no double spend.
        const done = await env.timelock.getGetPending(id);
        expect(done).not.toBeNull();
        expect(done!.executed).toBe(true);
        const replay = await env.timelock.send(
            env.deployer.getSender(),
            { value: toNano('1.6') },
            { $$type: 'TimelockExecutePending', queryId: 0n, proposalId: id },
        );
        expect(replay.transactions).toHaveTransaction({
            on: env.timelock.address,
            success: false,
            exitCode: Timelock_errors_backward['Already executed'],
        });
        expect(await treasury.getGetTotalSpent()).toBe(spendAmount);
        expect(await treasury.getGetSpendingCount()).toBe(1n);
    });

    it('execute attach below the bounce-payability floor is rejected up front', async () => {
        const { blockchain, deployer, timelock } = await setupTimelockOnly();
        const proposalStub = await blockchain.treasury('mnaud-f08-floor-proposal');
        const target = await blockchain.treasury('mnaud-f08-floor-target');

        await timelock.sendQueue(deployer.getSender(), {
            proposalId: 1n,
            proposalContract: proposalStub.address,
            target: target.address,
            method: BigInt(OP_TREASURY_SPEND),
            args: treasurySpendArgsStub(),
            delay: BigInt(2 * DAY),
        });
        advanceTime(blockchain, 2 * DAY + 1);

        const tx = await timelock.sendExecutePending(deployer.getSender(), 1n, 0n, toNano('0.05'));
        expect(tx.transactions).toHaveTransaction({
            on: timelock.address,
            success: false,
            exitCode: Timelock_errors_backward['Execute budget too low'],
        });
        const pending = await timelock.getGetPending(1n);
        expect(pending).not.toBeNull();
        expect(pending!.executed).toBe(false);
    });

    it('malformed high-value args (truncated or op mismatch) fail fast keeping the pending action', async () => {
        const { blockchain, deployer, timelock } = await setupTimelockOnly();
        const proposalStub = await blockchain.treasury('mnaud-f08-args-proposal');
        const target = await blockchain.treasury('mnaud-f08-args-target');

        // Truncated args: fewer than op(32) + queryId(64) bits → cell underflow.
        await timelock.sendQueue(deployer.getSender(), {
            proposalId: 1n,
            proposalContract: proposalStub.address,
            target: target.address,
            method: BigInt(OP_TREASURY_SPEND),
            args: beginCell().endCell(),
            delay: BigInt(2 * DAY),
        });
        // Op mismatch: method says TreasurySpend, args carry a different opcode.
        await timelock.sendQueue(deployer.getSender(), {
            proposalId: 2n,
            proposalContract: proposalStub.address,
            target: target.address,
            method: BigInt(OP_TREASURY_SPEND),
            args: beginCell().storeUint(0x1234, 32).storeUint(0, 64).endCell(),
            delay: BigInt(2 * DAY),
        });
        advanceTime(blockchain, 2 * DAY + 1);

        const truncated = await timelock.sendExecutePending(deployer.getSender(), 1n);
        expect(truncated.transactions).toHaveTransaction({
            on: timelock.address,
            success: false,
            exitCode: 9, // TVM cell underflow
        });
        const mismatch = await timelock.sendExecutePending(deployer.getSender(), 2n);
        expect(mismatch.transactions).toHaveTransaction({
            on: timelock.address,
            success: false,
            exitCode: Timelock_errors_backward['Args method mismatch'],
        });

        for (const id of [1n, 2n]) {
            const pending = await timelock.getGetPending(id);
            expect(pending).not.toBeNull();
            expect(pending!.executed).toBe(false);
        }
    });

    it('governor can cancel a dispatched tombstone (storage cleanup), but not resurrect it', async () => {
        const { blockchain, deployer, timelock } = await setupTimelockOnly();
        const proposalStub = await blockchain.treasury('mnaud-f08-cancel-proposal');
        // A sandbox treasury target accepts any message → dispatch succeeds, no bounce.
        const target = await blockchain.treasury('mnaud-f08-cancel-target');

        await timelock.sendQueue(deployer.getSender(), {
            proposalId: 5n,
            proposalContract: proposalStub.address,
            target: target.address,
            method: BigInt(OP_TREASURY_SPEND),
            args: treasurySpendArgsStub(),
            delay: BigInt(2 * DAY),
        });
        advanceTime(blockchain, 2 * DAY + 1);

        const execTx = await timelock.sendExecutePending(deployer.getSender(), 5n);
        expect(execTx.transactions).toHaveTransaction({ on: timelock.address, success: true });
        expect(execTx.transactions).toHaveTransaction({ on: target.address, success: true });
        const tombstone = await timelock.getGetPending(5n);
        expect(tombstone).not.toBeNull();
        expect(tombstone!.executed).toBe(true);

        const cancelTx = await timelock.sendCancel(deployer.getSender(), 5n);
        expect(cancelTx.transactions).toHaveTransaction({ on: timelock.address, success: true });
        expect(await timelock.getGetPending(5n)).toBeNull();

        // Cleanup does not resurrect anything: execute is "Not queued" afterwards.
        const gone = await timelock.sendExecutePending(deployer.getSender(), 5n);
        expect(gone.transactions).toHaveTransaction({
            on: timelock.address,
            success: false,
            exitCode: Timelock_errors_backward['Not queued'],
        });
    });
});

describe('IMP-MNAUD-F07 VP half — on-chain proposer eligibility', () => {
    it('rejects CreateProposal when claimedVp is inflated but on-chain VP is below min', async () => {
        const minVp = 50n * NANO_PER_BURN;
        const env = await setupGovernance('https://example.com/gov-mnaud-f07-vp-reject.json', minVp);
        // Seed totalVp > 0 so phase-2 totalVp gate is not the failure mode.
        const whale = await env.blockchain.treasury('mnaud-f07-vp-whale');
        await stakeForVp(env, whale, 3, 100n * NANO_PER_BURN);

        const zeroVp = await env.blockchain.treasury('mnaud-f07-vp-zero');
        const idBefore = await env.governor.getGetProposalCount();
        const target = await env.blockchain.treasury('mnaud-f07-vp-reject-target');

        const createTx = await env.governor.sendCreateProposal(zeroVp.getSender(), {
            proposalType: TYPE_PARAM,
            payload: paramPayload(target.address, 1),
            claimedVp: minVp, // passes cheap claimed gate; on-chain VP is 0
        });
        expect(createTx.transactions).toHaveTransaction({ on: env.governor.address, success: true });
        expect(createTx.transactions).toHaveTransaction({ on: env.stakingMaster.address, success: true });

        expect(await env.governor.getGetProposalCount()).toBe(idBefore + 1n);
        expect(await env.governor.getGetProposal(idBefore)).toBeNull();
        expect(await env.governor.getGetProposalState(idBefore)).toBe(PS_CANCELLED);
        expect(await env.governor.getGetIsKnownProposal(zeroVp.address)).toBe(false);
    });

    it('deploys Proposal when on-chain proposer VP meets minProposalVp', async () => {
        const minVp = 50n * NANO_PER_BURN;
        const env = await setupGovernance('https://example.com/gov-mnaud-f07-vp-ok.json', minVp);
        const proposer = await env.blockchain.treasury('mnaud-f07-vp-ok-proposer');
        await stakeForVp(env, proposer, 3, 100n * NANO_PER_BURN);

        const onChain = await env.stakingMaster.getGetVotingPower(proposer.address);
        expect(onChain).toBeGreaterThanOrEqual(minVp);

        const { id, proposal } = await createProposal(
            env,
            proposer,
            TYPE_PARAM,
            paramPayload((await env.blockchain.treasury('mnaud-f07-vp-ok-target')).address, 1),
        );
        expect(await env.governor.getGetProposalState(id)).toBe(PS_ACTIVE);
        expect(await env.governor.getGetIsKnownProposal(proposal.address)).toBe(true);
        expect((await proposal.getGetProposer()).equals(proposer.address)).toBe(true);
    });
});

describe('IMP-MNAUD-F07 cheap half — O(1) knownProposals reverse index', () => {
    it('registers Proposal addresses in knownProposals on create (O(1) lookup)', async () => {
        const env = await setupGovernance('https://example.com/gov-mnaud-f07-index.json');
        const proposer = await env.blockchain.treasury('mnaud-f07-index-proposer');
        await stakeForVp(env, proposer, 3, 100n * NANO_PER_BURN);

        const stranger = await env.blockchain.treasury('mnaud-f07-stranger');
        expect(await env.governor.getGetIsKnownProposal(stranger.address)).toBe(false);

        const target = await env.blockchain.treasury('mnaud-f07-index-target');
        const { proposal: p1 } = await createProposal(
            env,
            proposer,
            TYPE_PARAM,
            paramPayload(target.address, 1),
        );
        expect(await env.governor.getGetIsKnownProposal(p1.address)).toBe(true);

        const { proposal: p2 } = await createProposal(
            env,
            proposer,
            TYPE_FEATURE,
            featurePayload('mnaud-f07 second proposal'),
        );
        expect(await env.governor.getGetIsKnownProposal(p2.address)).toBe(true);
        expect(await env.governor.getGetIsKnownProposal(stranger.address)).toBe(false);
    });

    it('plain TON from known Proposal to Governor skips cashback (no partner hop)', async () => {
        const env = await setupGovernance('https://example.com/gov-mnaud-f07-cashback.json');
        const proposer = await env.blockchain.treasury('mnaud-f07-cb-proposer');
        await stakeForVp(env, proposer, 3, 100n * NANO_PER_BURN);

        const target = await env.blockchain.treasury('mnaud-f07-cb-target');
        const { proposal } = await createProposal(
            env,
            proposer,
            TYPE_PARAM,
            paramPayload(target.address, 1),
        );
        expect(await env.governor.getGetIsKnownProposal(proposal.address)).toBe(true);

        const plainTx = await env.blockchain.sendMessage(
            internal({
                from: proposal.address,
                to: env.governor.address,
                value: toNano('0.05'),
                bounce: true,
                body: beginCell().endCell(),
            }),
        );
        expect(plainTx.transactions).toHaveTransaction({ on: env.governor.address, success: true });
        assertNoOutOfGas(plainTx.transactions);
        // Correct skip: Governor absorbs. Incorrect cashback would emit empty body Governor → Proposal
        // (the injected Proposal → Governor empty inbound must not be counted as a partner hop).
        const cashbackToProposal = plainTx.transactions.some((tx) => {
            const inMsg = tx.inMessage;
            if (!inMsg || inMsg.info.type !== 'internal') return false;
            return (
                inMsg.info.src.equals(env.governor.address) &&
                inMsg.info.dest.equals(proposal.address) &&
                inMsg.body.bits.length === 0
            );
        });
        expect(cashbackToProposal).toBe(false);
        // Sanity: inbound empty still lands (counted by bidirectional helper), outbound does not.
        expect(countEmptyBodyHopsBetween(plainTx.transactions, env.governor.address, proposal.address)).toBe(1);
    });

    it('plain TON from external sender still cashbacks from Governor', async () => {
        const env = await setupGovernance('https://example.com/gov-mnaud-f07-ext-cb.json');
        const external = await env.blockchain.treasury('mnaud-f07-external');

        const plainTx = await env.governor.send(external.getSender(), { value: toNano('0.05') }, null);
        expect(plainTx.transactions).toHaveTransaction({ on: env.governor.address, success: true });
        // Cashback returns empty body to the external sender (not a relay partner).
        expect(
            plainTx.transactions.some((tx) => {
                const inMsg = tx.inMessage;
                if (!inMsg || inMsg.info.type !== 'internal') return false;
                return (
                    inMsg.info.src.equals(env.governor.address) &&
                    inMsg.info.dest.equals(external.address) &&
                    inMsg.body.bits.length === 0
                );
            }),
        ).toBe(true);
    });
});
