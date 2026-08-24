import { describe, expect, it } from 'vitest';
import { resolveExpiredAbsenceCount } from '../expiredAbsenceCount';

describe('resolveExpiredAbsenceCount', () => {
  it('prefers server expired/trimmed counts over decrypt failures', () => {
    expect(
      resolveExpiredAbsenceCount({ failedCount: 4, expiredCount: 2, trimmedCount: 1 }),
    ).toBe(3);
  });

  it('falls back to failedCount when the server sends no expire fields', () => {
    expect(resolveExpiredAbsenceCount({ failedCount: 5 })).toBe(5);
    expect(resolveExpiredAbsenceCount({})).toBe(0);
  });

  it('returns only a number — callers must not pass plaintext', () => {
    const n = resolveExpiredAbsenceCount({ failedCount: 2, expiredCount: 0 });
    expect(typeof n).toBe('number');
    expect(String(n)).toBe('2');
  });
});
