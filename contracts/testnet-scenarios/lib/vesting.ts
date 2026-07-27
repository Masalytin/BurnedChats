/**
 * Full-stack vesting scenario helpers (IMP-TNFS-10).
 * Pure vested_amount mirrors vesting.tact; destructive revoke is lab-only.
 */
import { Address, beginCell, Cell, toNano } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import {
    storeVestEmergencyRevoke,
    storeVestRelease,
} from '../../build/Vesting/Vesting_Vesting';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { Timelock } from '../../wrappers/Timelock';
import { Vesting } from '../../wrappers/Vesting';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { check } from './checks';
import { readJettonWalletBalance } from './balances';
import { collectVestingAddresses } from './fingerprint';
import type { CheckResult, ScenarioContext } from '../types';

/** Matches vesting.tact VestRelease / VestEmergencyRevoke opcodes. */
export const OP_VEST_RELEASE = 0x5a060001n;
export const OP_VEST_EMERGENCY_REVOKE = 0x5a060002n;

/** Matches Vesting.ReleaseTon — outbound JettonTransfer attach. */
export const VESTING_RELEASE_TON = toNano('3.5');
/**
 * Known Timelock.TIMELOCK_TARGET_GAS for ordinary (non-relay) executes.
 * VestEmergencyRevoke uses the Timelock value-forward relay (IMP-TNFS-F03), not this constant.
 */
export const TIMELOCK_TARGET_GAS = toNano('0.12');
/**
 * Executor attach for TimelockExecutePending when method is VestEmergencyRevoke.
 * Funds mark-executed (0.04) + storage reserve (0.05) + ReleaseTon (3.5) + compute margin.
 */
export const VESTING_REVOKE_EXECUTE_TON = toNano('3.8');

/** Tiny attach for reject probes (bounce before jetton transfer). */
export const REJECT_PROBE_TON = toNano('0.2');

export const NA_NO_VESTING = 'no vesting in manifest';
export const NA_SHARED_DESTRUCTIVE =
    'destructive vesting emergency-revoke must not run against shared tip — use --manifest lab (or explicit --tag destructive on lab)';
/**
 * Historical N/A string (IMP-TNFS-10). Retired for tips with Timelock revoke relay (IMP-TNFS-F03).
 * Kept for report catalog / old JSON compatibility — harness no longer returns it on new tip.
 */
export const NA_REVOKE_DISABLED =
    'revoke path disabled (Timelock TIMELOCK_TARGET_GAS < Vesting.ReleaseTon — cannot fund VestEmergencyRevoke via authorized Timelock execute)';
/** Lab tip still running pre-F03 Timelock code (no VestEmergencyRevoke relay). */
export const NA_REVOKE_NEEDS_REDEPLOY =
    'vesting emergency-revoke requires lab tip with Timelock VestEmergencyRevoke relay (IMP-TNFS-F03) — redeploy lab Timelock before live revoke';
export const NA_BEFORE_CLIFF_OR_FULLY_CLAIMED = 'before cliff / fully claimed';
export const NA_NOTHING_TO_REVOKE = 'nothing to revoke (remaining locked = 0)';
export const NA_NO_BEFORE_CLIFF_VAULT = 'no vesting vault still before cliff';
export const NA_SENDER_NOT_BENEFICIARY = 'mnemonic wallet is not vault beneficiary';
export const NA_SENDER_IS_BENEFICIARY = 'mnemonic wallet is beneficiary — cannot probe unauthorized claim';
export const NA_CANNOT_ACT_AS_TIMELOCK_GOVERNOR =
    'sender is not Timelock governor — cannot perform authorized VestEmergencyRevoke path';

/**
 * Manifest keys probed for vesting vaults. All are optional — `listVestingEntries`
 * skips absent keys. `vestingStakingAllocation` exists only on pre-F01 stacks:
 * post-IMP-MNAUD-F01 deployments mint the staking allocation directly to the
 * StakingPool jetton wallet and have no such vault.
 */
export const VESTING_ADDRESS_KEYS = [
    'vestingDeveloper',
    'vestingEcosystem',
    'vestingReserve',
    'vestingStakingAllocation',
] as const;

export type VestingAddressKey = (typeof VESTING_ADDRESS_KEYS)[number];

export type VestingScheduleView = {
    beneficiary: Address;
    treasury: Address;
    timelock: Address;
    jettonMaster: Address;
    totalAmount: bigint;
    releasedAmount: bigint;
    startTime: bigint;
    cliffDuration: bigint;
    vestingDuration: bigint;
};

