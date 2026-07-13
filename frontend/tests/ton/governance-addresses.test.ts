/** @vitest-environment happy-dom */

import { Address } from '@ton/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCanonicalTreasuryAddress,
  isCanonicalTreasuryAddress,
} from '@/ton/governance-addresses';

function friendlyAddr(hexDigit: string): string {
  return Address.parse(`0:${hexDigit.repeat(64)}`).toString({
    bounceable: true,
    testOnly: true,
    urlSafe: true,
  });
}

describe('governance-addresses', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns configured treasury address', () => {
    const treasury = friendlyAddr('a');
    vi.stubEnv('VITE_TREASURY_ADDRESS', treasury);
    expect(getCanonicalTreasuryAddress()).toBe(treasury);
    expect(isCanonicalTreasuryAddress(treasury)).toBe(true);
  });

  it('treats bounceable/raw forms as equal', () => {
    const raw = Address.parse(`0:${'b'.repeat(64)}`);
    const friendly = raw.toString({ bounceable: true, testOnly: true, urlSafe: true });
    const nonFriendly = raw.toString({ bounceable: false, testOnly: true, urlSafe: true });
    vi.stubEnv('VITE_TREASURY_ADDRESS', friendly);
    expect(isCanonicalTreasuryAddress(nonFriendly)).toBe(true);
  });

  it('returns null when treasury env is unset', () => {
    vi.stubEnv('VITE_TREASURY_ADDRESS', '');
    expect(getCanonicalTreasuryAddress()).toBeNull();
  });
});
