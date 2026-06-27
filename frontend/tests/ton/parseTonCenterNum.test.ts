import { describe, expect, it } from 'vitest';

import { parseTonCenterNum } from '@/ton/parseTonCenterNum';

describe('parseTonCenterNum', () => {
  it('parses Ton Center signed hex -0x1 as -1n', () => {
    expect(parseTonCenterNum('-0x1')).toBe(-1n);
  });

  it('parses unsigned 64-bit -1 as 18446744073709551615n', () => {
    expect(parseTonCenterNum('0xffffffffffffffff')).toBe(18446744073709551615n);
  });

  it('parses zero', () => {
    expect(parseTonCenterNum('0x0')).toBe(0n);
  });

  it('parses positive hex with 0x prefix', () => {
    expect(parseTonCenterNum('0x32')).toBe(50n);
  });

  it('parses bare hex without prefix', () => {
    expect(parseTonCenterNum('32')).toBe(50n);
  });

  it('parses decimal negative without hex prefix', () => {
    expect(parseTonCenterNum('-123')).toBe(-123n);
  });

  it('trims whitespace', () => {
    expect(parseTonCenterNum('  -0x1  ')).toBe(-1n);
  });

  it('does not throw on signed hex (regression for 0x-0x1 bug)', () => {
    expect(() => parseTonCenterNum('-0x1')).not.toThrow();
  });
});