export type VestingVaultState = {
    key: string;
    address: Address;
    schedule: VestingScheduleView;
    vaultJettonWallet: Address;
};

export const VESTING_SCENARIO_IDS = [
    'fs-vesting-smoke',
    'fs-vesting-claim-before-cliff-reject',
    'fs-vesting-claim-linear',
    'fs-vesting-unauthorized-claim-reject',
    'fs-vesting-emergency-revoke',
] as const;

export const DESTRUCTIVE_VESTING_IDS = ['fs-vesting-emergency-revoke'] as const;

/**
 * Pure mirror of vesting.tact `vested_amount(currentTime)`.
 * Cliff-only schedules (cliff == vesting) unlock fully at cliff end.
 */
export function vestedAmountAt(params: {
    totalAmount: bigint;
    startTime: bigint;
    cliffDuration: bigint;
    vestingDuration: bigint;
    currentTime: bigint;
}): bigint {
    const { totalAmount, startTime, cliffDuration, vestingDuration, currentTime } = params;
    if (cliffDuration > vestingDuration) {
        throw new Error('Bad vesting schedule: cliff > vesting');
    }
    if (currentTime < startTime + cliffDuration) {
        return 0n;
    }
    if (currentTime >= startTime + vestingDuration) {
        return totalAmount;
    }
    const elapsed = currentTime - startTime - cliffDuration;
    const linearWindow = vestingDuration - cliffDuration;
    if (linearWindow <= 0n) {
        throw new Error('Invalid vesting schedule: linear window is 0 before end');
    }
    return (totalAmount * elapsed) / linearWindow;
}

export function releasableAmountAt(params: {
    totalAmount: bigint;
    startTime: bigint;
    cliffDuration: bigint;
    vestingDuration: bigint;
    releasedAmount: bigint;
    currentTime: bigint;
}): bigint {
    const vested = vestedAmountAt(params);
    const r = vested - params.releasedAmount;
    return r > 0n ? r : 0n;
}

export function nowUnix(): bigint {
    return BigInt(Math.floor(Date.now() / 1000));
}

export function listVestingEntries(
    ctx: ScenarioContext,
): Array<{ key: string; address: Address }> {
    const a = ctx.manifest.addresses;
    const out: Array<{ key: string; address: Address }> = [];
    for (const key of VESTING_ADDRESS_KEYS) {
        const raw = a[key];
        if (raw) {
            out.push({ key, address: Address.parse(raw) });
        }
    }
    // Any extra vesting* keys from fingerprint collector (sorted).
    for (const addr of collectVestingAddresses(a)) {
        if (!out.some((e) => e.address.toString() === Address.parse(addr).toString())) {
            out.push({ key: `vesting:${addr}`, address: Address.parse(addr) });
        }
    }
    return out;
}

export function naWhenNoVesting(ctx: ScenarioContext): string | null {
    if (listVestingEntries(ctx).length === 0) {
        return NA_NO_VESTING;
    }
    return null;
}

/** Shared tip: never execute emergency-revoke (would burn Mini App canon). */
export function naWhenSharedDestructive(ctx: ScenarioContext): string | null {
    if (ctx.manifestKind === 'shared') {
        return NA_SHARED_DESTRUCTIVE;
    }
    return null;
}

/**
 * Pre-F03 gate: fixed TIMELOCK_TARGET_GAS could not fund ReleaseTon.
 * Post-F03 Timelock relays executor value for VestEmergencyRevoke — path is enabled
 * whenever the tip includes that code. Always false for the new tip constants.
 */
export function isRevokePathDisabled(): boolean {
    return false;
}

export function openVesting(provider: NetworkProvider, address: Address) {
    return provider.open(Vesting.fromAddress(address));
}

export async function readVestingSchedule(
    provider: NetworkProvider,
    vault: Address,
): Promise<VestingScheduleView> {
    const v = openVesting(provider, vault);
    const s = await v.getGetSchedule();
    return {
        beneficiary: s.beneficiary,
        treasury: s.treasury,
        timelock: s.timelock,
        jettonMaster: s.jetton_master,
        totalAmount: s.total_amount,
        releasedAmount: s.released_amount,
        startTime: s.start_time,
        cliffDuration: s.cliff_duration,
        vestingDuration: s.vesting_duration,
    };
}

export async function readVaultJettonWallet(
    provider: NetworkProvider,
    jettonMaster: Address,
    vault: Address,
): Promise<Address> {
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    return master.getGetWalletAddress(vault);
}

