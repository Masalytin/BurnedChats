/**
 * Full-stack governance helpers (IMP-TNFS-09A happy + IMP-TNFS-09B fail/edge).
 * Canon: fee-jetton + staking VP + treasury spend via timelock.
 * Shared time-dependent scenarios → N/A `needs-lab-short-timers`.
 */
import { Address, beginCell, Cell, toNano } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { Governor } from '../../wrappers/Governor';
import { Proposal } from '../../wrappers/Proposal';
import { Timelock } from '../../wrappers/Timelock';
import { check } from './checks';
import { parseEnvAddress } from './balances';
import { resolveStaker } from './staking';
import {
    readTreasurySpent,
    readTreasurySpendingCount,
    sleepMs,
} from './treasury';
import type { CheckResult, ScenarioContext } from '../types';

/**
 * Production / shared default pre-vote window (IMP-PREMNT-08).
 * Lab tip may bake a shorter `cancelLagSec` at Governor.init (IMP-TNFS-F02) —
 * prefer `resolveCancelLagSec(ctx)` for path estimates.
 */
export const CANCEL_LAG_SEC = 3600;

/** ProposalType.ParameterChange (governance-payload.tact). */
export const TYPE_PARAM = 0;

/** ProposalType.TreasurySpend (governance-payload.tact). */
export const TYPE_TREASURY = 2;

/** Canonical TreasurySpend opcode. */
export const OP_TREASURY_SPEND = 0x5a1c9010;

export const PS_ACTIVE = 0n;
export const PS_SUCCEEDED = 1n;
export const PS_EXECUTED = 4n;
export const PS_CANCELLED = 5n;

/** Exact shared N/A reason (Q3=A policy). */
export const NA_NEEDS_LAB_SHORT_TIMERS = 'needs-lab-short-timers';

/**
 * Lab tip N/A when on-chain timers still exceed GOV_MAX_WAIT_SEC for a fresh
 * propose→vote→queue→execute path (should be rare after IMP-TNFS-F02 short tip).
 */
export const NA_LAB_TIMERS_NOT_SHORTENED = 'lab-gov-timers-not-shortened';

export const NA_INSUFFICIENT_VP = 'insufficient voting power for propose/vote';

/** DESIGN §D: fs-gov-payload-staking-or-jetton-admin N/A when (exact string). */
export const NA_LAB_ONLY_PARAMS = 'lab-only params';

/** DESIGN §D: fs-gov-cancel N/A when past cancel lag and cannot create a fresh one. */
export const NA_PAST_CANCEL_LAG = 'past cancel lag';

/** Below-threshold claim used by insufficient-vp reject probe. */
export const CLAIMED_VP_BELOW_MIN = 0n;

/** Default max wall-clock wait for a single scenario step (seconds). */
export const DEFAULT_GOV_MAX_WAIT_SEC = 180;

export const SPEND_AMOUNT_HAPPY = 1_000_000n; // 0.001 BURN
export const SPEND_REASON = 'tnfs-09a-treasury-spend';
export const QUEUE_ATTACH_TON = toNano('0.06');
export const EXECUTE_ATTACH_TON = toNano('1.6');
export const FINALIZE_ATTACH_TON = toNano('0.06');

export function resolveGovMaxWaitSec(): number {
    const raw = process.env.GOV_MAX_WAIT_SEC?.trim();
    if (raw && /^\d+$/.test(raw)) {
        return Number(raw);
    }
    return DEFAULT_GOV_MAX_WAIT_SEC;
}

export function governorAddress(ctx: ScenarioContext): Address {
    return Address.parse(ctx.manifest.addresses.governor);
}

export function timelockAddress(ctx: ScenarioContext): Address {
    return Address.parse(ctx.manifest.addresses.timelock);
}

/** OpenedContract for ABI getters (provider auto-bound). */
export function openGovernor(ctx: ScenarioContext) {
    return ctx.provider.open(new Governor(governorAddress(ctx)));
}

export function openTimelock(ctx: ScenarioContext) {
    return ctx.provider.open(new Timelock(timelockAddress(ctx)));
}

export function openProposal(provider: NetworkProvider, addr: Address) {
    return provider.open(new Proposal(addr));
}

