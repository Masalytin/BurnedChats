import { toNano } from '@ton/core';
import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import {
  BURN_NOTIFY_NANO,
  PER_INTERNAL_DEPLOY_NANO,
  PROPAGATE_FEE_CONFIG_NANO,
  estimateBurnTransferTon,
} from '@/ton/estimateBurnTransferTon';

/** Planned sender JW out_msgs from TX-5F37DA75 §3.2 (fee path, no user forward). */
const PLANNED_OUT_MSGS_NANO = toNano('1.76');

describe('IMP-JETTON-GAS-09 — TON breakdown legs', () => {
  it('cold fee path deploy + notify + propagate sums to ~1.76 TON planned out_msgs', () => {
    const { breakdown, recommendedNano } = estimateBurnTransferTon({ feePath: true });
    const coreLegs =
      breakdown.deployLegsNano + breakdown.burnNotifyNano + breakdown.propagateNano;

    expect(breakdown.deployLegsNano).toBe(3n * PER_INTERNAL_DEPLOY_NANO);
    expect(breakdown.burnNotifyNano).toBe(BURN_NOTIFY_NANO);
    expect(breakdown.propagateNano).toBe(PROPAGATE_FEE_CONFIG_NANO);
    expect(coreLegs).toBe(PLANNED_OUT_MSGS_NANO);
    expect(recommendedNano).toBeGreaterThan(coreLegs);
  });

  it('feeConfigActive sets propagate estimate to zero while attach row stays recommended', () => {
    const active = estimateBurnTransferTon({
      feePath: true,
      recipientWalletDeployed: true,
      recipientFeeConfigActive: true,
    });
    expect(active.breakdown.propagateNano).toBe(0n);
    expect(active.recommendedNano).toBeGreaterThan(0n);
  });

  it('en/ru i18n keys for TON breakdown legs exist', () => {
    expect(en.wallet.feeTonDeployLegs).toBeTruthy();
    expect(en.wallet.feeTonBurnNotify).toBeTruthy();
    expect(en.wallet.feeTonPropagate).toBeTruthy();
    expect(en.wallet.feeTonPropagateSkipped).toMatch(/recipient/i);
    expect(ru.wallet.feeTonPropagateSkipped).toContain('получатель');
    expect(en.wallet.feeTonDetails).toBeTruthy();
    expect(ru.wallet.feeTonDetails).toBeTruthy();
  });
});