export async function loadVaultState(
    ctx: ScenarioContext,
    key: string,
    address: Address,
): Promise<VestingVaultState> {
    const schedule = await readVestingSchedule(ctx.provider, address);
    const vaultJettonWallet = await readVaultJettonWallet(
        ctx.provider,
        schedule.jettonMaster,
        address,
    );
    return { key, address, schedule, vaultJettonWallet };
}

export async function loadAllVaultStates(ctx: ScenarioContext): Promise<VestingVaultState[]> {
    const entries = listVestingEntries(ctx);
    const states: VestingVaultState[] = [];
    for (const e of entries) {
        states.push(await loadVaultState(ctx, e.key, e.address));
    }
    return states;
}

/** Prefer env VESTING_VAULT / VESTING_ALLOCATION, else first manifest vault. */
export async function resolvePreferredVault(
    ctx: ScenarioContext,
): Promise<VestingVaultState | null> {
    const entries = listVestingEntries(ctx);
    if (entries.length === 0) {
        return null;
    }
    const envAddr = process.env.VESTING_VAULT?.trim();
    if (envAddr) {
        const address = Address.parse(envAddr);
        const key =
            entries.find((e) => e.address.equals(address))?.key ?? `vesting:${envAddr}`;
        return loadVaultState(ctx, key, address);
    }
    const alloc = process.env.VESTING_ALLOCATION?.trim().toLowerCase().replace(/_/g, '-');
    if (alloc) {
        const keyMap: Record<string, string> = {
            developer: 'vestingDeveloper',
            ecosystem: 'vestingEcosystem',
            reserve: 'vestingReserve',
            // Pre-F01 stacks only; on post-F01 manifests the key is absent and the
            // lookup falls through to the first available vault below.
            'staking-allocation': 'vestingStakingAllocation',
            staking: 'vestingStakingAllocation',
        };
        const key = keyMap[alloc];
        const hit = key ? entries.find((e) => e.key === key) : undefined;
        if (hit) {
            return loadVaultState(ctx, hit.key, hit.address);
        }
    }
    const first = entries[0]!;
    return loadVaultState(ctx, first.key, first.address);
}

export function buildVestReleaseBody(queryId: bigint = 0n): Cell {
    return beginCell()
        .store(storeVestRelease({ $$type: 'VestRelease', queryId }))
        .endCell();
}

export function buildVestEmergencyRevokeBody(queryId: bigint = 0n): Cell {
    return beginCell()
        .store(storeVestEmergencyRevoke({ $$type: 'VestEmergencyRevoke', queryId }))
        .endCell();
}

export async function sendVestRelease(
    ctx: ScenarioContext,
    vault: Address,
    value: bigint = REJECT_PROBE_TON,
): Promise<void> {
    const vest = new Vesting(vault);
    const vestProvider = ctx.provider.provider(vault);
    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await vest.send(vestProvider, ctx.provider.sender(), { value, bounce: true }, {
        $$type: 'VestRelease',
        queryId: 0n,
    });
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);
}

function nextProposalId(): bigint {
    return BigInt(Date.now() % 1_000_000_000_000) * 1000n + BigInt(Math.floor(Math.random() * 1000));
}

/**
 * Authorized VestEmergencyRevoke: Timelock governor queues delay=0 then executes
 * with a relay budget (≥ ReleaseTon + mark-executed + storage reserve).
 * Requires tip Timelock that relays VestEmergencyRevoke (IMP-TNFS-F03).
 */