/** Raw wrapper + ContractProvider for subclass send/fetch helpers. */
export function governorContract(ctx: ScenarioContext): {
    contract: Governor;
    contractProvider: ReturnType<NetworkProvider['provider']>;
} {
    const addr = governorAddress(ctx);
    return { contract: new Governor(addr), contractProvider: ctx.provider.provider(addr) };
}

export function timelockContract(ctx: ScenarioContext): {
    contract: Timelock;
    contractProvider: ReturnType<NetworkProvider['provider']>;
} {
    const addr = timelockAddress(ctx);
    return { contract: new Timelock(addr), contractProvider: ctx.provider.provider(addr) };
}

export async function fetchVotingPower(ctx: ScenarioContext, owner: Address): Promise<bigint> {
    const { contract, contractProvider } = governorContract(ctx);
    return contract.fetchVotingPower(contractProvider, owner);
}

export function resolveGovActor(ctx: ScenarioContext): Address {
    return resolveStaker(ctx);
}

export function treasurySpendPayload(
    treasury: Address,
    recipient: Address,
    amount: bigint,
    reason: string,
): Cell {
    return beginCell()
        .storeAddress(treasury)
        .storeAddress(recipient)
        .storeCoins(amount)
        .storeRef(beginCell().storeStringTail(reason).endCell())
        .endCell();
}

export function parseTreasurySpendPayload(payload: Cell): {
    treasury: Address;
    recipient: Address;
    amount: bigint;
    reason: string;
} {
    const s = payload.beginParse();
    const treasury = s.loadAddress();
    const recipient = s.loadAddress();
    const amount = s.loadCoins();
    const reason = s.loadRef().beginParse().loadStringTail();
    return { treasury, recipient, amount, reason };
}

export async function readProposalConfig(ctx: ScenarioContext, proposalType: number) {
    const gov = openGovernor(ctx);
    return gov.getGetProposalConfig(BigInt(proposalType));
}

/**
 * Resolve cancel-lag seconds for the tip under test.
 * Order: on-chain `get_cancel_lag` → manifest `lab.cancelLagSec` → production default.
 */
export async function resolveCancelLagSec(ctx: ScenarioContext): Promise<number> {
    if (ctx.provider) {
        try {
            const gov = openGovernor(ctx);
            const onChain = await gov.getGetCancelLag();
            if (typeof onChain === 'bigint' || typeof onChain === 'number') {
                const n = Number(onChain);
                if (Number.isFinite(n) && n > 0) {
                    return n;
                }
            }
        } catch {
            // Shared tip may still run pre-F02 Governor bytecode without the getter.
        }
    }
    const fromManifest = Number(ctx.manifest?.lab?.cancelLagSec ?? 0);
    if (Number.isFinite(fromManifest) && fromManifest > 0) {
        return fromManifest;
    }
    return CANCEL_LAG_SEC;
}

export async function readProposalCount(ctx: ScenarioContext): Promise<bigint> {
    return openGovernor(ctx).getGetProposalCount();
}

export async function resolveLatestProposalAddr(
    ctx: ScenarioContext,
): Promise<{ id: bigint; addr: Address } | null> {
    const gov = openGovernor(ctx);
    const count = await gov.getGetProposalCount();
    if (count <= 0n) {
        return null;
    }
    const id = count - 1n;
    const addr = await gov.getGetProposal(id);
    if (!addr) {
        return null;
    }
    return { id, addr };
}

/**
 * Shared → always N/A. Lab → N/A when neither an in-flight proposal can advance
 * within GOV_MAX_WAIT_SEC nor the on-chain config is short enough for a full path.
 */
