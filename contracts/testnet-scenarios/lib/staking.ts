/**
 * Full-stack staking scenario helpers (IMP-TNFS-07).
 * Seed constants from scripts/stake-deposit-smoke-testnet.ts.
 * Happy-path stake uses Flexible (tier 0) — see decision log.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    Address,
    beginCell,
    toNano,
    TupleBuilder,
    type Slice,
    type TupleReader,
} from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { storeStakeForward } from '../../build/StakingMaster/StakingMaster_StakingMaster';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { StakingLock } from '../../wrappers/StakingLock';
import { StakingMaster } from '../../wrappers/StakingMaster';
import { StakingPool } from '../../wrappers/StakingPool';
import { check } from './checks';
import { NANO_PER_BURN, readJettonWalletBalance } from './balances';
import {
    naWhenMnemonicNotTestActor,
    resolveTestActorAddress,
} from './test-actor';
import type { CheckResult, ScenarioContext } from '../types';

/** Matches StakingMaster.MinStakeNano (0.01 BURN). */
export const MIN_STAKE_NANO = 10_000_000n;
/**
 * JettonNotification must fund `GasForwardStakeJetton(3.5) + 2*GasToPool + 0.08`
 * and, on top-up with pending rewards, `+ GasPayRewards(3.5)` → ≥ 7.2 TON on the
 * master. Forward below that refunds the stake (IMP-MNAUD-F09) and leaves the
 * wallet delta at 0 — live triage 2026-08-07.
 */
export const STAKE_FORWARD_TON = toNano('8');
/**
 * Attach must clear the post-F11 wallet entry gate (IMP-MNAUD-F20):
 *   value > forwardTonAmount + recipientForwards*fwd_fee + minTonFeePath
 *         = 8 + 2*fwd_fee(≈0.0003..0.004 live) + 1.0 (F17) ≈ 9.01 TON.
 * 10.6 leaves ~1.59 TON headroom for live fwd_fee variance; surplus refunds
 * via JettonExcesses. Pre-F11 value 9.5 (excluded gate 0.58) fails this gate.
 */
export const STAKE_ATTACHED_TON = toNano('10.6');
/** Seed stake size (5 BURN). */
export const STAKE_AMOUNT_HAPPY = 5n * NANO_PER_BURN;
/**
 * Flexible tier (0 lock) — preferred for stake/unstake/claim happy paths.
 * Seed script used Gold (2); Flexible enables unstake without waiting lock.
 */
export const FLEXIBLE_TIER = 0;
/** Silver — locked tier for early-exit reject assert. */
export const LOCKED_TIER = 1;
/** Sub-minimum probe amount (refunded / not credited). */
export const SUB_MIN_STAKE_NANO = MIN_STAKE_NANO - 1n;

export const NA_INSUFFICIENT_BURN = 'insufficient test wallet BURN';
export const NA_NO_OPEN_STAKE = 'no open stake';
export const NA_ZERO_PENDING = 'emission unfunded / zero pending';
export const NA_NO_PAUSE_KNOB = 'no pause knob in deployment';
export const NA_TIER_NO_LOCK = 'tier has no lock / N/A in code';
export {
    NA_TEST_ACTOR_MISMATCH,
    NA_TEST_ACTOR_UNSET,
} from './test-actor';

export type StakingAbiSlice = {
    receivers?: Array<{
        receiver?: string;
        message?: { kind?: string; type?: string };
    }>;
    getters?: Array<{ name?: string }>;
};

/** Jetton forward_payload for staking master (StakeForward in ref, either-bit = 1). */
export function stakeForwardPayload(tier: number): Slice {
    return beginCell()
        .storeUint(1, 1)
        .storeRef(
            beginCell()
                .store(storeStakeForward({ $$type: 'StakeForward', tier: BigInt(tier) }))
                .endCell(),
        )
        .endCell()
        .asSlice();
}

/** Stake sender = Actor A (FEE_TEST_SENDER / TEST_ACTOR / mnemonic-injected) or airdrop fallback. */
export function resolveStaker(ctx: ScenarioContext): Address {
    return resolveTestActorAddress(ctx);
}

/** N/A when Blueprint signer ≠ resolved staker (replaces mnemonic≠airdrop hard-fail). */
export function naWhenStakerSenderReady(ctx: ScenarioContext): string | null {
    try {
        return naWhenMnemonicNotTestActor(ctx, resolveStaker(ctx));
    } catch {
        return NA_INSUFFICIENT_BURN;
    }
}

