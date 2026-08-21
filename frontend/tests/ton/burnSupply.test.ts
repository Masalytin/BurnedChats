import { describe, expect, it } from 'vitest';

import {
  BURN_MAX_SUPPLY_NANO,
  parseJettonDataStack,
} from '@/ton/burnSupply';

const NANO = 10n ** 9n;
const BURN_990 = 990n * NANO;
const CELL = 'te6cckEBAQEAAgAAAA==';

function tep74Stack(totalSupplyHex: string, mintableHex: string): unknown {
  return [
    ['num', totalSupplyHex],
    ['num', mintableHex],
    ['cell', CELL],
    ['cell', CELL],
    ['cell', CELL],
  ];
}

describe('BURN_MAX_SUPPLY_NANO', () => {
  it('is 1000 BURN in nano units', () => {
    expect(BURN_MAX_SUPPLY_NANO).toBe(1000n * 10n ** 9n);
  });
});

describe('parseJettonDataStack', () => {
  it('treats TEP-74 mintable -0x1 as mint-open (burned hidden)', () => {
    const supply = parseJettonDataStack(tep74Stack('0x3b9aca00', '-0x1'));
    expect(supply).toEqual({
      circulating: 1_000_000_000n,
      mintable: true,
      burned: null,
    });
  });

  it('computes burned as MAX − totalSupply when mintable is 0', () => {
    const supply = parseJettonDataStack(tep74Stack(`0x${BURN_990.toString(16)}`, '0x0'));
    expect(supply.circulating).toBe(BURN_990);
    expect(supply.mintable).toBe(false);
    expect(supply.burned).toBe(10n * NANO);
  });

  it('returns burned 0 when mint is closed and supply equals MAX', () => {
    const supply = parseJettonDataStack(
      tep74Stack(`0x${BURN_MAX_SUPPLY_NANO.toString(16)}`, '0x0'),
    );
    expect(supply.circulating).toBe(BURN_MAX_SUPPLY_NANO);
    expect(supply.mintable).toBe(false);
    expect(supply.burned).toBe(0n);
  });

  it('clamps burned to 0 when mint is closed and supply exceeds MAX', () => {
    const over = BURN_MAX_SUPPLY_NANO + NANO;
    const supply = parseJettonDataStack(tep74Stack(`0x${over.toString(16)}`, '0x0'));
    expect(supply.circulating).toBe(over);
    expect(supply.mintable).toBe(false);
    expect(supply.burned).toBe(0n);
  });

  it('throws when the stack has fewer than 5 TEP-74 slots', () => {
    expect(() => parseJettonDataStack([['num', '0x1'], ['num', '0x0']])).toThrow(
      /stack too small/i,
    );
  });
});