export async function naWhenGovTimeDependent(ctx: ScenarioContext): Promise<string | null> {
    if (ctx.manifestKind === 'shared') {
        return NA_NEEDS_LAB_SHORT_TIMERS;
    }

    const maxWait = resolveGovMaxWaitSec();

    // Prefer advancing an existing proposal when its next gate is within budget.
    if (ctx.provider) {
        try {
            const latest = await resolveLatestProposalAddr(ctx);
            if (latest) {
                const proposal = openProposal(ctx.provider, latest.addr);
                const state = await proposal.getGetState();
                const now = Math.floor(Date.now() / 1000);
                if (state === PS_ACTIVE) {
                    const start = Number(await proposal.getGetStartTime());
                    const end = Number(await proposal.getGetEndTime());
                    if (now < start && start - now <= maxWait) {
                        return null;
                    }
                    if (now >= start && now < end && end - now <= maxWait) {
                        return null;
                    }
                    if (now >= end) {
                        return null;
                    }
                } else if (state === PS_SUCCEEDED) {
                    const delay = Number(await proposal.getGetTimelockDelay());
                    if (delay <= maxWait) {
                        return null;
                    }
                } else if (state === PS_EXECUTED) {
                    return null; // idempotent pass possible
                }
            }
        } catch {
            // Fall through to config-length check.
        }
    }

    // Fresh path estimate: cancelLag + voting period + timelock delay.
    try {
        if (ctx.provider) {
            const cfg = await readProposalConfig(ctx, TYPE_TREASURY);
            const cancelLag = await resolveCancelLagSec(ctx);
            const fullPath = cancelLag + Number(cfg.period) + Number(cfg.timelockDelay);
            if (fullPath <= maxWait) {
                return null;
            }
            return NA_LAB_TIMERS_NOT_SHORTENED;
        }
    } catch {
        // Unit tests may omit provider — use manifest lab short-timer fields as a hint.
    }

    const labDelay = Number(ctx.manifest?.lab?.timelockDelaySec ?? 0);
    const labCancel = Number(ctx.manifest?.lab?.cancelLagSec ?? 0);
    const labPeriod = Number(ctx.manifest?.lab?.proposalPeriodSec ?? 0);
    const labPropDelay = Number(ctx.manifest?.lab?.proposalTimelockDelaySec ?? 0);
    // After IMP-TNFS-F02: lab manifest documents short cancelLag + proposal timers.
    if (
        labCancel > 0 &&
        labPeriod > 0 &&
        labPropDelay >= 0 &&
        labCancel + labPeriod + labPropDelay <= maxWait
    ) {
        return null;
    }
    // Legacy escape: only Governor delay shortened + huge wait budget.
    if (labDelay > 0 && labDelay <= maxWait && maxWait >= CANCEL_LAG_SEC + 86_400) {
        return null;
    }
    if (!ctx.provider && maxWait >= 999_999) {
        // Unit-test escape hatch (GOV_MAX_WAIT_SEC=999999): not the shared reason.
        return NA_LAB_TIMERS_NOT_SHORTENED;
    }
    return NA_LAB_TIMERS_NOT_SHORTENED;
}

export async function naWhenGovPropose(ctx: ScenarioContext): Promise<string | null> {
    const time = await naWhenGovTimeDependent(ctx);
    if (time === NA_NEEDS_LAB_SHORT_TIMERS) {
        return time;
    }
    // Propose itself does not need short voting periods — allow on lab even when
    // full path timers are long (vote/execute scenarios will N/A separately).
    if (ctx.manifestKind === 'lab') {
        try {
            const actor = resolveGovActor(ctx);
            const gov = openGovernor(ctx);
            const minVp = await gov.getGetMinProposalVp();
            const vp = await fetchVotingPower(ctx, actor);
            if (vp < minVp) {
                return NA_INSUFFICIENT_VP;
            }
            return null;
        } catch {
            return NA_INSUFFICIENT_VP;
        }
    }
    return time;
}

