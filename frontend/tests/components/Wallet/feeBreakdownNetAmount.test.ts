import { describe, expect, it } from 'vitest';

import { grossFromNetRecipientAmount, splitBurnFees } from '@/components/Wallet/FeeBreakdown';
import { BURN_TRANSFER_FEE_BPS } from '@/types/ton';

const NANOS_PER_BURN = 10n ** 9n;

function burnUnits(units: number): bigint {
  return BigInt(units) * NANOS_PER_BURN;
}

describe('splitBurnFees — fixed 1% burn', () => {
  it('deducts 1% burn from gross amount', () => {
    const gross = burnUnits(100);
    const { burn, recipientGets } = splitBurnFees(gross);
    expect(burn).toBe(burnUnits(1));
    expect(recipientGets).toBe(burnUnits(99));
    expect(burn + recipientGets).toBe(gross);
  });

  it('burn truncates to zero below 100 nano', () => {
    const gross = 99n;
    const { burn, recipientGets } = splitBurnFees(gross);
    expect(burn).toBe(0n);
    expect(recipientGets).toBe(99n);
  });
});

describe('grossFromNetRecipientAmount', () => {
  it('computes gross so recipient gets at least the requested net', () => {
    const net = burnUnits(99);
    const gross = grossFromNetRecipientAmount(net);
    const { recipientGets } = splitBurnFees(gross);
    expect(recipientGets).toBeGreaterThanOrEqual(net);
    expect(splitBurnFees(gross - 1n).recipientGets).toBeLessThan(net);
  });

  it('round-trips common whole-token amounts', () => {
    for (const grossUnits of [1, 10, 100, 1000]) {
      const gross = burnUnits(grossUnits);
      const { recipientGets } = splitBurnFees(gross);
      const recomputedGross = grossFromNetRecipientAmount(recipientGets);
      expect(splitBurnFees(recomputedGross).recipientGets).toBe(recipientGets);
      expect(recomputedGross).toBeLessThanOrEqual(gross);
    }
  });

  it('returns zero for non-positive net', () => {
    expect(grossFromNetRecipientAmount(0n)).toBe(0n);
    expect(grossFromNetRecipientAmount(-1n)).toBe(0n);
  });

  it('uses hardcoded 1% fee bps constant', () => {
    expect(BURN_TRANSFER_FEE_BPS).toBe(100);
  });
});