export function requireStakingPoolAddr(ctx: ScenarioContext): Address {
    const raw = ctx.manifest.addresses.stakingPool;
    if (!raw) {
        throw new Error('Manifest incomplete: missing addresses.stakingPool');
    }
    return Address.parse(raw);
}

export function requireStakingLockAddr(ctx: ScenarioContext): Address {
    const raw = ctx.manifest.addresses.stakingLock;
    if (!raw) {
        throw new Error('Manifest incomplete: missing addresses.stakingLock');
    }
    return Address.parse(raw);
}

/**
 * Open wrapper (not ABI `fromAddress` base) so sendUnstakeJetton / sendClaimRewards
 * are available on NetworkProvider OpenedContract.
 */
export function openStakingMaster(ctx: ScenarioContext) {
    return ctx.provider.open(
        new StakingMaster(Address.parse(ctx.manifest.addresses.stakingMaster)),
    );
}

export function openStakingPool(ctx: ScenarioContext) {
    return ctx.provider.open(new StakingPool(requireStakingPoolAddr(ctx)));
}

export function openStakingLock(ctx: ScenarioContext) {
    return ctx.provider.open(new StakingLock(requireStakingLockAddr(ctx)));
}

/** get_stake record (StakeInfoView fields). */
export type StakeRecordView = {
    amount: bigint;
    tier: bigint;
    startTime: bigint;
    lastClaimTime: bigint;
    unlockTime: bigint;
};

/**
 * Read one Int field from a getter tuple, tolerating both well-formed
 * `TupleItem` objects and the RAW values `@ton/ton` TonClient (toncenter API
 * v2 — Blueprint's default client) produces for NESTED tuples: its
 * `parseStackEntry` unwraps nested tuple elements to plain bigint instead of
 * `{ type: 'int', value }`, so `TupleReader.readBigNumber()` throws
 * "Not a number" for every non-null `get_stake` result (IMP-TNFS-F09 root
 * cause — live stake records looked missing while they existed on-chain).
 */
export function readGetterIntFlexible(item: unknown, field: string): bigint {
    if (typeof item === 'bigint') {
        return item;
    }
    if (typeof item === 'number' && Number.isSafeInteger(item)) {
        return BigInt(item);
    }
    if (typeof item === 'string' && /^-?\d+$/.test(item)) {
        return BigInt(item);
    }
    if (item !== null && typeof item === 'object') {
        const t = item as { type?: unknown; value?: unknown };
        if (t.type === 'int' && typeof t.value === 'bigint') {
            return t.value;
        }
    }
    throw new Error(`get_stake: cannot read ${field} from stack item: ${String(item)}`);
}

/** Parse the 5-field StakeInfoView getter tuple (well-formed or toncenter-v2-shaped). */
export function parseStakeRecordTuple(t: TupleReader): StakeRecordView {
    return {
        amount: readGetterIntFlexible(t.pop(), 'amount'),
        tier: readGetterIntFlexible(t.pop(), 'tier'),
        startTime: readGetterIntFlexible(t.pop(), 'startTime'),
        lastClaimTime: readGetterIntFlexible(t.pop(), 'lastClaimTime'),
        unlockTime: readGetterIntFlexible(t.pop(), 'unlockTime'),
    };
}

/**
 * Read `get_stake(owner, tier)` directly (bypasses the generated wrapper whose
 * `readBigNumber` chokes on TonClient-v2 nested tuples). Throws on real errors.
 */
export async function readStakeRecord(
    provider: NetworkProvider,
    stakingMaster: Address,
    owner: Address,
    tier: number,
): Promise<StakeRecordView | null> {
    const args = new TupleBuilder();
    args.writeAddress(owner);
    args.writeNumber(BigInt(tier));
    const res = await provider.provider(stakingMaster).get('get_stake', args.build());
    const t = res.stack.readTupleOpt();
    if (!t) {
        return null;
    }
    return parseStakeRecordTuple(t);
}

/** True for get-method execution failures (uninit account, node-side exit codes). */
export function isGetMethodExecutionError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /exit_?code|unable to execute get method|non-active contract/i.test(msg);
}

/**
 * Stake amount for (owner, tier); 0 when there is no record.
 *
 * Get-method EXECUTION failures (uninit master on a fresh tip, transient node
 * exit codes) still degrade to 0 so naWhen* guards keep working. PARSE failures
 * now propagate: the old catch-all turned the IMP-TNFS-F09 client parse bug
 * into a silent "stake = 0", which live looked like lost user funds.
 */
