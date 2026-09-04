import { describe, expect, it } from 'vitest';
import { validateDurationSeconds } from './duration';
import {
  clampAfterSnap,
  partsToSeconds,
  secondsToParts,
} from './durationColumns';

const MESSAGE_TTL_MAX = 86_400;
const ROOM_LIFETIME_MAX = 30 * 86_400;

describe('partsToSeconds (hms)', () => {
  it('maps 0h 0m 30s to 30', () => {
    expect(partsToSeconds('hms', [0, 0, 30])).toBe(30);
  });

  it('maps 1h 0m 0s to 3600', () => {
    expect(partsToSeconds('hms', [1, 0, 0])).toBe(3_600);
  });

  it('maps 24h 0m 0s to 86400', () => {
    expect(partsToSeconds('hms', [24, 0, 0])).toBe(86_400);
  });

  it('maps 0h 0m 0s to numeric 0', () => {
    expect(partsToSeconds('hms', [0, 0, 0])).toBe(0);
  });
});

describe('partsToSeconds (dhm)', () => {
  it('maps 0d 0h 5m to 300', () => {
    expect(partsToSeconds('dhm', [0, 0, 5])).toBe(300);
  });

  it('maps 30d 0h 0m to 30 days in seconds', () => {
    expect(partsToSeconds('dhm', [30, 0, 0])).toBe(ROOM_LIFETIME_MAX);
  });

  it('maps 0d 0h 0m to numeric 0', () => {
    expect(partsToSeconds('dhm', [0, 0, 0])).toBe(0);
  });
});

describe('secondsToParts', () => {
  it('round-trips HMS 30s, 1h, 24h, and 0', () => {
    expect(secondsToParts('hms', 30)).toEqual([0, 0, 30]);
    expect(secondsToParts('hms', 3_600)).toEqual([1, 0, 0]);
    expect(secondsToParts('hms', 86_400)).toEqual([24, 0, 0]);
    expect(secondsToParts('hms', 0)).toEqual([0, 0, 0]);
  });

  it('round-trips DHM 5m and 30d', () => {
    expect(secondsToParts('dhm', 300)).toEqual([0, 0, 5]);
    expect(secondsToParts('dhm', ROOM_LIFETIME_MAX)).toEqual([30, 0, 0]);
  });
});

describe('clampAfterSnap', () => {
  it('clamps HMS 24h 0m 1s down to 86400', () => {
    expect(clampAfterSnap('hms', [24, 0, 1], MESSAGE_TTL_MAX)).toEqual([24, 0, 0]);
    expect(partsToSeconds('hms', clampAfterSnap('hms', [24, 0, 1], MESSAGE_TTL_MAX))).toBe(
      MESSAGE_TTL_MAX
    );
  });

  it('does not let HMS exceed 24h after snap', () => {
    const clamped = clampAfterSnap('hms', [24, 5, 0], MESSAGE_TTL_MAX);
    expect(partsToSeconds('hms', clamped)).toBeLessThanOrEqual(MESSAGE_TTL_MAX);
    expect(clamped).toEqual([24, 0, 0]);
  });

  it('does not let DHM exceed 30d after snap', () => {
    const clamped = clampAfterSnap('dhm', [30, 0, 1], ROOM_LIFETIME_MAX);
    expect(partsToSeconds('dhm', clamped)).toBeLessThanOrEqual(ROOM_LIFETIME_MAX);
    expect(clamped).toEqual([30, 0, 0]);
  });

  it('leaves a below-min HMS draft unchanged so the parent can treat it as invalid', () => {
    expect(clampAfterSnap('hms', [0, 0, 0], MESSAGE_TTL_MAX)).toEqual([0, 0, 0]);
    expect(clampAfterSnap('hms', [0, 0, 29], MESSAGE_TTL_MAX)).toEqual([0, 0, 29]);
  });
});

describe('validateDurationSeconds (parent helper, unchanged)', () => {
  it('treats 0 as below-min for message TTL, not as a special Off token', () => {
    expect(validateDurationSeconds(0, { min: 30, max: MESSAGE_TTL_MAX })).toBe('below-min');
    expect(validateDurationSeconds(29, { min: 30, max: MESSAGE_TTL_MAX })).toBe('below-min');
    expect(validateDurationSeconds(30, { min: 30, max: MESSAGE_TTL_MAX })).toBe('ok');
  });
});
