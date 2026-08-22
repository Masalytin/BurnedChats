import { toNano } from '@ton/core';
import { describe, expect, it } from 'vitest';

import {
  STAKE_ATTACHED_TON,
  STAKE_FEE_PATH_ATTACHED_TON,
  STAKE_FEE_PATH_RESTAKE_ATTACHED_TON,
  STAKE_FORWARD_TON,
  STAKE_NOTIFY_FORWARD_MIN_NANO,
  STAKE_RESTAKE_ATTACHED_TON,
  STAKE_RESTAKE_NOTIFY_FORWARD_NANO,
  computeStakePathBreakdown,
  estimateStakeTon,
} from '@/ton/estimateStakeTon';

describe('IMP-STKFEE-03 — estimateStakeTon path gas budget', () => {
  it('forward covers minStakeNotifyTon base (3.7 TON) with headroom', () => {
    expect(STAKE_FORWARD_TON).toBeGreaterThan(STAKE_NOTIFY_FORWARD_MIN_NANO);
    expect(STAKE_NOTIFY_FORWARD_MIN_NANO).toBe(toNano('3.7'));
    expect(STAKE_RESTAKE_NOTIFY_FORWARD_NANO).toBe(toNano('7.2'));
  });

  it('excluded attach clears the post-F11 gate and stays below fee-path attach', () => {
    expect(STAKE_ATTACHED_TON).toBe(7_500_540_001n);
    expect(STAKE_FEE_PATH_ATTACHED_TON).toBe(7_650_540_001n);
    expect(STAKE_FEE_PATH_ATTACHED_TON).toBeGreaterThan(STAKE_ATTACHED_TON);
  });

  it('default attach passes the on-chain wallet entry gate with live fwd-fee variance (IMP-MNAUD-F23)', () => {
    // burn-jetton-wallet.tact:748-752 — value > forward + 2*fwd + minTonFeePath(2.05);
    // live fwd observed up to ~0.004 TON (IMP-MNAUD-F20).
    const liveFwdFeeMax = toNano('0.004');
    const onChainGate = STAKE_FORWARD_TON + 2n * liveFwdFeeMax + toNano('2.05');
    expect(STAKE_ATTACHED_TON).toBeGreaterThan(onChainGate);
    expect(STAKE_RESTAKE_ATTACHED_TON).toBeGreaterThan(
      STAKE_RESTAKE_NOTIFY_FORWARD_NANO + 2n * liveFwdFeeMax + toNano('2.05'),
    );
  });

  it('at harness forward (8 TON) attach parity with F20 replica constants (10.6 ceiling)', () => {
    // Sandbox replica staking-live-stake-record.spec.ts imports the harness
    // constants from testnet-scenarios/lib/staking.ts: forward 8 / attach 10.6.
    const harnessForward = toNano('8');
    const liveFwdFeeMax = toNano('0.004');
    const b = computeStakePathBreakdown(harnessForward).excluded;
    expect(b.recommendedAttachNano).toBeGreaterThan(
      harnessForward + 2n * liveFwdFeeMax + toNano('2.05'),
    );
    expect(b.recommendedAttachNano).toBeLessThanOrEqual(toNano('10.6'));
  });

  it('default estimate uses excluded-path attach and documents both paths', () => {
    const estimate = estimateStakeTon();
    expect(estimate.feePath).toBe(false);
    expect(estimate.recommendedNano).toBe(STAKE_ATTACHED_TON);
    expect(estimate.forwardTonNano).toBe(STAKE_FORWARD_TON);
    expect(estimate.pathBreakdown.excluded.recommendedAttachNano).toBe(STAKE_ATTACHED_TON);
    expect(estimate.pathBreakdown.feePath.recommendedAttachNano).toBe(STAKE_FEE_PATH_ATTACHED_TON);
    expect(estimate.minimumNano).toBe(estimate.pathBreakdown.excluded.gateMinimumNano);
  });

  it('feePath estimate selects commission fanout attach', () => {
    const estimate = estimateStakeTon({ feePath: true });
    expect(estimate.feePath).toBe(true);
    expect(estimate.recommendedNano).toBe(STAKE_FEE_PATH_ATTACHED_TON);
    expect(estimate.minimumNano).toBe(estimate.pathBreakdown.feePath.gateMinimumNano);
  });

  it('restake with pending reward bumps forward and both path attaches', () => {
    const estimate = estimateStakeTon({
      hasExistingStakeInTier: true,
      hasPendingReward: true,
    });
    expect(estimate.forwardTonNano).toBe(STAKE_RESTAKE_NOTIFY_FORWARD_NANO);
    expect(estimate.recommendedNano).toBe(STAKE_RESTAKE_ATTACHED_TON);
    expect(STAKE_RESTAKE_ATTACHED_TON).toBe(9_700_540_001n);
    expect(STAKE_FEE_PATH_RESTAKE_ATTACHED_TON).toBe(9_850_540_001n);
  });

  it('restake fee path uses higher fanout attach', () => {
    const estimate = estimateStakeTon({
      hasExistingStakeInTier: true,
      hasPendingReward: true,
      feePath: true,
    });
    expect(estimate.recommendedNano).toBe(STAKE_FEE_PATH_RESTAKE_ATTACHED_TON);
    expect(estimate.recommendedNano).toBeGreaterThan(STAKE_RESTAKE_ATTACHED_TON);
  });

  it('existing stake without pending reward keeps default profile', () => {
    const estimate = estimateStakeTon({
      hasExistingStakeInTier: true,
      hasPendingReward: false,
    });
    expect(estimate.recommendedNano).toBe(STAKE_ATTACHED_TON);
    expect(estimate.forwardTonNano).toBe(STAKE_FORWARD_TON);
  });

  it('fee path internal out covers all fanout legs', () => {
    const b = computeStakePathBreakdown(STAKE_FORWARD_TON).feePath;
    const internalOut =
      b.netDeployNano +
      b.poolDeployNano +
      b.treasuryDeployNano +
      b.burnNotifyNano +
      b.propagateNano;
    expect(b.recommendedAttachNano).toBeGreaterThanOrEqual(internalOut);
    expect(b.recommendedAttachNano).toBeGreaterThanOrEqual(b.gateMinimumNano);
  });
});
