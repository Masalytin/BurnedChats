import { toNano } from '@ton/core';
import { describe, expect, it } from 'vitest';
import { BURN_TRANSFER_ATTACHED_TON } from '@/ton/transactionBuilder';
import {
  BURN_NOTIFY_NANO,
  MIN_DUST_TRANSFER_ATTACH_NANO,
  MIN_TON_BURN_PATH_NANO,
  PER_INTERNAL_DEPLOY_NANO,
  RECOMMENDED_BURN_PATH_NANO,
  TRANSFER_HEADROOM_NANO,
  estimateBurnTransferTon,
} from '@/ton/estimateBurnTransferTon';

/** Canonical values from contracts/scripts/lib/estimateJettonTransferTon.ts */
const CONTRACTS_PARITY = {
  PER_INTERNAL_DEPLOY_NANO: toNano('0.55'),
  BURN_NOTIFY_NANO: toNano('0.06'),
  TRANSFER_HEADROOM_NANO: toNano('0.05'),
  MIN_TON_BURN_PATH_NANO: toNano('0.66'),
  MIN_DUST_TRANSFER_ATTACH_NANO: toNano('0.6'),
  RECOMMENDED_BURN_PATH_NANO: toNano('0.8'),
} as const;

describe('IMP-TOKSIM-06 — estimateBurnTransferTon parity', () => {
  it('constants match contracts estimate module', () => {
    expect(PER_INTERNAL_DEPLOY_NANO).toBe(CONTRACTS_PARITY.PER_INTERNAL_DEPLOY_NANO);
    expect(BURN_NOTIFY_NANO).toBe(CONTRACTS_PARITY.BURN_NOTIFY_NANO);
    expect(TRANSFER_HEADROOM_NANO).toBe(CONTRACTS_PARITY.TRANSFER_HEADROOM_NANO);
    expect(MIN_TON_BURN_PATH_NANO).toBe(CONTRACTS_PARITY.MIN_TON_BURN_PATH_NANO);
    expect(MIN_DUST_TRANSFER_ATTACH_NANO).toBe(CONTRACTS_PARITY.MIN_DUST_TRANSFER_ATTACH_NANO);
    expect(RECOMMENDED_BURN_PATH_NANO).toBe(CONTRACTS_PARITY.RECOMMENDED_BURN_PATH_NANO);
  });

  it('recommended aligns with BURN_TRANSFER_ATTACHED_TON', () => {
    const estimate = estimateBurnTransferTon();
    expect(estimate.recommendedNano).toBe(800_000_000n);
    expect(estimate.recommendedNano).toBe(BURN_TRANSFER_ATTACHED_TON);
  });

  it('minimum exceeds strict gate (0.66 TON + 1 nano)', () => {
    const estimate = estimateBurnTransferTon();
    expect(estimate.minimumNano).toBeGreaterThan(660_000_000n);
  });

  it('dust path minimum uses 0.6 TON anchor when burn is zero', () => {
    const estimate = estimateBurnTransferTon({ amountNano: 50n });
    expect(estimate.breakdown.burnNotifyNano).toBe(0n);
    expect(estimate.minimumNano).toBeGreaterThan(600_000_000n);
  });
});