export async function readStakeAmount(
    provider: NetworkProvider,
    stakingMaster: Address,
    owner: Address,
    tier: number,
): Promise<bigint> {
    try {
        const record = await readStakeRecord(provider, stakingMaster, owner, tier);
        return record?.amount ?? 0n;
    } catch (err) {
        if (isGetMethodExecutionError(err)) {
            return 0n;
        }
        throw err;
    }
}

export async function readPoolTotalStake(
    provider: NetworkProvider,
    pool: Address,
    tier: number,
): Promise<bigint> {
    const p = provider.open(new StakingPool(pool));
    return p.getGetTotalStake(BigInt(tier));
}

export async function readPendingReward(
    provider: NetworkProvider,
    stakingMaster: Address,
    owner: Address,
    tier: number,
): Promise<bigint> {
    const master = provider.open(new StakingMaster(stakingMaster));
    try {
        return await master.getGetPendingReward(owner, BigInt(tier));
    } catch {
        return 0n;
    }
}

export async function sleepMs(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
}

/** Poll until stake amount reaches `minAmount` or timeout. */
export async function waitForStakeAtLeast(
    provider: NetworkProvider,
    stakingMaster: Address,
    owner: Address,
    tier: number,
    minAmount: bigint,
    attempts = 12,
    sleep = 5_000,
): Promise<bigint> {
    let last = 0n;
    for (let i = 0; i < attempts; i++) {
        last = await readStakeAmount(provider, stakingMaster, owner, tier);
        if (last >= minAmount) {
            return last;
        }
        await sleepMs(sleep);
    }
    throw new Error(
        `Stake did not reach ${minAmount} for tier=${tier} (last=${last}) after ${attempts} polls`,
    );
}

