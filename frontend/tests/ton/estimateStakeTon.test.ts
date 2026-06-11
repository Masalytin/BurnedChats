import { toNano } from '@ton/core';
import { describe, expect, it } from 'vitest';

import {
  STAKE_RESTAKE_ATTACHED_TON,
  STAKE_RESTAKE_NOTIFY_FORWARD_NANO,
  estimateStakeTon,
} from '@/ton/estimateStakeTon';
import { STAKE_ATTACHED_TON, STAKE_FORWARD_TON } from '@/ton/transactionBuilder';

describe('IMP-STAKE-GAS-02 — estimateStakeTon', () => {
  it('constants match transactionBuilder stake profile', () => {
    expect(STAKE_FORWARD_TON).toBe(toNano('5'));
    expect(STAKE_ATTACHED_TON).toBe(toNano('7.6'));
  });

  it('default estimate uses builder attach and forward', () => {
    const estimate = estimateStakeTon();
    expect(estimate.minimumNano).toBe(STAKE_ATTACHED_TON);
    expect(estimate.recommendedNano).toBe(STAKE_ATTACHED_TON);
    expect(estimate.recommendedNano).toBeGreaterThanOrEqual(toNano('7.6'));
    expect(estimate.forwardTonNano).toBe(STAKE_FORWARD_TON);
    expect(estimate.estimatedNetFeeMinNano).toBeGreaterThan(0n);
    expect(estimate.estimatedNetFeeMaxNano).toBeGreaterThanOrEqual(estimate.estimatedNetFeeMinNano);
  });

  it('restake with pending reward bumps recommended attach', () => {
    const estimate = estimateStakeTon({
      hasExistingStakeInTier: true,
      hasPendingReward: true,
    });
    expect(estimate.recommendedNano).toBe(STAKE_RESTAKE_ATTACHED_TON);
    expect(estimate.recommendedNano).toBeGreaterThan(STAKE_ATTACHED_TON);
    expect(estimate.forwardTonNano).toBe(STAKE_RESTAKE_NOTIFY_FORWARD_NANO);
    expect(estimate.minimumNano).toBe(STAKE_ATTACHED_TON);
  });

  it('existing stake without pending reward keeps default profile', () => {
    const estimate = estimateStakeTon({
      hasExistingStakeInTier: true,
      hasPendingReward: false,
    });
    expect(estimate.recommendedNano).toBe(STAKE_ATTACHED_TON);
    expect(estimate.forwardTonNano).toBe(STAKE_FORWARD_TON);
  });
});
