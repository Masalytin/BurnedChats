import { Address } from '@ton/core';

/** Naive 30-day month (deploy scripts; exact schedule can be adjusted on mainnet). */
export const SECONDS_PER_MONTH = 30n * 24n * 3600n;

export const NANO_PER_BURN = 10n ** 9n;

export type VestingAllocationId = 'developer' | 'ecosystem' | 'reserve';

export type VestingAllocationPreset = {
    id: VestingAllocationId;
    /** Human-readable BURN amount (9 decimals on-chain). */
    totalBurn: bigint;
    cliffMonths: bigint;
    /** Total vesting period in months (linear starts after cliff). */
    vestingMonths: bigint;
};

/**
 * TOKENOMICS allocations (P5-3-3-1). The 300 BURN staking allocation is NOT a vesting
 * entry: it is minted directly to the StakingPool jetton wallet at bootstrap and the
 * 3-year linear schedule is enforced on-chain by StakingMaster tickEmission math
 * (IMP-MNAUD-F01 mint-to-pool, owner decision 2026-07-27).
 */
export const VESTING_PRESETS: Record<VestingAllocationId, VestingAllocationPreset> = {
    developer: { id: 'developer', totalBurn: 7n, cliffMonths: 0n, vestingMonths: 12n },
    ecosystem: { id: 'ecosystem', totalBurn: 150n, cliffMonths: 0n, vestingMonths: 24n },
    reserve: { id: 'reserve', totalBurn: 43n, cliffMonths: 36n, vestingMonths: 36n },
};

export function presetTotalNano(p: VestingAllocationPreset): bigint {
    return p.totalBurn * NANO_PER_BURN;
}

export function presetDurations(p: VestingAllocationPreset): { cliffSec: bigint; vestingSec: bigint } {
    const cliffSec = p.cliffMonths * SECONDS_PER_MONTH;
    const vestingSec = p.vestingMonths * SECONDS_PER_MONTH;
    return { cliffSec, vestingSec };
}

export function parseAllocationId(s: string): VestingAllocationId {
    const k = s.trim().toLowerCase().replace(/_/g, '-');
    if (k === 'staking-allocation' || k === 'staking allocation' || k === 'staking') {
        throw new Error(
            'The staking allocation is no longer vested: 300 BURN are minted directly to the ' +
                'StakingPool jetton wallet at bootstrap (IMP-MNAUD-F01 mint-to-pool).',
        );
    }
    const key = k as VestingAllocationId;
    if (key in VESTING_PRESETS) {
        return key;
    }
    throw new Error(`Unknown vesting allocation "${s}". Use: ${Object.keys(VESTING_PRESETS).join(', ')}`);
}

export function beneficiaryForPreset(_p: VestingAllocationId, env: NodeJS.ProcessEnv): Address {
    const b = env.BENEFICIARY;
    if (!b) {
        throw new Error('Set BENEFICIARY (friendly address) in .env');
    }
    return Address.parse(b);
}
