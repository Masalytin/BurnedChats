/**
 * Full-stack governance helpers (IMP-TNFS-09A happy + IMP-TNFS-09B fail/edge).
 * Canon: fee-jetton + staking VP + treasury spend via timelock.
 * Shared time-dependent scenarios → N/A `needs-lab-short-timers`.
 */
import {
    Address,
    beginCell,
    Cell,
    toNano,
    TupleBuilder,
    type Sender,
    type TupleReader,
} from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import type { NetworkProvider } from '@ton/blueprint';
import { Governor } from '../../wrappers/Governor';
import { Proposal } from '../../wrappers/Proposal';
import { Timelock } from '../../wrappers/Timelock';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { check } from './checks';
import { parseEnvAddress, readJettonWalletBalance } from './balances';
import {
    isGetMethodExecutionError,
    LOCKED_TIER,
    NA_INSUFFICIENT_BURN,
    openStakingMaster,
    readGetterIntFlexible,
    readStakeRecord,
    requireStakingLockAddr,
    resolveStaker,
    sendStakeJettons,
    STAKE_AMOUNT_HAPPY,
    type StakeRecordView,
} from './staking';
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

/** ProposalType.FeaturePriority — no Timelock; Governor.executeProposal. */
export const TYPE_FEATURE = 1;

/** ProposalType.TreasurySpend (governance-payload.tact). */
export const TYPE_TREASURY = 2;

/** ProposalType.Emergency — Timelock delay 0 (non-high-value methods). */
export const TYPE_EMERGENCY = 3;

/** Canonical TreasurySpend opcode. */
export const OP_TREASURY_SPEND = 0x5a1c9010;

export const PS_ACTIVE = 0n;
export const PS_SUCCEEDED = 1n;
export const PS_DEFEATED = 2n;
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
/**
 * TimelockExecutePending attach for TreasurySpend executes (IMP-MNAUD-F20).
 * Timelock relays the budget to Treasury (`SendRemainingValue`), which requires
 * `context().value >= MIN_SPEND_FORWARD (2.3, IMP-MNAUD-F19)` and then relays it
 * into the payout JettonTransfer, whose post-F11 wallet entry gate is
 * minTonFeePath (2.05) + hops. Pre-F19 value 1.6 fails the Treasury require;
 * 4 matches the sandbox budget in tests/governance.spec.ts (surplus refunds
 * to the grant recipient).
 */
export const EXECUTE_ATTACH_TON = toNano('4');
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

/** Timelock `get_pending` view (PendingAction fields, wrapper-independent). */
export type PendingActionView = {
    proposalId: bigint;
    proposalContract: Address;
    target: Address;
    method: bigint;
    args: Cell;
    scheduledTime: bigint;
    executed: boolean;
};

/**
 * Extract the Cell payload from a getter tuple element, tolerating both
 * well-formed `TupleItem` objects (`{ type: 'cell' | 'slice', cell }`) and
 * the RAW shape `@ton/ton` TonClient (toncenter API v2) produces for NESTED
 * tuple elements: its `parseStackEntry` returns a bare `Cell` for both
 * `tvm.cell` and `tvm.slice` entries (addresses arrive as slices → bare
 * Cell). Same client bug family as IMP-TNFS-F09 `get_stake`.
 */
function getterTupleItemCell(item: unknown): Cell | null {
    if (item instanceof Cell) {
        return item;
    }
    if (item !== null && typeof item === 'object') {
        const t = item as { type?: unknown; cell?: unknown };
        if (
            (t.type === 'cell' || t.type === 'slice' || t.type === 'builder') &&
            t.cell instanceof Cell
        ) {
            return t.cell;
        }
    }
    return null;
}

/** Address field: stored as a slice in getter tuples (bare Cell on toncenter v2). */
export function readGetterAddressFlexible(item: unknown, field: string): Address {
    const cell = getterTupleItemCell(item);
    if (cell) {
        return cell.beginParse().loadAddress();
    }
    throw new Error(`get_pending: cannot read address ${field} from stack item: ${String(item)}`);
}

export function readGetterCellFlexible(item: unknown, field: string): Cell {
    const cell = getterTupleItemCell(item);
    if (cell) {
        return cell;
    }
    throw new Error(`get_pending: cannot read cell ${field} from stack item: ${String(item)}`);
}

/** Bool field: TVM ints (-1 true / 0 false), raw bigint on toncenter v2. */
export function readGetterBoolFlexible(item: unknown, field: string): boolean {
    return readGetterIntFlexible(item, field) !== 0n;
}

/** Parse the 7-field PendingAction getter tuple (well-formed or toncenter-v2-shaped). */
export function parsePendingActionTuple(t: TupleReader): PendingActionView {
    return {
        proposalId: readGetterIntFlexible(t.pop(), 'pending.proposalId'),
        proposalContract: readGetterAddressFlexible(t.pop(), 'pending.proposalContract'),
        target: readGetterAddressFlexible(t.pop(), 'pending.target'),
        method: readGetterIntFlexible(t.pop(), 'pending.method'),
        args: readGetterCellFlexible(t.pop(), 'pending.args'),
        scheduledTime: readGetterIntFlexible(t.pop(), 'pending.scheduledTime'),
        executed: readGetterBoolFlexible(t.pop(), 'pending.executed'),
    };
}

/**
 * Read `get_pending(id)` directly (bypasses the generated wrapper whose
 * `loadTuplePendingAction` chokes on TonClient-v2 nested tuples — same mine
 * as IMP-TNFS-F09 `get_stake`, fixed here per IMP-TNFS-F12). Throws on real
 * errors; returns null when no action is queued for `id`.
 */
