import { toNano } from '@ton/core';
import { describe, expect, it } from 'vitest';
import { BURN_TRANSFER_ATTACHED_TON } from '@/ton/transactionBuilder';
import {
  BURN_NOTIFY_NANO,
  MIN_TON_EXCLUDED_PATH_NANO,
  MIN_TON_FEE_PATH_NANO,
  PER_INTERNAL_DEPLOY_NANO,
  PROPAGATE_FEE_CONFIG_NANO,
  RECOMMENDED_EXCLUDED_PATH_NANO,
  RECOMMENDED_FEE_PATH_NANO,
  RECOMMENDED_FEE_PATH_WARM_NANO,
  estimateBurnTransferTon,
} from '@/ton/estimateBurnTransferTon';

/** Canonical values from contracts/scripts/lib/estimateJettonTransferTon.ts (post-F17 W1). */
const CONTRACTS_PARITY = {
  MIN_TON_FEE_PATH_NANO: toNano('1.0'),
  MIN_TON_EXCLUDED_PATH_NANO: toNano('0.58'),
  RECOMMENDED_FEE_PATH_NANO: toNano('1.5'),
  RECOMMENDED_FEE_PATH_WARM_NANO: toNano('1.2'),
  RECOMMENDED_EXCLUDED_PATH_NANO: toNano('1.2'),
  PER_INTERNAL_DEPLOY_NANO: toNano('0.55'),
  BURN_NOTIFY_NANO: toNano('0.06'),
  PROPAGATE_FEE_CONFIG_NANO: toNano('0.05'),
} as const;

describe('IMP-JETTON-GAS-04 — estimateBurnTransferTon', () => {
  it('constants match contracts estimate module', () => {
    expect(MIN_TON_FEE_PATH_NANO).toBe(CONTRACTS_PARITY.MIN_TON_FEE_PATH_NANO);
    expect(MIN_TON_EXCLUDED_PATH_NANO).toBe(CONTRACTS_PARITY.MIN_TON_EXCLUDED_PATH_NANO);
    expect(RECOMMENDED_FEE_PATH_NANO).toBe(CONTRACTS_PARITY.RECOMMENDED_FEE_PATH_NANO);
    expect(RECOMMENDED_FEE_PATH_WARM_NANO).toBe(CONTRACTS_PARITY.RECOMMENDED_FEE_PATH_WARM_NANO);
    expect(RECOMMENDED_EXCLUDED_PATH_NANO).toBe(CONTRACTS_PARITY.RECOMMENDED_EXCLUDED_PATH_NANO);
    expect(PER_INTERNAL_DEPLOY_NANO).toBe(CONTRACTS_PARITY.PER_INTERNAL_DEPLOY_NANO);
    expect(BURN_NOTIFY_NANO).toBe(CONTRACTS_PARITY.BURN_NOTIFY_NANO);
    expect(PROPAGATE_FEE_CONFIG_NANO).toBe(CONTRACTS_PARITY.PROPAGATE_FEE_CONFIG_NANO);
  });

  it('fee path recommended aligns with BURN_TRANSFER_ATTACHED_TON', () => {
    const estimate = estimateBurnTransferTon({ feePath: true });
    expect(estimate.recommendedNano).toBe(1_500_000_000n);
    expect(estimate.recommendedNano).toBe(BURN_TRANSFER_ATTACHED_TON);
  });

  it('fee path minimum is strictly greater than the 1.0 TON contract gate (F17 W1)', () => {
    const estimate = estimateBurnTransferTon({ feePath: true });
    expect(estimate.minimumNano).toBeGreaterThan(1_000_000_000n);
    expect(estimate.minimumNano).toBeGreaterThan(MIN_TON_FEE_PATH_NANO);
  });

  it('excluded path uses the post-F11 uniform entry gate and 1.2 TON recommended', () => {
    const excluded = estimateBurnTransferTon({ feePath: false });
    const fee = estimateBurnTransferTon({ feePath: true });
    expect(excluded.minimumNano).toBe(fee.minimumNano);
    expect(excluded.minimumNano).toBeGreaterThan(MIN_TON_FEE_PATH_NANO);
    expect(excluded.recommendedNano).toBe(RECOMMENDED_EXCLUDED_PATH_NANO);
    expect(excluded.recommendedNano).toBe(1_200_000_000n);
    expect(excluded.recommendedNano).toBeGreaterThan(excluded.minimumNano);
  });

  it('warm fee path recommends 1.2 TON when recipient wallet deployed (GAS-06)', () => {
    const estimate = estimateBurnTransferTon({ feePath: true, recipientWalletDeployed: true });
    expect(estimate.recommendedNano).toBe(RECOMMENDED_FEE_PATH_WARM_NANO);
    expect(estimate.recommendedNano).toBeLessThan(RECOMMENDED_FEE_PATH_NANO);
  });
});
