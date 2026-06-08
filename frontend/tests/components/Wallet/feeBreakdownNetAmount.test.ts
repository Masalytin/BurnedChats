import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WALLET_FEE_PARAMS,
  grossFromNetRecipientAmount,
  splitBurnFees,
} from '@/components/Wallet/FeeBreakdown';

const NANOS_PER_BURN = 10n ** 9n;

function burnUnits(units: number): bigint {
  return BigInt(units) * NANOS_PER_BURN;
}

describe('grossFromNetRecipientAmount', () => {
  it('returns net unchanged when total fee bps is zero', () => {
    const zeroFee = { burnBps: 0, stakingBps: 0, treasuryBps: 0 };
    const net = burnUnits(50);
    const gross = grossFromNetRecipientAmount(net, zeroFee);
    expect(gross).toBe(net);
    expect(splitBurnFees(gross, zeroFee).recipientGets).toBe(net);
  });

  it('computes gross so recipient gets at least the requested net (default 1% fee)', () => {
    const net = burnUnits(99);
    const gross = grossFromNetRecipientAmount(net, DEFAULT_WALLET_FEE_PARAMS);
    const { recipientGets } = splitBurnFees(gross, DEFAULT_WALLET_FEE_PARAMS);
    expect(recipientGets).toBeGreaterThanOrEqual(net);
    expect(splitBurnFees(gross - 1n, DEFAULT_WALLET_FEE_PARAMS).recipientGets).toBeLessThan(net);
  });

  it('round-trips common whole-token amounts (recipient net is exact)', () => {
    for (const grossUnits of [1, 10, 100, 1000]) {
      const gross = burnUnits(grossUnits);
      const { recipientGets } = splitBurnFees(gross, DEFAULT_WALLET_FEE_PARAMS);
      const recomputedGross = grossFromNetRecipientAmount(recipientGets, DEFAULT_WALLET_FEE_PARAMS);
      expect(splitBurnFees(recomputedGross, DEFAULT_WALLET_FEE_PARAMS).recipientGets).toBe(
        recipientGets,
      );
      expect(recomputedGross).toBeLessThanOrEqual(gross);
    }
  });

  it('returns zero for non-positive net', () => {
    expect(grossFromNetRecipientAmount(0n, DEFAULT_WALLET_FEE_PARAMS)).toBe(0n);
    expect(grossFromNetRecipientAmount(-1n, DEFAULT_WALLET_FEE_PARAMS)).toBe(0n);
  });
});