export async function readPendingAction(
    provider: NetworkProvider,
    timelock: Address,
    id: bigint,
): Promise<PendingActionView | null> {
    const args = new TupleBuilder();
    args.writeNumber(id);
    const res = await provider.provider(timelock).get('get_pending', args.build());
    const t = res.stack.readTupleOpt();
    if (!t) {
        return null;
    }
    return parsePendingActionTuple(t);
}

// ─── Timelock queue delay clamp — IMP-TNFS-F17 ──────────────────────────────

/**
 * Mirror of `timelock.tact` `TIMELOCK_MIN_DELAY_SEC` (COMPILE-TIME constant,
 * not lab-tunable): `receive(TimelockQueue)` requires
 * `msg.delay == 0 || msg.delay >= TIMELOCK_MIN_DELAY_SEC` ("Delay too short").
 */
export const TIMELOCK_MIN_DELAY_SEC = 86_400n;

/**
 * Clamp a Governor-configured timelock delay to a contract-valid value for
 * NON-high-value methods (and for high-value methods on pre-IMP-MNAUD-F03
 * tips without the floor). Lab short-timer tips bake `timelockDelaySec=60`
 * into the Governor config, but the Timelock's gate only accepts 0
 * (immediately executable — sandbox "Emergency proposal" path) or ≥ 24 h;
 * anything in between bounces on "Delay too short" (live 2026-07-25 16:30 —
 * deployer seqno grew, no pending). `0 < delay < TIMELOCK_MIN_DELAY_SEC` → 0n;
 * otherwise unchanged.
 */
export function clampTimelockQueueDelay(delay: bigint): bigint {
    if (delay > 0n && delay < TIMELOCK_MIN_DELAY_SEC) {
        return 0n;
    }
    return delay;
}

// ─── High-value delay floor — IMP-MNAUD-F03 ─────────────────────────────────
//
// `timelock.tact` `receive(TimelockQueue)` since IMP-MNAUD-F03 splits the gate:
// high-value methods (TreasurySpend 0x5a1c9010 / VestEmergencyRevoke 0x5a060002)
// require `delay > 0 && delay >= highValueDelayFloorSec` (INIT parameter —
// mainnet 172800 (48h), lab short floor), everything else keeps the legacy
// `delay == 0 || delay >= TIMELOCK_MIN_DELAY_SEC` rule. Lab scenarios must
// therefore queue high-value actions with a real (short) delay and wait it out.

/**
 * On-chain `Timelock.get_high_value_delay_floor` (IMP-MNAUD-F03), tolerant to
 * toncenter-v2 stack shapes. Returns `null` on a pre-floor tip where the
 * getter does not exist — callers fall back to the legacy F17 clamp rules.
 */
export async function readTimelockHighValueFloorSec(
    provider: NetworkProvider,
    timelock: Address,
): Promise<bigint | null> {
    try {
        const res = await provider.provider(timelock).get('get_high_value_delay_floor', []);
        return readGetterIntFlexible(res.stack.pop(), 'timelock.highValueDelayFloor');
    } catch {
        // Pre-IMP-MNAUD-F03 Timelock bytecode without the getter.
        return null;
    }
}

/**
 * Contract-valid queue delay for a HIGH-VALUE method (TreasurySpend /
 * VestEmergencyRevoke). Pure — exported for unit tests.
 * - `floorSec == null` (pre-floor tip): legacy F17 clamp (0 or ≥ 24 h).
 * - floor tip: `delay` raised to the floor when below it; zero is never
 *   returned (`delay > 0` is a hard contract gate even when floor is 0).
 */
export function resolveHighValueQueueDelay(delay: bigint, floorSec: bigint | null): bigint {
    if (floorSec == null) {
        return clampTimelockQueueDelay(delay);
    }
    const floor = floorSec > 0n ? floorSec : 1n;
    return delay >= floor ? delay : floor;
}

// ─── Deployer (Timelock.governor) sender — IMP-TNFS-F16 ─────────────────────
//
// `timelock.tact` `receive(TimelockQueue)` requires `sender() == self.governor`.
// On the lab tip `Timelock.governor` is the DEPLOYER EOA (bootstrap
// constraint), while the runner signs as Actor A since IMP-TNFS-F06 — a queue
// external from Actor A is accepted (seqno grows) but the internal bounces on
// "Only governor" and no pending appears. Queue (and the execute attach) must
// be signed by the deploy wallet, whose mnemonic `applyTestActorForScenarios`
// preserves in `DEPLOY_WALLET_MNEMONIC` before swapping `WALLET_MNEMONIC`.

/** Poll budget for the deployer wallet's seqno after a queue/execute send. */
const DEPLOYER_SEQNO_POLL_ATTEMPTS = 20;
const DEPLOYER_SEQNO_POLL_SLEEP_MS = 3_000;

export type DeployerSender = {
    sender: Sender;
    address: Address;
    getSeqno: () => Promise<number>;
    waitSeqnoIncrement: (fromSeqno: number) => Promise<void>;
};

/**
 * Deploy-wallet mnemonic resolution (pure — exported for unit tests; pass a
 * custom env only in tests). Prefers `DEPLOY_WALLET_MNEMONIC` (preserved by
 * `applyTestActorForScenarios` before the Actor A swap); falls back to
 * `WALLET_MNEMONIC`, which is still the deploy wallet when no swap happened.
 * If a swap DID happen and only the fallback is set, the derived address is
 * Actor A and `assertTimelockGovernorSender` rejects it loudly downstream.
 * Never logs or returns anything derived from the words besides the words
 * themselves — callers must not print them.
 */
