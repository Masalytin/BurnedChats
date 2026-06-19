import { describe, it, expect } from 'vitest';
import { isWithinEditWindow, isWithinEditWindowForUi } from '../editWindow';

describe('isWithinEditWindow', () => {
  it('returns true at exactly 15m boundary', () => {
    const t = 1_000_000;
    const now = t + 15 * 60 * 1000;
    expect(isWithinEditWindow(t, now)).toBe(true);
  });

  it('returns false just after 15m', () => {
    const t = 1_000_000;
    const now = t + 15 * 60 * 1000 + 1;
    expect(isWithinEditWindow(t, now)).toBe(false);
  });

  it('returns false for invalid timestamp', () => {
    expect(isWithinEditWindow(-1, 0)).toBe(false);
  });
});

describe('isWithinEditWindowForUi', () => {
  it('allows edit UI hint within grace beyond strict window', () => {
    const t = 1_000_000;
    const now = t + 15 * 60 * 1000 + 30 * 60 * 1000;
    expect(isWithinEditWindow(t, now)).toBe(false);
    expect(isWithinEditWindowForUi(t, now)).toBe(true);
  });
});
