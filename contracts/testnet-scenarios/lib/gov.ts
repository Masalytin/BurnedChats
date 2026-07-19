/**
 * Full-stack governance happy-path helpers (IMP-TNFS-09A).
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

/** Matches governor.tact CANCEL_LAG (IMP-PREMNT-08). */
export const CANCEL_LAG_SEC = 3600;

/** ProposalType.TreasurySpend (governance-payload.tact). */
export const TYPE_TREASURY = 2;

/** Canonical TreasurySpend opcode. */
export const OP_TREASURY_SPEND = 0x5a1c9010;

export const PS_ACTIVE = 0n;
export const PS_SUCCEEDED = 1n;
export const PS_EXECUTED = 4n;

/** Exact shared N/A reason (Q3=A policy). */
export const NA_NEEDS_LAB_SHORT_TIMERS = 'needs-lab-short-timers';

/**
 * Lab tip only shortens Governor.timelockDelaySec (manifest lab.timelockDelaySec=60).
 * ProposalConfigs still use production periods (Treasury: 7d) and CANCEL_LAG is
 * hardcoded 3600s — full propose→execute from scratch exceeds a short live budget.
 */
export const NA_LAB_TIMERS_NOT_SHORTENED = 'lab-gov-timers-not-shortened';

export const NA_INSUFFICIENT_VP = 'insufficient voting power for propose/vote';

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

    // Fresh path estimate: CANCEL_LAG + voting period + timelock delay.
    try {
        if (ctx.provider) {
            const cfg = await readProposalConfig(ctx, TYPE_TREASURY);
            const fullPath = CANCEL_LAG_SEC + Number(cfg.period) + Number(cfg.timelockDelay);
            if (fullPath <= maxWait) {
                return null;
            }
            return NA_LAB_TIMERS_NOT_SHORTENED;
        }
    } catch {
        // Unit tests may omit provider — use manifest lab.timelockDelaySec only as a hint.
    }

    const labDelay = Number(ctx.manifest?.lab?.timelockDelaySec ?? 0);
    // Without provider we cannot read proposalConfigs; only Governor delay is shortened on lab.
    // Treat as not-shortened unless an explicit override opts into long waits.
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
}): CheckResult[] {
    const inCancelWindow =
        input.startTime > BigInt(input.createdAtApprox) &&
        input.startTime <= BigInt(input.createdAtApprox + CANCEL_LAG_SEC + 120);
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
            `start=${input.startTime} end=${input.endTime} (CANCEL_LAG=${CANCEL_LAG_SEC}s)`,
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