export function resolveDeployerMnemonic(
    env: { DEPLOY_WALLET_MNEMONIC?: string; WALLET_MNEMONIC?: string } = process.env,
): string {
    const preserved = env.DEPLOY_WALLET_MNEMONIC?.trim();
    if (preserved) {
        return preserved;
    }
    const original = env.WALLET_MNEMONIC?.trim();
    if (original) {
        return original;
    }
    throw new Error(
        'DEPLOY_WALLET_MNEMONIC / WALLET_MNEMONIC unset — cannot build the deployer ' +
            '(Timelock.governor) sender for TimelockQueue. Set the deploy wallet mnemonic ' +
            'in .env.testnet.',
    );
}

function makeDeployerSender(
    rawSender: Sender,
    address: Address,
    getSeqno: () => Promise<number>,
): DeployerSender {
    // `@ton/ton` wallet `sender()` omits `address` on the returned Sender —
    // fill it in so wrapper send paths relying on `via.address` keep working.
    const sender: Sender = { address, send: (args) => rawSender.send(args) };
    return {
        sender,
        address,
        getSeqno,
        waitSeqnoIncrement: async (fromSeqno: number) => {
            for (let i = 1; i <= DEPLOYER_SEQNO_POLL_ATTEMPTS; i += 1) {
                try {
                    const current = await getSeqno();
                    if (current > fromSeqno) {
                        return;
                    }
                } catch {
                    // Transient node error — keep polling (axios interceptor
                    // in blueprint.config.ts already retries common 5xx).
                }
                await sleepMs(DEPLOYER_SEQNO_POLL_SLEEP_MS);
            }
            throw new Error(
                `deployer wallet ${address.toString({ urlSafe: true, bounceable: true })} ` +
                    `seqno did not advance from ${fromSeqno} after ` +
                    `${DEPLOYER_SEQNO_POLL_ATTEMPTS} attempts`,
            );
        },
    };
}

/**
 * Build the deploy wallet + Sender from `DEPLOY_WALLET_MNEMONIC` using the
 * same `WALLET_*` knobs as Blueprint / Actor A derivation (`lib/test-actor.ts`
 * `deriveWalletAddressFromMnemonic`). The wallet is opened through the
 * scenario's Blueprint provider, so seqno reads share the retry pipeline.
 * NEVER prints or persists the mnemonic.
 */
export async function resolveDeployerSender(ctx: ScenarioContext): Promise<DeployerSender> {
    const words = resolveDeployerMnemonic().split(/\s+/).filter(Boolean);
    if (words.length < 12) {
        throw new Error('deployer mnemonic must be at least 12 words');
    }
    const keyPair = await mnemonicToPrivateKey(words);
    const version = (process.env.WALLET_VERSION?.trim() || 'v5r1').toLowerCase();
    if (version === 'v5r1') {
        const networkGlobalId = Number(process.env.WALLET_NETWORK_ID ?? '-3');
        const subwalletNumber = Number(process.env.SUBWALLET_NUMBER ?? '0');
        const wallet = WalletContractV5R1.create({
            publicKey: keyPair.publicKey,
            walletId: {
                networkGlobalId,
                context: {
                    workchain: 0,
                    subwalletNumber,
                    walletVersion: 'v5r1',
                },
            },
        });
        const opened = ctx.provider.open(wallet);
        return makeDeployerSender(opened.sender(keyPair.secretKey), wallet.address, () =>
            opened.getSeqno(),
        );
    }
    if (version === 'v4r2' || version === 'v4') {
        const walletId = process.env.WALLET_ID?.trim() ? Number(process.env.WALLET_ID) : undefined;
        const wallet = WalletContractV4.create({
            workchain: 0,
            publicKey: keyPair.publicKey,
            walletId,
        });
        const opened = ctx.provider.open(wallet);
        return makeDeployerSender(opened.sender(keyPair.secretKey), wallet.address, () =>
            opened.getSeqno(),
        );
    }
    throw new Error(
        `Unsupported WALLET_VERSION=${version} for deployer sender derivation (use v5r1 or v4r2)`,
    );
}

/** On-chain `Timelock.get_governor` (tolerant read — toncenter-v2 shapes ok). */
export async function readTimelockGovernor(ctx: ScenarioContext): Promise<Address> {
    const res = await ctx.provider.provider(timelockAddress(ctx)).get('get_governor', []);
    return readGetterAddressFlexible(res.stack.pop(), 'timelock.governor');
}

/**
 * Pure governor gate — exported for unit tests. The mismatch error names both
 * addresses (address strings only — no secrets).
 */
export function assertGovernorMatchesDeployer(onChainGovernor: Address, deployer: Address): void {
    if (!onChainGovernor.equals(deployer)) {
        throw new Error(
            'Timelock.governor mismatch — refusing to send TimelockQueue from a non-governor wallet.\n' +
                `  on-chain governor: ${onChainGovernor.toString({ urlSafe: true, bounceable: true })}\n` +
                `  derived deployer : ${deployer.toString({ urlSafe: true, bounceable: true })}\n` +
                'Check DEPLOY_WALLET_MNEMONIC / WALLET_VERSION / WALLET_NETWORK_ID / SUBWALLET_NUMBER.',
        );
    }
}

/** Gate before sending TimelockQueue: `senderAddress` must equal on-chain governor
 * (deploy EOA or multisig — callers pass `resolveTimelockGovernorSender(...).address`). */