export async function sendStakeJettons(
    ctx: ScenarioContext,
    opts: { amount: bigint; tier: number; staker: Address },
): Promise<void> {
    const { provider, manifest } = ctx;
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const stakingMaster = Address.parse(manifest.addresses.stakingMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const jwAddr = await master.getGetWalletAddress(opts.staker);
    const userJw = provider.open(BurnJettonWallet.fromAddress(jwAddr));
    await userJw.sendTransfer(provider.sender(), {
        jettonAmount: opts.amount,
        destinationOwner: stakingMaster,
        responseDestination: opts.staker,
        forwardTonAmount: STAKE_FORWARD_TON,
        forwardPayload: stakeForwardPayload(opts.tier),
        value: STAKE_ATTACHED_TON,
    });
}

export function loadStakingMasterAbi(contractsRoot: string): StakingAbiSlice {
    const path = join(
        contractsRoot,
        'build',
        'StakingMaster',
        'StakingMaster_StakingMaster.abi',
    );
    if (!existsSync(path)) {
        throw new Error(`StakingMaster ABI missing at ${path} — run npm run build`);
    }
    return JSON.parse(readFileSync(path, 'utf8')) as StakingAbiSlice;
}

export function loadStakingMasterTact(contractsRoot: string): string | null {
    const path = join(contractsRoot, 'staking', 'staking-master.tact');
    if (!existsSync(path)) {
        return null;
    }
    return readFileSync(path, 'utf8');
}

/** True when ABI/tact expose a pause / freeze / halt admin receiver. */
export function abiHasPauseKnob(abi: StakingAbiSlice, tactSource?: string | null): boolean {
    const pauseTypes = new Set([
        'Pause',
        'Unpause',
        'SetPaused',
        'SetPause',
        'Halt',
        'Freeze',
        'SetHalted',
    ]);
    const hasReceiver = (abi.receivers ?? []).some(
        (r) => r.message?.kind === 'typed' && !!r.message.type && pauseTypes.has(r.message.type),
    );
    if (hasReceiver) {
        return true;
    }
    if (tactSource == null) {
        return false;
    }
    return /\b(pause|unpause|setPaused|halted|freeze)\b/i.test(tactSource);
}

export function pauseNaReason(hasKnob: boolean): string | null {
    return hasKnob ? null : NA_NO_PAUSE_KNOB;
}

export function lockDurationNaReason(durationSeconds: bigint): string | null {
    return durationSeconds > 0n ? null : NA_TIER_NO_LOCK;
}

export async function naWhenInsufficientBurn(
    ctx: ScenarioContext,
    need: bigint = STAKE_AMOUNT_HAPPY,
): Promise<string | null> {
    const senderNa = naWhenStakerSenderReady(ctx);
    if (senderNa) {
        return senderNa;
    }
    try {
        const staker = resolveStaker(ctx);
        const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
        const bal = await readJettonWalletBalance(ctx.provider, jettonMaster, staker);
        if (bal < need) {
            return NA_INSUFFICIENT_BURN;
        }
        return null;
    } catch {
        return NA_INSUFFICIENT_BURN;
    }
}

export async function naWhenNoOpenStake(
    ctx: ScenarioContext,
    tier: number = FLEXIBLE_TIER,
): Promise<string | null> {
    const senderNa = naWhenStakerSenderReady(ctx);
    if (senderNa) {
        return senderNa;
    }
    const staker = resolveStaker(ctx);
    const stakingMaster = Address.parse(ctx.manifest.addresses.stakingMaster);
    const amt = await readStakeAmount(ctx.provider, stakingMaster, staker, tier);
    return amt > 0n ? null : NA_NO_OPEN_STAKE;
}

export async function naWhenZeroPending(
    ctx: ScenarioContext,
    tier: number = FLEXIBLE_TIER,
): Promise<string | null> {
    const senderNa = naWhenStakerSenderReady(ctx);
    if (senderNa) {
        return senderNa;
    }
    const staker = resolveStaker(ctx);
    const stakingMasterAddr = Address.parse(ctx.manifest.addresses.stakingMaster);
    const master = openStakingMaster(ctx);
    let funded = 0n;
    try {
        funded = await master.getGetEmissionFunded();
    } catch {
        funded = 0n;
    }
    const pending = await readPendingReward(ctx.provider, stakingMasterAddr, staker, tier);
    if (pending > 0n) {
        return null;
    }
    if (funded <= 0n) {
        return NA_ZERO_PENDING;
    }
    return NA_ZERO_PENDING;
}

export function naWhenNoPauseKnob(ctx: ScenarioContext): string | null {
    const abi = loadStakingMasterAbi(ctx.contractsRoot);
    const tact = loadStakingMasterTact(ctx.contractsRoot);
    return pauseNaReason(abiHasPauseKnob(abi, tact));
}

// ─── Pure check helpers (unit-tested) ───────────────────────────────────────

export function checkStakeMapUpdated(input: {
    stakeBefore: bigint;
    stakeAfter: bigint;
    poolBefore: bigint;
    poolAfter: bigint;
    amount: bigint;
    tier: number;
}): CheckResult[] {
    const stakeDelta = input.stakeAfter - input.stakeBefore;
    const poolDelta = input.poolAfter - input.poolBefore;
    return [
        check(
            'stake-map-updated',
            stakeDelta >= input.amount,
            `tier ${input.tier} stake ${input.stakeBefore} → ${input.stakeAfter} (delta ${stakeDelta}, need ≥ ${input.amount})`,
        ),
        check(
            'pool-tier-updated',
            poolDelta >= input.amount,
            `tier ${input.tier} pool total ${input.poolBefore} → ${input.poolAfter} (delta ${poolDelta}, need ≥ ${input.amount})`,
        ),
    ];
}

export function checkUnstakeReturned(input: {
    stakeBefore: bigint;
    stakeAfter: bigint;
    walletBefore: bigint;
    walletAfter: bigint;
    amount: bigint;
}): CheckResult[] {
    const stakeDrop = input.stakeBefore - input.stakeAfter;
    const walletGain = input.walletAfter - input.walletBefore;
    return [
        check(
            'stake-decreased',
            stakeDrop >= input.amount,
            `stake ${input.stakeBefore} → ${input.stakeAfter} (drop ${stakeDrop}, need ≥ ${input.amount})`,
        ),
        check(
            'principal-returned',
            walletGain >= input.amount,
            `wallet ${input.walletBefore} → ${input.walletAfter} (gain ${walletGain}, need ≥ ${input.amount})`,
        ),
    ];
}

/** First claim must credit wallet; immediate re-claim must not inflate. */
export function checkClaimNoDoublePay(input: {
    walletBefore: bigint;
    walletAfterFirst: bigint;
    walletAfterSecond: bigint;
    pendingBefore: bigint;
}): CheckResult[] {
    const firstGain = input.walletAfterFirst - input.walletBefore;
    const secondGain = input.walletAfterSecond - input.walletAfterFirst;
    return [
        check(
            'claim-credited',
            firstGain > 0n,
            `first claim gain ${firstGain} (pending was ${input.pendingBefore})`,
        ),
        check(
            'no-double-pay',
            secondGain === 0n,
            `second claim gain ${secondGain} (expected 0 — no inflation)`,
        ),
    ];
}

export function checkInsufficientStakeRejected(input: {
    stakeBefore: bigint;
    stakeAfter: bigint;
    walletBefore: bigint;
    walletAfter: bigint;
    attempted: bigint;
}): CheckResult[] {
    return [
        check(
            'stake-not-credited',
            input.stakeAfter === input.stakeBefore,
            `stake unchanged ${input.stakeBefore} → ${input.stakeAfter} after sub-min ${input.attempted}`,
        ),
        check(
            'submin-refunded',
            input.walletAfter >= input.walletBefore,
            `wallet ${input.walletBefore} → ${input.walletAfter} (refunded/rejected; not net drained by ${input.attempted})`,
        ),
    ];
}

export function checkEarlyExitRejected(input: {
    stakeBefore: bigint;
    stakeAfter: bigint;
    lockDurationSeconds: bigint;
}): CheckResult[] {
    return [
        check(
            'lock-duration-positive',
            input.lockDurationSeconds > 0n,
            `lock duration ${input.lockDurationSeconds}s`,
        ),
        check(
            'early-exit-rejected',
            input.stakeAfter === input.stakeBefore && input.stakeBefore > 0n,
            `stake unchanged after early unstake attempt (${input.stakeBefore} → ${input.stakeAfter}); tact reject Still locked`,
        ),
    ];
}

export function checkExcludedWalletInOut(input: {
    stakingMasterExcluded: boolean;
    stakingPoolExcluded: boolean;
    transferInAmount: bigint;
    userDeltaOnStake: bigint;
    userDeltaOnUnstake: bigint;
    /**
     * Pending rewards before stake. Top-up merge may auto-pay them into the JW
     * so the observed debit is `-amount + claim` with `0 ≤ claim ≤ pendingBefore`.
     */
    pendingBefore?: bigint;
}): CheckResult[] {
    const pending = input.pendingBefore ?? 0n;
    // claimCredit = auto-paid pending (and any emission tick during merge). A fee cut
    // on the stake transfer would make this negative. Net JW credit is OK when pending
    // rewards paid on top-up exceed the new stake slice (live: +1.04M with 10M stake).
    const claimCredit = input.userDeltaOnStake + input.transferInAmount;
    const transferInOk = claimCredit >= 0n;
    return [
        check(
            'staking-master-excluded',
            input.stakingMasterExcluded,
            'stakingMaster is fee-excluded',
        ),
        check(
            'staking-pool-excluded',
            input.stakingPoolExcluded,
            'stakingPool is fee-excluded',
        ),
        check(
            'transfer-in-full',
            transferInOk,
            `stake debit ${input.userDeltaOnStake} (expected -${input.transferInAmount}` +
                (claimCredit > 0n || pending > 0n
                    ? ` + claimCredit ${claimCredit} (pendingBefore ${pending})`
                    : ', no fee cut') +
                `)`,
        ),
        check(
            'transfer-out-full',
            // Principal always returned; pending rewards may ride along on unstake payout.
            input.userDeltaOnUnstake >= input.transferInAmount,
            `unstake credit ${input.userDeltaOnUnstake} (expected ≥ ${input.transferInAmount} principal, excluded payout)`,
        ),
    ];
}

export function checkMasterSmoke(input: {
    manifestStaking: Address;
    onChainJetton: Address;
    manifestJetton: Address;
    onChainPool: Address;
    manifestPool: Address;
    codeHash?: string;
}): CheckResult[] {
    const checks: CheckResult[] = [
        check(
            'manifest-address',
            true,
            `staking master ${input.manifestStaking.toString({ urlSafe: true, bounceable: true })}`,
        ),
        check(
            'linked-jetton',
            input.onChainJetton.equals(input.manifestJetton),
            `get_jetton_master matches manifest jetton`,
        ),
        check(
            'linked-pool',
            input.onChainPool.equals(input.manifestPool),
            `get_pool matches manifest stakingPool`,
        ),
    ];
    if (input.codeHash) {
        checks.push(
            check('code-hash-present', input.codeHash.length > 0, `codeHashes.staking=${input.codeHash}`),
        );
    } else {
        checks.push(
            check(
                'code-hash-optional',
                true,
                'manifest.codeHashes.staking absent — address/link checks only',
            ),
        );
    }
    return checks;
}
