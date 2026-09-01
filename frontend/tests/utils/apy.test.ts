import { describe, expect, it } from 'vitest';

import { MIN_STAKE_NANO } from '@/ton/minStake';
import { StakingTier } from '@/types/ton';
import {
  calculateApyForInput,
  ILLUSTRATIVE_PRE_USER_NANO,
  MIN_MEANINGFUL_STAKE_NANO,
  phase1DailyEmissionNano,
  phase2DailyStakingPoolEmissionNano,
} from '@/utils/apy';

function nano(burn: number): bigint {
  return BigInt(Math.round(burn * 1e9));
}

describe('calculateApyForInput', () => {
  const daily = phase1DailyEmissionNano();

  it('matches TOKENOMICS indicative table (10 BURN deposit, illustrative pre-user TVL)', () => {
    const flex = calculateApyForInput(
      nano(10),
      StakingTier.Flexible,
      ILLUSTRATIVE_PRE_USER_NANO[StakingTier.Flexible],
      daily,
      5,
    );
    expect(flex).not.toBeNull();
    expect(flex!.apy).toBeGreaterThan(7.5);
    expect(flex!.apy).toBeLessThan(9);

    const silver = calculateApyForInput(
      nano(10),
      StakingTier.Silver,
      ILLUSTRATIVE_PRE_USER_NANO[StakingTier.Silver],
      daily,
      10,
    );
    expect(silver).not.toBeNull();
    expect(silver!.apy).toBeGreaterThan(12);
    expect(silver!.apy).toBeLessThan(14);

    const gold = calculateApyForInput(
      nano(10),
      StakingTier.Gold,
      ILLUSTRATIVE_PRE_USER_NANO[StakingTier.Gold],
      daily,
      25,
    );
    expect(gold).not.toBeNull();
    expect(gold!.apy).toBeGreaterThan(31);
    expect(gold!.apy).toBeLessThan(35);

    const di = calculateApyForInput(
      nano(10),
      StakingTier.Diamond,
      ILLUSTRATIVE_PRE_USER_NANO[StakingTier.Diamond],
      daily,
      60,
    );
    expect(di).not.toBeNull();
    expect(di!.apy).toBeGreaterThan(64);
    expect(di!.apy).toBeLessThan(70);
  });

  it('returns null for zero amount or zero emission', () => {
    expect(
      calculateApyForInput(0n, StakingTier.Gold, nano(50), daily, 25),
    ).toBeNull();
    expect(
      calculateApyForInput(nano(1), StakingTier.Gold, nano(50), 0n, 25),
    ).toBeNull();
  });

  it('enforces minimum meaningful stake threshold only at UI layer', () => {
    expect(MIN_MEANINGFUL_STAKE_NANO).toBe(10_000_000n);
    expect(MIN_MEANINGFUL_STAKE_NANO).toBe(MIN_STAKE_NANO);
    const tiny = calculateApyForInput(1_000_000n, StakingTier.Flexible, nano(50), daily, 5);
    expect(tiny).not.toBeNull();
  });
});

describe('resolvePreUserTierTotalNano', () => {
  it('uses live on-chain TVL and never substitutes illustrative TVL', async () => {
    const { resolvePreUserTierTotalNano, ILLUSTRATIVE_PRE_USER_NANO } = await import('@/utils/apy');
    const live = 12n * 1_000_000_000n;
    expect(resolvePreUserTierTotalNano(StakingTier.Gold, 1_000_000_000n, live)).toBe(live);
    expect(resolvePreUserTierTotalNano(StakingTier.Gold, 0n, null)).toBe(0n);
    expect(resolvePreUserTierTotalNano(StakingTier.Gold, 2_000_000_000n, null)).toBe(2_000_000_000n);
    expect(resolvePreUserTierTotalNano(StakingTier.Gold, 0n)).not.toBe(
      ILLUSTRATIVE_PRE_USER_NANO[StakingTier.Gold],
    );
  });
});

describe('phase2DailyStakingPoolEmissionNano', () => {
  it('orders Low < Medium < High', () => {
    const lo = phase2DailyStakingPoolEmissionNano('low');
    const mid = phase2DailyStakingPoolEmissionNano('medium');
    const hi = phase2DailyStakingPoolEmissionNano('high');
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
    expect(lo > 0n).toBe(true);
  });
});