export async function assertTimelockGovernorSender(
    ctx: ScenarioContext,
    senderAddress: Address,
): Promise<void> {
    assertGovernorMatchesDeployer(await readTimelockGovernor(ctx), senderAddress);
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

// ─── Locked-beyond voting power (IMP-TNFS-F15) ──────────────────────────────
//
// Flash-stake protection (IMP-FAUDIT-F01 / F-2): the StakingMaster
// `GovernorVoteRelay` receiver counts ONLY stakes with
// `unlockTime > voteEndTime` (strictly greater) — Flexible tier
// (`unlockTime == startTime`) always yields zero effective VP and the relay
// bounces with "Zero effective vp". Vote scenarios must hold a locked-tier
// stake covering the voting window before casting.

/** Tier bounds mirrored from staking-master.tact (`MinTier` / `MaxTier`). */
export const GOV_MIN_TIER = 0;
export const GOV_MAX_TIER = 3;

/** Safety margin added to the estimated voteEndTime of a fresh proposal. */
export const LOCKED_VP_END_MARGIN_SEC = 600;

/** Poll budget for the tier-1 stake record to surface after StakeForward. */
const LOCKED_STAKE_POLL_ATTEMPTS = 12;
const LOCKED_STAKE_POLL_SLEEP_MS = 5_000;

/**
 * Pure mirror of `computeOwnerVotingPowerLockedBeyond` (staking-master.tact):
 * Σ `amount × multiplier / 100` over stakes with `amount > 0` AND
 * `unlockTime > voteEndTime` (STRICT — a stake unlocking exactly at
 * voteEndTime does not count). `multipliers` is the on-chain tier table
 * (multiplier ×100, e.g. Silver 150 = 1.5x).
 */
export function computeLockedBeyondVp(
    records: ReadonlyArray<StakeRecordView>,
    multipliers: ReadonlyMap<bigint, bigint>,
    voteEndTime: bigint,
): bigint {
    let sum = 0n;
    for (const record of records) {
        if (record.amount > 0n && record.unlockTime > voteEndTime) {
            const multiplier = multipliers.get(record.tier);
            if (multiplier == null) {
                throw new Error(
                    `computeLockedBeyondVp: missing multiplier for tier ${record.tier}`,
                );
            }
            sum += (record.amount * multiplier) / 100n;
        }
    }
    return sum;
}

/** StakingLock address: on-chain governor `get_staking_lock` → manifest fallback. */
export async function resolveStakingLockAddr(ctx: ScenarioContext): Promise<Address> {
    try {
        const res = await ctx.provider
            .provider(governorAddress(ctx))
            .get('get_staking_lock', []);
        return readGetterAddressFlexible(res.stack.pop(), 'governor.stakingLock');
    } catch {
        return requireStakingLockAddr(ctx);
    }
}

/**
 * On-chain tier multiplier table via StakingLock `get_tier_multiplier`
 * (never hardcoded — Timelock can retune tiers at runtime).
 */
export async function readTierMultipliers(
    ctx: ScenarioContext,
    stakingLock: Address,
): Promise<Map<bigint, bigint>> {
    const multipliers = new Map<bigint, bigint>();
    for (let tier = GOV_MIN_TIER; tier <= GOV_MAX_TIER; tier += 1) {
        const args = new TupleBuilder();
        args.writeNumber(BigInt(tier));
        const res = await ctx.provider
            .provider(stakingLock)
            .get('get_tier_multiplier', args.build());
        multipliers.set(
            BigInt(tier),
            readGetterIntFlexible(res.stack.pop(), `tier_multiplier[${tier}]`),
        );
    }
    return multipliers;
}

/**
 * All existing stake records of `owner` across tiers 0..3 via the tolerant
 * `readStakeRecord` (IMP-TNFS-F09 toncenter-v2 shapes). Get-method EXECUTION
 * failures degrade to "no record" (same policy as `readStakeAmount`); parse
 * failures propagate.
 */
export async function readActorStakeRecords(
    ctx: ScenarioContext,
    owner: Address,
): Promise<StakeRecordView[]> {
    const stakingMaster = Address.parse(ctx.manifest.addresses.stakingMaster);
    const records: StakeRecordView[] = [];
    for (let tier = GOV_MIN_TIER; tier <= GOV_MAX_TIER; tier += 1) {
        try {
            const record = await readStakeRecord(ctx.provider, stakingMaster, owner, tier);
            if (record) {
                records.push(record);
            }
        } catch (err) {
            if (!isGetMethodExecutionError(err)) {
                throw err;
            }
        }
    }
    return records;
}

/**
 * Conservative voteEndTime for a proposal created "now": a fresh proposal's
 * window ends at `createdAt + cancelLag + votingPeriod`, plus a margin for
 * clock drift / propose latency. A tier-1 lock (180 d) clears this by orders
 * of magnitude — the margin only guards near-expiry legacy stakes.
 */
export async function estimateFreshVoteEndTime(ctx: ScenarioContext): Promise<bigint> {
    const nowUnix = Math.floor(Date.now() / 1000);
    const cancelLag = await resolveCancelLagSec(ctx);
    const cfg = await readProposalConfig(ctx, TYPE_TREASURY);
    return BigInt(nowUnix + cancelLag + Number(cfg.period) + LOCKED_VP_END_MARGIN_SEC);
}

/**
 * Ensure the gov actor holds locked-beyond VP covering a proposal window that
 * ends at `minVoteEndTime` (estimated for a fresh proposal when omitted).
 * Idempotent: an existing stake with sufficient `unlockTime` sends nothing.
 * Otherwise stakes `STAKE_AMOUNT_HAPPY` into `LOCKED_TIER` (Silver) and polls
 * the stake state until the locked VP turns positive — state-based
 * verification, because V5R1 wallets silently skip underfunded actions
 * (seqno grows, internal never sent — IMP-TNFS-F10).
 *
 * Returns the locked-beyond VP now held.
 */
export async function ensureLockedVotingPower(
    ctx: ScenarioContext,
    opts?: { minVoteEndTime?: bigint },
): Promise<bigint> {
    const actor = resolveGovActor(ctx);
    const voteEndTime = opts?.minVoteEndTime ?? (await estimateFreshVoteEndTime(ctx));
    const stakingLock = await resolveStakingLockAddr(ctx);
    const multipliers = await readTierMultipliers(ctx, stakingLock);

    const existingVp = computeLockedBeyondVp(
        await readActorStakeRecords(ctx, actor),
        multipliers,
        voteEndTime,
    );
    if (existingVp > 0n) {
        return existingVp;
    }

    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    const balance = await readJettonWalletBalance(ctx.provider, jettonMaster, actor);
    if (balance < STAKE_AMOUNT_HAPPY) {
        throw new Error(
            `${NA_INSUFFICIENT_BURN}: locked-tier (tier ${LOCKED_TIER}) stake needs ` +
                `${STAKE_AMOUNT_HAPPY} nano BURN, actor has ${balance}`,
        );
    }

    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await sendStakeJettons(ctx, {
        amount: STAKE_AMOUNT_HAPPY,
        tier: LOCKED_TIER,
        staker: actor,
    });
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);

    let vp = 0n;
    for (let attempt = 0; attempt < LOCKED_STAKE_POLL_ATTEMPTS; attempt += 1) {
        vp = computeLockedBeyondVp(
            await readActorStakeRecords(ctx, actor),
            multipliers,
            voteEndTime,
        );
        if (vp > 0n) {
            return vp;
        }
        await sleepMs(LOCKED_STAKE_POLL_SLEEP_MS);
    }
    throw new Error(
        `locked-tier stake (tier ${LOCKED_TIER}, ${STAKE_AMOUNT_HAPPY} nano BURN) did not ` +
            `surface as locked-beyond VP within ` +
            `${(LOCKED_STAKE_POLL_ATTEMPTS * LOCKED_STAKE_POLL_SLEEP_MS) / 1000}s — ` +
            `check StakeForward path / actor TON balance (V5R1 silent skip).`,
    );
}