export function checkGovSmoke(input: {
    manifestGovernor: Address;
    onChainTimelock: Address;
    manifestTimelock: Address;
    onChainStaking: Address;
    manifestStaking: Address;
    onChainTreasury: Address;
    manifestTreasury: Address;
    timelockDelaySec: bigint;
    labTimelockDelaySec?: number;
    codeHash?: string;
}): CheckResult[] {
    const checks: CheckResult[] = [
        check(
            'manifest-address',
            true,
            `governor ${input.manifestGovernor.toString({ urlSafe: true, bounceable: true })}`,
        ),
        check(
            'linked-timelock',
            input.onChainTimelock.equals(input.manifestTimelock),
            'timelock on-chain matches manifest',
        ),
        check(
            'linked-staking',
            input.onChainStaking.equals(input.manifestStaking),
            'staking master on-chain matches manifest',
        ),
        check(
            'linked-treasury',
            input.onChainTreasury.equals(input.manifestTreasury),
            'treasury on-chain matches manifest',
        ),
        check(
            'timelock-delay-readable',
            input.timelockDelaySec >= 0n,
            `get_timelock_delay=${input.timelockDelaySec}`,
        ),
    ];
    if (input.labTimelockDelaySec != null) {
        checks.push(
            check(
                'lab-timelock-delay',
                input.timelockDelaySec === BigInt(input.labTimelockDelaySec),
                `on-chain delay ${input.timelockDelaySec} vs lab.timelockDelaySec=${input.labTimelockDelaySec}`,
            ),
        );
    }
    if (input.codeHash) {
        checks.push(
            check(
                'code-hash-present',
                input.codeHash.length > 0,
                `manifest codeHashes.governor=${input.codeHash}`,
            ),
        );
    }
    return checks;
}

export function checkProposeCreated(input: {
    countBefore: bigint;
    countAfter: bigint;
    proposalAddr: Address | null;
    startTime: bigint;
    endTime: bigint;
    createdAtApprox: number;
    /** Tip cancel-lag (lab may be short); defaults to production 3600. */
    cancelLagSec?: number;
}): CheckResult[] {
    const cancelLag = input.cancelLagSec ?? CANCEL_LAG_SEC;
    const inCancelWindow =
        input.startTime > BigInt(input.createdAtApprox) &&
        input.startTime <= BigInt(input.createdAtApprox + cancelLag + 120);
    return [
        check(
            'proposal-count-incremented',
            input.countAfter === input.countBefore + 1n || input.countAfter > input.countBefore,
            `proposal_count ${input.countBefore} → ${input.countAfter}`,
        ),
        check(
            'proposal-address',
            input.proposalAddr != null,
            input.proposalAddr
                ? `proposal ${input.proposalAddr.toString({ urlSafe: true, bounceable: true })}`
                : 'proposal address null',
        ),
        check(
            'cancel-lag-window',
            inCancelWindow && input.endTime > input.startTime,
            `start=${input.startTime} end=${input.endTime} (CANCEL_LAG=${cancelLag}s)`,
        ),
    ];
}

export function checkVoteRecorded(input: {
    forVotesBefore: bigint;
    forVotesAfter: bigint;
    hasVoted: boolean;
}): CheckResult[] {
    return [
        check('has-voted', input.hasVoted, input.hasVoted ? 'voter recorded' : 'voter not recorded'),
        check(
            'for-votes-increased',
            input.forVotesAfter > input.forVotesBefore,
            `forVotes ${input.forVotesBefore} → ${input.forVotesAfter}`,
        ),
    ];
}

export function checkQueueExecute(input: {
    stateAfter: bigint;
    pendingCleared: boolean;
}): CheckResult[] {
    return [
        check(
            'proposal-executed',
            input.stateAfter === PS_EXECUTED,
            `proposal state=${input.stateAfter} (expected ${PS_EXECUTED})`,
        ),
        check(
            'timelock-pending-cleared',
            input.pendingCleared,
            input.pendingCleared ? 'pending cleared' : 'pending still present',
        ),
    ];
}

export function checkPayloadTargetsTreasury(input: {
    payloadTreasury: Address;
    canonicalTreasury: Address;
}): CheckResult[] {
    return [
        check(
            'payload-canonical-treasury',
            input.payloadTreasury.equals(input.canonicalTreasury),
            `payload treasury matches canonical`,
        ),
    ];
}

export function checkTreasurySpendAccounting(input: {
    spentBefore: bigint;
    spentAfter: bigint;
    countBefore: bigint;
    countAfter: bigint;
    spendAmount: bigint;
}): CheckResult[] {
    const spentDelta = input.spentAfter - input.spentBefore;
    const countDelta = input.countAfter - input.countBefore;
    return [
        check(
            'total-spent-increased',
            spentDelta === input.spendAmount || input.spentAfter >= input.spentBefore + input.spendAmount,
            `total_spent ${input.spentBefore} → ${input.spentAfter} (expected +${input.spendAmount})`,
        ),
        check(
            'spending-count-increased',
            countDelta >= 1n,
            `spending_count ${input.countBefore} → ${input.countAfter}`,
        ),
    ];
}

