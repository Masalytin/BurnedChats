import { toNano } from '@ton/core';
import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import {
  BURN_NOTIFY_NANO,
  ESTIMATED_FORWARD_FEE_PER_HOP_NANO,
  GAS_POOL_FORWARD_EPSILON_NANO,
  GAS_POOL_FORWARD_MIN_NANO,
  GAS_POOL_TO_MASTER_ACCRUAL_NANO,
  GAS_TREASURY_FORWARD_MIN_NANO,
  MIN_TONS_FOR_STORAGE_NANO,
  PER_INTERNAL_DEPLOY_NANO,
  PROPAGATE_FEE_CONFIG_NANO,
  estimateBurnTransferTon,
} from '@/ton/estimateBurnTransferTon';
import { formatNativeCoin, NATIVE_COIN_SYMBOL } from '@/ton/nativeCoin';

/**
 * Planned sender JW core out_msgs after IMP-MNAUD-F17 W1: one recipient
 * deploy (0.55) + burn notify (0.06) + propagate (0.05); pool/treasury are
 * warm message() legs accounted in forwardNano.
 */
const PLANNED_OUT_MSGS_NANO = toNano('0.66');

describe('IMP-JETTON-GAS-09 — TON breakdown legs', () => {
  it('cold fee path deploy + notify + propagate sums to 0.66 TON planned out_msgs (F17 W1)', () => {
    const { breakdown, recommendedNano } = estimateBurnTransferTon({ feePath: true });
    const coreLegs =
      breakdown.deployLegsNano + breakdown.burnNotifyNano + breakdown.propagateNano;

    expect(breakdown.deployLegsNano).toBe(PER_INTERNAL_DEPLOY_NANO);
    expect(breakdown.burnNotifyNano).toBe(BURN_NOTIFY_NANO);
    expect(breakdown.propagateNano).toBe(PROPAGATE_FEE_CONFIG_NANO);
    expect(coreLegs).toBe(PLANNED_OUT_MSGS_NANO);
    expect(recommendedNano).toBeGreaterThan(coreLegs);
  });

  it('fee path forward includes warm pool and treasury deliver legs (scripts-lib parity, IMP-MNAUD-F24)', () => {
    const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
    const poolFwd = maxBig(
      GAS_POOL_FORWARD_MIN_NANO,
      GAS_POOL_TO_MASTER_ACCRUAL_NANO +
        ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
        MIN_TONS_FOR_STORAGE_NANO +
        GAS_POOL_FORWARD_EPSILON_NANO,
    );
    const poolDeliver =
      poolFwd + ESTIMATED_FORWARD_FEE_PER_HOP_NANO + MIN_TONS_FOR_STORAGE_NANO + toNano('0.02');
    const treasDeliver =
      GAS_TREASURY_FORWARD_MIN_NANO +
      ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
      MIN_TONS_FOR_STORAGE_NANO +
      toNano('0.02');
    const { breakdown } = estimateBurnTransferTon({ feePath: true });
    expect(breakdown.forwardNano).toBe(poolDeliver + treasDeliver);
    expect(treasDeliver).toBeGreaterThan(0n);
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

  it('formatNativeCoin labels breakdown leg amounts with display symbol', () => {
    const { breakdown } = estimateBurnTransferTon({ feePath: true });
    expect(formatNativeCoin(breakdown.burnNotifyNano)).toMatch(new RegExp(`\\d+(\\.\\d+)? ${NATIVE_COIN_SYMBOL}$`));
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