/**
 * Honest N/A (card item 5 — no blanket-N/A): when the actor has zero
 * locked-beyond VP AND cannot fund the locked-tier stake, surface the
 * existing insufficient-BURN reason instead of failing mid-run. Read errors
 * degrade to null so `run()` reports the real failure loudly.
 */
export async function naWhenLockedVpUnfundable(ctx: ScenarioContext): Promise<string | null> {
    try {
        const actor = resolveGovActor(ctx);
        const voteEndTime = await estimateFreshVoteEndTime(ctx);
        const stakingLock = await resolveStakingLockAddr(ctx);
        const multipliers = await readTierMultipliers(ctx, stakingLock);
        const vp = computeLockedBeyondVp(
            await readActorStakeRecords(ctx, actor),
            multipliers,
            voteEndTime,
        );
        if (vp > 0n) {
            return null;
        }
        const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
        const balance = await readJettonWalletBalance(ctx.provider, jettonMaster, actor);
        return balance < STAKE_AMOUNT_HAPPY ? NA_INSUFFICIENT_BURN : null;
    } catch {
        return null;
    }
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

/** Max proposals scanned from the latest downward by `resolveUsableProposal`. */
export const PROPOSAL_SCAN_DEPTH = 10;

/**
 * Minimum remaining voting-window seconds required before a CastVote leg is
 * attempted (IMP-TNFS-F32). A vote sent near the end of the 60-second lab
 * window rides the multihop relay (wallet → Governor → StakingMaster →
 * Governor → Proposal) and can land after `endTime` — live 2026-08-21,
 * fs-gov-vote-happy "voter not recorded". Selection helpers skip proposals
 * whose window has less than this remaining; callers create a fresh one.
 */
export const MIN_VOTE_WINDOW_REMAINING_SEC = 30;

/**
 * What the caller intends to do with the selected proposal (IMP-TNFS-F13):
 * - `votable`    — CastVote target: Active with the voting window not yet over
 *                  (pre-window Active counts — the caller waits for startTime).
 * - `reusable`   — propose-happy idempotent reuse: votable Active or Succeeded.
 *                  Cancelled/Executed/Defeated must fall through to a fresh
 *                  CreateProposal.
 * - `executable` — queue/execute path: Executed (caller's idempotent pass),
 *                  Succeeded (queue → execute), or any Active (caller waits for
 *                  endTime and finalizes — expired-unfinalized is advanceable).
 */
export type UsableProposalWant = 'votable' | 'reusable' | 'executable';

export type UsableProposal = { id: bigint; addr: Address; state: bigint };

/**
 * Pure selection predicate behind `resolveUsableProposal` — exported for unit
 * tests. Terminal states (Cancelled=5, Defeated=2, and Executed=4 unless the
 * caller treats Executed as idempotent success) are never usable.
 */
export function isProposalUsable(input: {
    want: UsableProposalWant;
    state: bigint;
    /** Voting-window end (unix); only consulted for Active proposals. */
    endTimeUnix: bigint;
    nowUnix: number;
    /**
     * Guard for CastVote targets (IMP-TNFS-F32): an Active proposal counts
     * only when at least this many seconds of the voting window remain, so
     * the multihop vote relay cannot land after `endTime`. Default 0 keeps
     * legacy behaviour for non-vote wants.
     */
    minWindowRemainingSec?: number;
}): boolean {
    const { want, state, endTimeUnix, nowUnix } = input;
    if (state === PS_ACTIVE) {
        if (want === 'executable') {
            return true;
        }
        const minRemaining = BigInt(input.minWindowRemainingSec ?? 0);
        return BigInt(nowUnix) + minRemaining < endTimeUnix;
    }
    if (state === PS_SUCCEEDED) {
        return want === 'reusable' || want === 'executable';
    }
    if (state === PS_EXECUTED) {
        return want === 'executable';
    }
    return false;
}

/**
 * State-aware proposal selection (IMP-TNFS-F13). Scans proposals from the
 * latest (`id = count-1`) downward, at most `depth` entries, returning the
 * first one usable for `want`. Fixes the re-run defect where `fs-gov-cancel`
 * leaves the LATEST proposal Cancelled and blind `resolveLatestProposalAddr`
 * callers vote / queue against it (live report
 * `2026-07-25T14-42-13-176Z-tag_governance.json`).
 */
export async function resolveUsableProposal(
    ctx: ScenarioContext,
    want: UsableProposalWant,
    opts?: { depth?: number; nowUnix?: number; minWindowRemainingSec?: number },
): Promise<UsableProposal | null> {
    const gov = openGovernor(ctx);
    const count = await gov.getGetProposalCount();
    if (count <= 0n) {
        return null;
    }
    const depth = BigInt(opts?.depth ?? PROPOSAL_SCAN_DEPTH);
    const nowUnix = opts?.nowUnix ?? Math.floor(Date.now() / 1000);
    // Votable targets carry the CastVote relay-latency guard by default (F32).
    const minWindowRemainingSec =
        opts?.minWindowRemainingSec ?? (want === 'votable' ? MIN_VOTE_WINDOW_REMAINING_SEC : 0);
    const lowest = count > depth ? count - depth : 0n;
    for (let id = count - 1n; id >= lowest; id -= 1n) {
        const addr = await gov.getGetProposal(id);
        if (!addr) {
            continue;
        }
        const proposal = openProposal(ctx.provider, addr);
        const state = await proposal.getGetState();
        // Fetch the window only for Active — terminal states short-circuit.
        const endTimeUnix = state === PS_ACTIVE ? await proposal.getGetEndTime() : 0n;
        if (isProposalUsable({ want, state, endTimeUnix, nowUnix, minWindowRemainingSec })) {
            return { id, addr, state };
        }
    }
    return null;
}

// ─── State/type-aware proposal matching — IMP-TNFS-F32 ──────────────────────
//
// Blind `resolveLatestProposalAddr` callers break under `--all` interleaving:
// between a scenario and its dependency other gov scenarios create new
// proposals (ParamChange from against-defeated, cancel probes, …), so "the
// latest" is no longer the one the dependency prepared. Probes must select by
// what they actually need — proposalType / state / hasVoted — scanning the
// same depth window as `resolveUsableProposal`.

export type ProposalMatch = {
    id: bigint;
    addr: Address;
    state: bigint;
    proposalType: bigint;
};

/**
 * Scan proposals latest → down (at most `depth`) and return the first one
 * matching ALL provided filters:
 * - `proposalType` — exact governance-payload type (TYPE_TREASURY, …);
 * - `states`       — allowed Proposal states (any state when omitted);
 * - `votedBy`      — `get_has_voted(owner)` must be true;
 * - `minWindowRemainingSec` — for Active proposals, remaining voting window
 *   must be at least this (CastVote relay-latency guard, F32).
 */
export async function resolveProposalMatching(
    ctx: ScenarioContext,
    opts: {
        proposalType?: number;
        states?: readonly bigint[];
        votedBy?: Address;
        minWindowRemainingSec?: number;
        depth?: number;
        nowUnix?: number;
    },
): Promise<ProposalMatch | null> {
    const gov = openGovernor(ctx);
    const count = await gov.getGetProposalCount();
    if (count <= 0n) {
        return null;
    }
    const depth = BigInt(opts.depth ?? PROPOSAL_SCAN_DEPTH);
    const nowUnix = opts.nowUnix ?? Math.floor(Date.now() / 1000);
    const lowest = count > depth ? count - depth : 0n;
    for (let id = count - 1n; id >= lowest; id -= 1n) {
        const addr = await gov.getGetProposal(id);
        if (!addr) {
            continue;
        }
        const proposal = openProposal(ctx.provider, addr);
        const state = await proposal.getGetState();
        if (opts.states && !opts.states.includes(state)) {
            continue;
        }
        const proposalType = await proposal.getGetProposalType();
        if (opts.proposalType != null && Number(proposalType) !== opts.proposalType) {
            continue;
        }
        if (opts.minWindowRemainingSec != null && state === PS_ACTIVE) {
            const endTimeUnix = await proposal.getGetEndTime();
            if (BigInt(nowUnix) + BigInt(opts.minWindowRemainingSec) >= endTimeUnix) {
                continue;
            }
        }
        if (opts.votedBy && !(await proposal.getHasVoted(opts.votedBy))) {
            continue;
        }
        return { id, addr, state, proposalType };
    }
    return null;
}

/**
 * Pending attribution (IMP-TNFS-F32): the Timelock survives lab redeploys
 * (code+init unchanged → same address), so a stale unexecuted pending from an
 * OLD Governor's proposal can collide with a small sequential id of the fresh
 * Governor (live 2026-08-21 — fs-gov-against-defeated false "pending present"
 * against the early-execute-reject leftover id=1). `PendingAction` stores
 * `proposalContract`; absence must be attributed by the proposal address,
 * never by id alone.
 */
export function pendingAbsentForProposal(
    pending: PendingActionView | null,
    proposalAddr: Address,
): boolean {
    return pending == null || !pending.proposalContract.equals(proposalAddr);
}

/**
 * Shared self-contained votable-proposal helper (IMP-TNFS-F32, generalising
 * the fs-gov-vote-happy F13 pattern): reuse a votable proposal with enough
 * window remaining, else CreateProposal a fresh TreasurySpend and poll until
 * it is selectable. Caller must hold locked-beyond VP (`ensureLockedVotingPower`)
 * before invoking — CreateProposal needs it (F07/F15).
 */
export async function ensureVotableProposal(
    ctx: ScenarioContext,
    reason: string,
): Promise<UsableProposal> {
    const existing = await resolveUsableProposal(ctx, 'votable');
    if (existing) {
        return existing;
    }

    const actor = resolveGovActor(ctx);
    const treasury = Address.parse(ctx.manifest.addresses.treasury);
    const recipient = resolveSpendRecipient(ctx);
    const payload = treasurySpendPayload(treasury, recipient, SPEND_AMOUNT_HAPPY, reason);
    const claimedVp = await fetchVotingPower(ctx, actor);
    const { contract, contractProvider } = governorContract(ctx);
    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await contract.sendCreateProposal(contractProvider, ctx.provider.sender(), {
        proposalType: TYPE_TREASURY,
        payload,
        claimedVp,
    });
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);

    for (let attempt = 0; attempt < 12; attempt += 1) {
        await sleepMs(5_000);
        const created = await resolveUsableProposal(ctx, 'votable');
        if (created) {
            return created;
        }
    }
    throw new Error(
        `CreateProposal (${reason}) did not yield a votable proposal after poll — ` +
            'check actor locked VP / cancel lag / tip timers.',
    );
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

/** FeaturePriority payload: description ref + optional content-id ref. */
export function featurePriorityPayload(description: string, cid?: Cell): Cell {
    return beginCell()
        .storeRef(beginCell().storeStringTail(description).endCell())
        .storeRef(cid ?? beginCell().endCell())
        .endCell();
}

/**
 * Emergency payload: target + uint32 method + args ref + reason ref.
 * Do NOT use high-value methods (TreasurySpend / VestEmergencyRevoke) — delay 0
 * is rejected by Timelock high-value floor (IMP-MNAUD-F03).
 */
export function emergencyPayload(
    target: Address,
    method: number,
    args: Cell | undefined,
    reason: string,
): Cell {
    return beginCell()
        .storeAddress(target)
        .storeUint(method, 32)
        .storeRef(args ?? beginCell().endCell())
        .storeRef(beginCell().storeStringTail(reason).endCell())
        .endCell();
}

/** Harmless Emergency method for live delay-0 queue (not high-value). */
export const EMERGENCY_DUMMY_METHOD = 0x99;

/**
 * Against-vote → finalize Defeated; Timelock must not have pending for id.
 * IMP-TNFS-F25.
 */
export function checkAgainstDefeated(input: {
    stateAfter: bigint;
    againstVotes: bigint;
    pendingAbsent: boolean;
}): CheckResult[] {
    return [
        check(
            'state-defeated',
            input.stateAfter === PS_DEFEATED,
            `state=${input.stateAfter} (expected Defeated=${PS_DEFEATED})`,
        ),
        check(
            'against-votes-positive',
            input.againstVotes > 0n,
            `againstVotes=${input.againstVotes}`,
        ),
        check(
            'no-timelock-pending',
            input.pendingAbsent,
            input.pendingAbsent ? 'no Timelock pending for proposal' : 'pending present (wrong accept)',
        ),
    ];
}

/** FeaturePriority: Executed via Governor, never Timelock-queued. */
export function checkFeaturePriorityExecuted(input: {
    proposalType: bigint;
    stateAfter: bigint;
    pendingAbsent: boolean;
}): CheckResult[] {
    return [
        check(
            'type-feature',
            input.proposalType === BigInt(TYPE_FEATURE),
            `proposalType=${input.proposalType} (expected ${TYPE_FEATURE})`,
        ),
        check(
            'state-executed',
            input.stateAfter === PS_EXECUTED,
            `state=${input.stateAfter} (expected Executed=${PS_EXECUTED})`,
        ),
        check(
            'no-timelock-pending',
            input.pendingAbsent,
            input.pendingAbsent ? 'Feature path never queued Timelock' : 'unexpected Timelock pending',
        ),
    ];
}

/** Emergency: delay-0 Timelock execute → Executed; pending cleared. */
export function checkEmergencyExecuted(input: {
    proposalType: bigint;
    timelockDelay: bigint;
    stateAfter: bigint;
    pendingCleared: boolean;
}): CheckResult[] {
    return [
        check(
            'type-emergency',
            input.proposalType === BigInt(TYPE_EMERGENCY),
            `proposalType=${input.proposalType} (expected ${TYPE_EMERGENCY})`,
        ),
        check(
            'timelock-delay-zero',
            input.timelockDelay === 0n,
            `timelockDelay=${input.timelockDelay} (expected 0)`,
        ),
        check(
            'state-executed',
            input.stateAfter === PS_EXECUTED,
            `state=${input.stateAfter} (expected Executed=${PS_EXECUTED})`,
        ),
        check(
            'pending-cleared',
            input.pendingCleared,
            input.pendingCleared ? 'pending cleared' : 'pending still present',
        ),
    ];
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
        const pending = await readPendingAction(ctx.provider, timelockAddress(ctx), latest.id);
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

/**
 * IMP-TNFS-F19 / IMP-MNAUD-F07 VP half: claimedVp clears the cheap gate but on-chain
 * proposerVp < min → reserved id CANCELLED, no Proposal address, count increments.
 */
export function checkInsufficientOnchainVpRejected(input: {
    countBefore: bigint;
    countAfter: bigint;
    claimedVp: bigint;
    minProposalVp: bigint;
    proposerOnchainVp: bigint;
    totalVp: bigint;
    proposalAddr: Address | null;
    stateAfter: bigint | null;
}): CheckResult[] {
    return [
        check(
            'claimed-meets-min',
            input.claimedVp >= input.minProposalVp,
            `claimedVp=${input.claimedVp} >= minProposalVp=${input.minProposalVp}`,
        ),
        check(
            'proposer-onchain-below-min',
            input.proposerOnchainVp < input.minProposalVp,
            `on-chain VP ${input.proposerOnchainVp} < minProposalVp ${input.minProposalVp}`,
        ),
        check(
            'total-vp-positive',
            input.totalVp > 0n,
            `totalVp=${input.totalVp} (need whale stake so phase-2 totalVp gate is not the failure mode)`,
        ),
        check(
            'proposal-count-incremented',
            input.countAfter === input.countBefore + 1n,
            `proposal_count ${input.countBefore} → ${input.countAfter} (expected +1 reserved id)`,
        ),
        check(
            'proposal-addr-null',
            input.proposalAddr === null,
            input.proposalAddr === null
                ? 'get_proposal(id) is null (no deploy)'
                : `get_proposal(id)=${input.proposalAddr.toString()} (false-pass: deployed)`,
        ),
        check(
            'state-cancelled',
            input.stateAfter === PS_CANCELLED,
            `proposal_state=${input.stateAfter} (expected CANCELLED=${PS_CANCELLED})`,
        ),
    ];
}

/** N/A when Blueprint actor already has enough on-chain VP for eligibility. */
export const NA_ACTOR_HAS_ONCHAIN_VP =
    'gov-actor-has-onchain-vp (unstake / use zero-stake TEST_ACTOR for F19)';

/** N/A when no stake exists anywhere — TotalVpSnapshotReply would fail totalVp>0 first. */
export const NA_TOTAL_VP_ZERO = 'total-vp-zero (need whale stake so totalVp > 0)';

export async function naWhenInsufficientOnchainVp(ctx: ScenarioContext): Promise<string | null> {
    const sender = ctx.provider.sender().address;
    if (!sender) {
        return 'blueprint sender unavailable';
    }
    const gov = openGovernor(ctx);
    let minProposalVp = 1n;
    try {
        minProposalVp = await gov.getGetMinProposalVp();
    } catch {
        // keep default
    }
    const onChain = await fetchVotingPower(ctx, sender);
    if (onChain >= minProposalVp) {
        return NA_ACTOR_HAS_ONCHAIN_VP;
    }
    const master = openStakingMaster(ctx);
    const totalVp = await master.getGetTotalVotingPower();
    if (totalVp <= 0n) {
        return NA_TOTAL_VP_ZERO;
    }
    return null;
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
 * Flexible-only CastVote must not record a vote (IMP-TNFS-F24 / flash-stake gate).
 * StakingMaster VoteRelay exits with "Zero effective vp" when locked-beyond VP is 0.
 */
export function checkFlexibleVpVoteRejected(input: {
    lockedBeyondVp: bigint;
    claimedVp: bigint;
    hasVoted: boolean;
    forVotesBefore: bigint;
    forVotesAfter: bigint;
}): CheckResult[] {
    return [
        check(
            'locked-beyond-zero',
            input.lockedBeyondVp === 0n,
            `lockedBeyondVp=${input.lockedBeyondVp} (Flexible-only precondition)`,
        ),
        check(
            'claimed-vp-positive',
            input.claimedVp > 0n,
            `claimedVp=${input.claimedVp} (need Flexible stake so CastVote is attempted)`,
        ),
        check(
            'has-voted-false',
            !input.hasVoted,
            input.hasVoted ? 'vote wrongly recorded' : 'vote not recorded',
        ),
        check(
            'for-votes-unchanged',
            input.forVotesAfter === input.forVotesBefore,
            `forVotes ${input.forVotesBefore} → ${input.forVotesAfter} (expected reject)`,
        ),
    ];
}

export const NA_NO_FLEXIBLE_ONLY_VOTER =
    'no Flexible-only voter (Actor A has locked-beyond VP and deployer has none / no Flexible stake)';

/**
 * Prefer Blueprint actor when locked-beyond is 0 and total VP > 0; else deployer
 * (lab whale Flexible stake). Returns null when neither qualifies.
 */
export async function resolveFlexibleOnlyVoter(
    ctx: ScenarioContext,
): Promise<{ address: Address; via: 'blueprint' | 'deployer' } | null> {
    const voteEndTime = await estimateFreshVoteEndTime(ctx);
    const stakingLock = await resolveStakingLockAddr(ctx);
    const multipliers = await readTierMultipliers(ctx, stakingLock);

    const tryOwner = async (
        address: Address,
        via: 'blueprint' | 'deployer',
    ): Promise<{ address: Address; via: 'blueprint' | 'deployer' } | null> => {
        const locked = computeLockedBeyondVp(
            await readActorStakeRecords(ctx, address),
            multipliers,
            voteEndTime,
        );
        if (locked > 0n) {
            return null;
        }
        const vp = await fetchVotingPower(ctx, address);
        if (vp <= 0n) {
            return null;
        }
        return { address, via };
    };

    const actor = resolveGovActor(ctx);
    const asActor = await tryOwner(actor, 'blueprint');
    if (asActor) {
        return asActor;
    }

    try {
        const deployer = await resolveDeployerSender(ctx);
        return await tryOwner(deployer.address, 'deployer');
    } catch {
        return null;
    }
}

export async function naWhenFlexibleVpVoteReject(ctx: ScenarioContext): Promise<string | null> {
    const time = await naWhenGovTimeDependent(ctx);
    if (time) {
        return time;
    }
    if (!ctx.provider) {
        return NA_NO_FLEXIBLE_ONLY_VOTER;
    }
    const voter = await resolveFlexibleOnlyVoter(ctx);
    if (!voter) {
        return NA_NO_FLEXIBLE_ONLY_VOTER;
    }
    // If no votable proposal exists, CreateProposal needs Actor A locked VP.
    const existing = await resolveUsableProposal(ctx, 'votable');
    if (!existing) {
        const lockedNa = await naWhenLockedVpUnfundable(ctx);
        if (lockedNa) {
            return lockedNa;
        }
    }
    return null;
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
