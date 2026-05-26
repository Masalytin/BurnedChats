import { describe, expect, it } from 'vitest';

import {
  computeDaysRemaining,
  parseOpenSslEndDate,
} from '../../src/services/certbot.js';

describe('parseOpenSslEndDate', () => {
  it('parses openssl x509 -noout -enddate GMT output', () => {
    const output = 'notAfter=Aug 24 12:00:00 2026 GMT\n';
    const date = parseOpenSslEndDate(output);
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(7);
    expect(date.getUTCDate()).toBe(24);
  });

  it('throws on unparseable output', () => {
    expect(() => parseOpenSslEndDate('invalid')).toThrow(/Unable to parse certificate expiry/);
  });
});

describe('computeDaysRemaining', () => {
  it('computes whole days until expiry', () => {
    const notAfter = new Date('2026-06-10T12:00:00.000Z');
    const now = new Date('2026-05-26T12:00:00.000Z');
    expect(computeDaysRemaining(notAfter, now)).toBe(15);
  });

  it('returns negative days when expired', () => {
    const notAfter = new Date('2026-05-01T12:00:00.000Z');
    const now = new Date('2026-05-26T12:00:00.000Z');
    expect(computeDaysRemaining(notAfter, now)).toBeLessThan(0);
  });
});