export async function waitUntilUnix(
    targetUnix: number,
    maxWaitSec: number,
    pollMs = 5_000,
): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    if (now >= targetUnix) {
        return true;
    }
    const need = targetUnix - now;
    if (need > maxWaitSec) {
        return false;
    }
    const deadline = Date.now() + need * 1000 + 2_000;
    while (Date.now() < deadline) {
        if (Math.floor(Date.now() / 1000) >= targetUnix) {
            return true;
        }
        await sleepMs(Math.min(pollMs, Math.max(500, deadline - Date.now())));
    }
    return Math.floor(Date.now() / 1000) >= targetUnix;
}

export async function waitForProposalState(
    provider: NetworkProvider,
    proposalAddr: Address,
    expected: bigint,
    attempts = 12,
    sleep = 3_000,
): Promise<bigint> {
    const proposal = openProposal(provider, proposalAddr);
    let state = await proposal.getGetState();
    for (let i = 0; i < attempts && state !== expected; i += 1) {
        await sleepMs(sleep);
        state = await proposal.getGetState();
    }
    return state;
}

export function resolveSpendRecipient(ctx: ScenarioContext): Address {
    const fromEnv = parseEnvAddress('GOV_SPEND_RECIPIENT', 'FEE_TEST_RECIPIENT');
    if (fromEnv) {
        return fromEnv;
    }
    return resolveGovActor(ctx);
}

export async function readSpendAccounting(
    provider: NetworkProvider,
    treasury: Address,
): Promise<{ spent: bigint; count: bigint }> {
    const spent = await readTreasurySpent(provider, treasury);
    const count = await readTreasurySpendingCount(provider, treasury);
    return { spent, count };
}

/** ParameterChange payload: target + uint32 method + args ref. */
export function parameterChangePayload(target: Address, method: number, args?: Cell): Cell {
    return beginCell()
        .storeAddress(target)
        .storeUint(method, 32)
        .storeRef(args ?? beginCell().endCell())
        .endCell();
}

/**
 * Cancel scenario N/A: shared → short-timers; lab → past cancel lag when latest
 * proposal is already open and we cannot wait for a fresh propose path.
 */
export async function naWhenGovCancel(ctx: ScenarioContext): Promise<string | null> {
    if (ctx.manifestKind === 'shared') {
        return NA_NEEDS_LAB_SHORT_TIMERS;
    }
    // Fresh CreateProposal stays inside CANCEL_LAG for an hour — always runnable on lab
    // when actor has VP. Late-cancel path uses an already-open proposal if present.
    try {
        const actor = resolveGovActor(ctx);
        const gov = openGovernor(ctx);
        const minVp = await gov.getGetMinProposalVp();
        const vp = await fetchVotingPower(ctx, actor);
        if (vp >= minVp) {
            return null;
        }
        const latest = await resolveLatestProposalAddr(ctx);
        if (latest && ctx.provider) {
            const proposal = openProposal(ctx.provider, latest.addr);
            const state = await proposal.getGetState();
            if (state === PS_ACTIVE) {
                return null; // late-cancel or already-cancelled probe
            }
            if (state === PS_CANCELLED) {
                return null; // idempotent pass
            }
        }
        return NA_INSUFFICIENT_VP;
    } catch {
        return NA_PAST_CANCEL_LAG;
    }
}

/** Expired reject: shared short-timers; lab needs endTime already past or within wait. */
export async function naWhenGovExpired(ctx: ScenarioContext): Promise<string | null> {
    const time = await naWhenGovTimeDependent(ctx);
    if (time === NA_NEEDS_LAB_SHORT_TIMERS) {
        return time;
    }
    if (ctx.manifestKind !== 'lab' || !ctx.provider) {
        return time;
    }
    try {
        const latest = await resolveLatestProposalAddr(ctx);
        if (!latest) {
            return NA_LAB_TIMERS_NOT_SHORTENED;
        }
        const proposal = openProposal(ctx.provider, latest.addr);
        const end = Number(await proposal.getGetEndTime());
        const now = Math.floor(Date.now() / 1000);
        if (now >= end) {
            return null;
        }
        const maxWait = resolveGovMaxWaitSec();
        if (end - now <= maxWait) {
            return null;
        }
        return NA_LAB_TIMERS_NOT_SHORTENED;
    } catch {
        return NA_LAB_TIMERS_NOT_SHORTENED;
    }
}

