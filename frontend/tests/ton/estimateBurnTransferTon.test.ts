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

/** Canonical values from contracts/scripts/lib/estimateJettonTransferTon.ts */
const CONTRACTS_PARITY = {
  MIN_TON_FEE_PATH_NANO: toNano('2.1'),
  MIN_TON_EXCLUDED_PATH_NANO: toNano('0.65'),
  RECOMMENDED_FEE_PATH_NANO: toNano('3.5'),
  RECOMMENDED_FEE_PATH_WARM_NANO: toNano('2.3'),
  RECOMMENDED_EXCLUDED_PATH_NANO: toNano('0.7'),
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
    expect(estimate.recommendedNano).toBe(3_500_000_000n);
    expect(estimate.recommendedNano).toBe(BURN_TRANSFER_ATTACHED_TON);
  });

  it('fee path minimum exceeds 2.1 TON contract gate', () => {
    const estimate = estimateBurnTransferTon({ feePath: true });
    expect(estimate.minimumNano).toBeGreaterThan(2_100_000_000n);
  });

  it('excluded path recommended is at most 0.8 TON', () => {
    const estimate = estimateBurnTransferTon({ feePath: false });
    expect(estimate.recommendedNano).toBeLessThanOrEqual(800_000_000n);
  });

  it('warm fee path recommends 2.3 TON when recipient wallet deployed (GAS-06)', () => {
    const estimate = estimateBurnTransferTon({ feePath: true, recipientWalletDeployed: true });
    expect(estimate.recommendedNano).toBe(RECOMMENDED_FEE_PATH_WARM_NANO);
    expect(estimate.recommendedNano).toBeLessThan(RECOMMENDED_FEE_PATH_NANO);
  });
});