export async function sendEmergencyRevokeViaTimelock(
    ctx: ScenarioContext,
    opts: { vault: Address; timelock: Address; label: string },
): Promise<void> {
    const { provider } = ctx;
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }
    const tl = new Timelock(opts.timelock);
    const tlProvider = provider.provider(opts.timelock);
    const proposalId = nextProposalId();
    const body = buildVestEmergencyRevokeBody();
    console.log(
        `[${opts.label}] Timelock queue+execute proposalId=${proposalId} method=0x${OP_VEST_EMERGENCY_REVOKE.toString(16)} delay=0 value=${VESTING_REVOKE_EXECUTE_TON} vault=${opts.vault.toString({ urlSafe: true, bounceable: true })}`,
    );

    let seqnoBefore = await getSenderSeqno(provider);
    await tl.sendQueue(tlProvider, provider.sender(), {
        proposalId,
        proposalContract: sender,
        target: opts.vault,
        method: OP_VEST_EMERGENCY_REVOKE,
        args: body,
        delay: 0n,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    seqnoBefore = await getSenderSeqno(provider);
    await tl.sendExecutePending(
        tlProvider,
        provider.sender(),
        proposalId,
        0n,
        VESTING_REVOKE_EXECUTE_TON,
    );
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
}

export async function sleepMs(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
}

export async function pollReleasedAtLeast(
    provider: NetworkProvider,
    vault: Address,
    minReleased: bigint,
    attempts = 12,
    sleep = 2_000,
): Promise<bigint> {
    let released = (await readVestingSchedule(provider, vault)).releasedAmount;
    for (let i = 0; i < attempts && released < minReleased; i += 1) {
        await sleepMs(sleep);
        released = (await readVestingSchedule(provider, vault)).releasedAmount;
    }
    return released;
}

export function checkVestingSmoke(input: {
    vault: Address;
    onChainJetton: Address;
    manifestJetton: Address;
    vaultJettonWallet: Address;
    schedule: VestingScheduleView;
}): CheckResult[] {
    const s = input.schedule;
    return [
        check(
            'manifest-vault',
            true,
            `vault ${input.vault.toString({ urlSafe: true, bounceable: true })}`,
        ),
        check(
            'schedule-readable',
            s.totalAmount > 0n && s.vestingDuration >= s.cliffDuration,
            `total=${s.totalAmount} start=${s.startTime} cliff=${s.cliffDuration} vesting=${s.vestingDuration} released=${s.releasedAmount}`,
        ),
        check(
            'linked-jetton',
            input.onChainJetton.equals(input.manifestJetton),
            `jetton_master=${input.onChainJetton.toString({ urlSafe: true, bounceable: true })}`,
        ),
        check(
            'linked-jetton-wallet',
            input.vaultJettonWallet !== undefined,
            `vault JW ${input.vaultJettonWallet.toString({ urlSafe: true, bounceable: true })}`,
        ),
        check(
            'beneficiary-readable',
            !!s.beneficiary,
            `beneficiary=${s.beneficiary.toString({ urlSafe: true, bounceable: true })}`,
        ),
    ];
}

export function checkBeforeCliffRejected(input: {
    releasableNow: bigint;
    releasedBefore: bigint;
    releasedAfter: bigint;
    beforeCliff: boolean;
}): CheckResult[] {
    return [
        check(
            'before-cliff',
            input.beforeCliff,
            input.beforeCliff ? 'currentTime < start+cliff' : 'not before cliff — wrong vault/time',
        ),
        check(
            'releasable-zero',
            input.releasableNow === 0n,
            `releasable_at(now)=${input.releasableNow}`,
        ),
        check(
            'released-unchanged',
            input.releasedAfter === input.releasedBefore,
            `released ${input.releasedBefore} → ${input.releasedAfter}`,
        ),
    ];
}

export function checkLinearClaim(input: {
    vestedNow: bigint;
    releasableBefore: bigint;
    releasedBefore: bigint;
    releasedAfter: bigint;
    beneficiaryWalletBefore: bigint;
    beneficiaryWalletAfter: bigint;
}): CheckResult[] {
    const claimed = input.releasedAfter - input.releasedBefore;
    const walletDelta = input.beneficiaryWalletAfter - input.beneficiaryWalletBefore;
    return [
        check(
            'had-releasable',
            input.releasableBefore > 0n,
            `releasable_before=${input.releasableBefore}`,
        ),
        check(
            'claim-le-vested',
            input.releasedAfter <= input.vestedNow,
            `released_after=${input.releasedAfter} ≤ vested_amount(now)=${input.vestedNow}`,
        ),
        check(
            'released-increased',
            claimed > 0n,
            `released Δ=${claimed} (expected > 0)`,
        ),
        check(
            'beneficiary-wallet-increased',
            walletDelta > 0n,
            `beneficiary JW ${input.beneficiaryWalletBefore} → ${input.beneficiaryWalletAfter}`,
        ),
        check(
            'claim-matches-releasable',
            claimed === input.releasableBefore,
            `claimed=${claimed} releasable_before=${input.releasableBefore}`,
        ),
    ];
}

export function checkUnauthorizedClaimRejected(input: {
    releasedBefore: bigint;
    releasedAfter: bigint;
    senderIsBeneficiary: boolean;
}): CheckResult[] {
    return [
        check(
            'sender-not-beneficiary',
            !input.senderIsBeneficiary,
            input.senderIsBeneficiary
                ? 'sender is beneficiary — unauthorized probe invalid'
                : 'sender ≠ beneficiary',
        ),
        check(
            'released-unchanged',
            input.releasedAfter === input.releasedBefore,
            `released ${input.releasedBefore} → ${input.releasedAfter}`,
        ),
    ];
}

export function checkEmergencyRevoke(input: {
    totalAmount: bigint;
    releasedBefore: bigint;
    releasedAfter: bigint;
    vaultWalletBefore: bigint;
    vaultWalletAfter: bigint;
    treasuryWalletBefore: bigint;
    treasuryWalletAfter: bigint;
}): CheckResult[] {
    const remainingBefore = input.totalAmount - input.releasedBefore;
    return [
        check(
            'had-remaining',
            remainingBefore > 0n,
            `remaining_before=${remainingBefore}`,
        ),
        check(
            'fully-released-after-revoke',
            input.releasedAfter === input.totalAmount,
            `released ${input.releasedBefore} → ${input.releasedAfter} (total=${input.totalAmount})`,
        ),
        check(
            'vault-wallet-decreased',
            input.vaultWalletAfter < input.vaultWalletBefore || remainingBefore === 0n,
            `vault JW ${input.vaultWalletBefore} → ${input.vaultWalletAfter}`,
        ),
        check(
            'treasury-wallet-increased',
            input.treasuryWalletAfter > input.treasuryWalletBefore || remainingBefore === 0n,
            `treasury JW ${input.treasuryWalletBefore} → ${input.treasuryWalletAfter}`,
        ),
    ];
}

export async function naWhenSmoke(ctx: ScenarioContext): Promise<string | null> {
    return naWhenNoVesting(ctx);
}

export async function naWhenBeforeCliff(ctx: ScenarioContext): Promise<string | null> {
    const no = naWhenNoVesting(ctx);
    if (no) {
        return no;
    }
    const states = await loadAllVaultStates(ctx);
    const t = nowUnix();
    const hit = states.find((s) => t < s.schedule.startTime + s.schedule.cliffDuration);
    if (!hit) {
        return NA_NO_BEFORE_CLIFF_VAULT;
    }
    return null;
}

export async function naWhenLinearClaim(ctx: ScenarioContext): Promise<string | null> {
    const no = naWhenNoVesting(ctx);
    if (no) {
        return no;
    }
    const sender = ctx.provider.sender().address;
    if (!sender) {
        return NA_SENDER_NOT_BENEFICIARY;
    }
    const states = await loadAllVaultStates(ctx);
    const t = nowUnix();
    const hit = states.find((s) => {
        if (!s.schedule.beneficiary.equals(sender)) {
            return false;
        }
        const releasable = releasableAmountAt({
            totalAmount: s.schedule.totalAmount,
            startTime: s.schedule.startTime,
            cliffDuration: s.schedule.cliffDuration,
            vestingDuration: s.schedule.vestingDuration,
            releasedAmount: s.schedule.releasedAmount,
            currentTime: t,
        });
        return releasable > 0n;
    });
    if (!hit) {
        return NA_BEFORE_CLIFF_OR_FULLY_CLAIMED;
    }
    return null;
}

export async function naWhenUnauthorizedClaim(ctx: ScenarioContext): Promise<string | null> {
    const no = naWhenNoVesting(ctx);
    if (no) {
        return no;
    }
    const sender = ctx.provider.sender().address;
    if (!sender) {
        return NA_SENDER_IS_BENEFICIARY;
    }
    const states = await loadAllVaultStates(ctx);
    const hit = states.find((s) => !s.schedule.beneficiary.equals(sender));
    if (!hit) {
        return NA_SENDER_IS_BENEFICIARY;
    }
    return null;
}

export async function naWhenEmergencyRevoke(ctx: ScenarioContext): Promise<string | null> {
    const shared = naWhenSharedDestructive(ctx);
    if (shared) {
        return shared;
    }
    const no = naWhenNoVesting(ctx);
    if (no) {
        return no;
    }
    // Gas underfund gate retired (IMP-TNFS-F03 relay). Stale lab tip without the
    // VestEmergencyRevoke relay will fail live checks — ops redeploy, not N/A here.
    const states = await loadAllVaultStates(ctx);
    const withRemaining = states.find((s) => s.schedule.totalAmount - s.schedule.releasedAmount > 0n);
    if (!withRemaining) {
        return NA_NOTHING_TO_REVOKE;
    }
    const sender = ctx.provider.sender().address;
    if (!sender) {
        return NA_CANNOT_ACT_AS_TIMELOCK_GOVERNOR;
    }
    const tl = ctx.provider.open(Timelock.fromAddress(withRemaining.schedule.timelock));
    const governor = await tl.getGetGovernor();
    if (!governor.equals(sender)) {
        return NA_CANNOT_ACT_AS_TIMELOCK_GOVERNOR;
    }
    return null;
}

export { readJettonWalletBalance };