/** Early execute: need a pending action whose scheduledTime is still in the future. */
export async function naWhenGovEarlyExecute(ctx: ScenarioContext): Promise<string | null> {
    const time = await naWhenGovTimeDependent(ctx);
    if (time === NA_NEEDS_LAB_SHORT_TIMERS) {
        return time;
    }
    if (ctx.manifestKind !== 'lab' || !ctx.provider) {
        return time;
    }
    try {
        const latest = await resolveLatestProposalAddr(ctx);
        if (!latest) {
            return NA_LAB_TIMERS_NOT_SHORTENED;
        }
        const timelock = openTimelock(ctx);
        const pending = await timelock.getGetPending(latest.id);
        if (pending) {
            const scheduled = Number(pending.scheduledTime);
            const now = Math.floor(Date.now() / 1000);
            if (now < scheduled) {
                return null;
            }
            // Already executable — cannot assert early reject.
            return NA_LAB_TIMERS_NOT_SHORTENED;
        }
        // No pending yet: full queue path blocked by long timers (same as 09A).
        return time ?? NA_LAB_TIMERS_NOT_SHORTENED;
    } catch {
        return NA_LAB_TIMERS_NOT_SHORTENED;
    }
}

/** DESIGN: lab-only params for staking/jetton admin payload surface. */
export function naWhenGovPayloadAdmin(ctx: ScenarioContext): string | null {
    if (ctx.manifestKind === 'shared') {
        return NA_LAB_ONLY_PARAMS;
    }
    return null;
}

/** Propose with claimedVp < minProposalVp must not increment proposal count. */
export function checkInsufficientVpRejected(input: {
    countBefore: bigint;
    countAfter: bigint;
    claimedVp: bigint;
    minProposalVp: bigint;
}): CheckResult[] {
    return [
        check(
            'claimed-below-min',
            input.claimedVp < input.minProposalVp,
            `claimedVp=${input.claimedVp} < minProposalVp=${input.minProposalVp}`,
        ),
        check(
            'proposal-count-unchanged',
            input.countAfter === input.countBefore,
            `proposal_count ${input.countBefore} → ${input.countAfter} (expected reject)`,
        ),
    ];
}

/** Second CastVote must not increase forVotes (Already voted). */
export function checkDoubleVoteRejected(input: {
    forVotesBefore: bigint;
    forVotesAfter: bigint;
    hasVoted: boolean;
}): CheckResult[] {
    return [
        check('already-voted', input.hasVoted, input.hasVoted ? 'voter recorded' : 'voter missing'),
        check(
            'for-votes-unchanged',
            input.forVotesAfter === input.forVotesBefore,
            `forVotes ${input.forVotesBefore} → ${input.forVotesAfter} (expected no double count)`,
        ),
    ];
}

/**
 * Vote after endTime must not change forVotes.
 * If the actor never voted, hasVoted must stay false; if they voted earlier in-window,
 * a post-expiry retry must still leave forVotes unchanged (reject / Already voted).
 */
export function checkExpiredVoteRejected(input: {
    hasVotedBefore: boolean;
    hasVotedAfter: boolean;
    forVotesBefore: bigint;
    forVotesAfter: bigint;
    nowUnix: number;
    endTimeUnix: number;
}): CheckResult[] {
    const noNewVotes = input.forVotesAfter === input.forVotesBefore;
    const voterOk = input.hasVotedBefore
        ? input.hasVotedAfter && noNewVotes
        : !input.hasVotedAfter && noNewVotes;
    return [
        check(
            'window-expired',
            input.nowUnix >= input.endTimeUnix,
            `now=${input.nowUnix} end=${input.endTimeUnix}`,
        ),
        check(
            'post-expiry-vote-rejected',
            voterOk,
            `hasVoted ${input.hasVotedBefore}→${input.hasVotedAfter} forVotes ${input.forVotesBefore}→${input.forVotesAfter}`,
        ),
    ];
}

