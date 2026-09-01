import { MIN_STAKE_NANO } from '@/ton/minStake';
import { PHASE1_DAILY_EMISSION_NANO } from '@/ton/staking';
import { StakingTier } from '@/types/ton';

const NANOS_PER_BURN = 1_000_000_000n;

/**
 * Illustrative TVL in tier excluding the user's 10 BURN deposit — matches
 * TOKENOMICS.md "Калькулятор индикативного APY" (60 / 75 / 75 / 90 BURN total tier).
 */
export const ILLUSTRATIVE_PRE_USER_NANO: Record<StakingTier, bigint> = {
  [StakingTier.Flexible]: 50n * NANOS_PER_BURN,
  [StakingTier.Silver]: 65n * NANOS_PER_BURN,
  [StakingTier.Gold]: 65n * NANOS_PER_BURN,
  [StakingTier.Diamond]: 80n * NANOS_PER_BURN,
};

export type NetworkActivityPreset = 'low' | 'medium' | 'high';

export interface ApyResult {
  apy: number;
  dailyReward: bigint;
  monthlyReward: bigint;
  yearlyReward: bigint;
  /** User stake / total tier stake after deposit (0–1). */
  shareOfTier: number;
}

/** Minimum stake for a meaningful APY line — same as `MIN_STAKE_NANO`. */
export const MIN_MEANINGFUL_STAKE_NANO = MIN_STAKE_NANO;

/** Daily nano-BURN directed to staking pool from tx fees only (Phase 2). Based on TOKENOMICS deflation table: avg tx 0.1 BURN, 0.3% to staking. */
export function phase2DailyStakingPoolEmissionNano(preset: NetworkActivityPreset): bigint {
  const txPerDay = preset === 'low' ? 100 : preset === 'medium' ? 500 : 2000;
  const dailyVolumeNano = BigInt(txPerDay) * NANOS_PER_BURN / 10n;
  return (dailyVolumeNano * 3n) / 1000n;
}

export function resolvePreUserTierTotalNano(
  _tier: StakingTier,
  existingUserStakeNano: bigint,
  liveTierTotalNano?: bigint | null,
): bigint {
  const existing = existingUserStakeNano < 0n ? 0n : existingUserStakeNano;
  if (liveTierTotalNano != null && liveTierTotalNano >= 0n) {
    return liveTierTotalNano > existing ? liveTierTotalNano : existing;
  }
  return existing;
}

/** @deprecated Illustrative TOKENOMICS table only — never treat as live TVL (IMP-STKUX-01). */
export function illustrativePreUserTierNano(tier: StakingTier): bigint {
  return ILLUSTRATIVE_PRE_USER_NANO[tier];
}

/**
 * Indicative APY from pool emission, tier reward share, and tier TVL after deposit.
 * `preUserTierTotalNano` = others in tier + user's existing stake before this deposit.
 */
export function calculateApyForInput(
  amount: bigint,
  tier: StakingTier,
  preUserTierTotalNano: bigint,
  dailyEmissionNano: bigint,
  rewardSharePercent: number,
): ApyResult | null {
  void tier;
  if (amount <= 0n || rewardSharePercent <= 0) {
    return null;
  }
  if (dailyEmissionNano <= 0n) {
    return null;
  }
  const denom = preUserTierTotalNano + amount;
  if (denom <= 0n) {
    return null;
  }
  const shareBi = BigInt(rewardSharePercent);
  const userDailyReward = (dailyEmissionNano * shareBi * amount) / (100n * denom);
  const yearlyReward = userDailyReward * 365n;
  const monthlyReward = yearlyReward / 12n;
  const stakeNum = Number(amount);
  const dailyNum = Number(userDailyReward);
  const apy = stakeNum > 0 && Number.isFinite(stakeNum) ? (dailyNum * 365 * 100) / stakeNum : 0;
  const shareOfTier =
    stakeNum > 0 && Number.isFinite(Number(denom)) ? Math.min(1, Math.max(0, stakeNum / Number(denom))) : 0;
  return {
    apy: Number.isFinite(apy) ? apy : 0,
    dailyReward: userDailyReward,
    monthlyReward,
    yearlyReward,
    shareOfTier,
  };
}

export function phase1DailyEmissionNano(): bigint {
  return PHASE1_DAILY_EMISSION_NANO;
}