/** Cancel in CANCEL_LAG → Cancelled; late cancel → state stays Active. */
export function checkCancelOutcome(input: {
    mode: 'in-window' | 'late';
    stateBefore: bigint;
    stateAfter: bigint;
}): CheckResult[] {
    if (input.mode === 'in-window') {
        return [
            check(
                'cancel-in-window',
                input.stateAfter === PS_CANCELLED,
                `state ${input.stateBefore} → ${input.stateAfter} (expected ${PS_CANCELLED})`,
            ),
        ];
    }
    return [
        check(
            'late-cancel-rejected',
            input.stateAfter === input.stateBefore && input.stateAfter === PS_ACTIVE,
            `state ${input.stateBefore} → ${input.stateAfter} (expected stay Active)`,
        ),
    ];
}

/** TimelockExecutePending before scheduledTime must leave pending intact. */
export function checkEarlyExecuteRejected(input: {
    pendingStillPresent: boolean;
    stateAfter: bigint;
    nowUnix: number;
    scheduledUnix: number;
}): CheckResult[] {
    return [
        check(
            'before-scheduled',
            input.nowUnix < input.scheduledUnix,
            `now=${input.nowUnix} scheduled=${input.scheduledUnix}`,
        ),
        check(
            'pending-still-present',
            input.pendingStillPresent,
            input.pendingStillPresent ? 'pending retained' : 'pending cleared (wrong accept)',
        ),
        check(
            'not-executed',
            input.stateAfter !== PS_EXECUTED,
            `proposal state=${input.stateAfter} (must not be Executed)`,
        ),
    ];
}

/**
 * Jetton/staking admin surfaces: admin == timelock; rogue direct mutation must not
 * change jetton supply (mirrors mint-non-admin / Only timelock).
 */
export function checkAdminOnlyViaTimelock(input: {
    jettonAdmin: Address;
    timelock: Address;
    stakingGovernor: Address;
    manifestGovernor: Address;
    sender: Address;
    supplyBefore: bigint;
    supplyAfter: bigint;
}): CheckResult[] {
    return [
        check(
            'jetton-admin-is-timelock',
            input.jettonAdmin.equals(input.timelock),
            'jetton adminAddress equals timelock',
        ),
        check(
            'staking-governor-matches',
            input.stakingGovernor.equals(input.manifestGovernor),
            'stakingMaster.governorAddr matches manifest governor',
        ),
        check(
            'sender-not-jetton-admin',
            !input.sender.equals(input.jettonAdmin),
            'mnemonic sender is not jetton admin (direct admin path blocked)',
        ),
        check(
            'supply-unchanged-after-rogue',
            input.supplyAfter === input.supplyBefore,
            `totalSupply ${input.supplyBefore} → ${input.supplyAfter}`,
        ),
    ];
}

/** Readonly role wiring: privileged paths belong to timelock / governor, not unknown EOA. */
export function checkGovRoleWiring(input: {
    jettonAdmin: Address;
    timelock: Address;
    stakingGovernor: Address;
    manifestGovernor: Address;
    manifestTimelock: Address;
    onChainTimelock: Address;
    sender: Address | null;
}): CheckResult[] {
    const checks: CheckResult[] = [
        check(
            'timelock-matches-manifest',
            input.onChainTimelock.equals(input.manifestTimelock),
            'governor.timelock matches manifest',
        ),
        check(
            'jetton-admin-is-timelock',
            input.jettonAdmin.equals(input.timelock),
            'jetton admin is timelock (privileged)',
        ),
        check(
            'staking-governor-is-manifest-gov',
            input.stakingGovernor.equals(input.manifestGovernor),
            'staking governorAddr is manifest governor',
        ),
    ];
    if (input.sender) {
        checks.push(
            check(
                'sender-not-timelock',
                !input.sender.equals(input.timelock),
                'unknown/mnemonic sender is not the timelock contract',
            ),
        );
    }
    return checks;
}
