import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTtlExpired, ttlAnchorMs } from './ttlAnchor';

describe('ttlAnchorMs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses serverTimestamp and ignores a future clientTimestamp', () => {
    const server = '2026-09-04T12:00:00.000Z';
    const futureClient = Date.now() + 60 * 60 * 1000;

    expect(ttlAnchorMs(server, futureClient)).toBe(new Date(server).getTime());
  });

  it('falls back to clientTimestamp when serverTimestamp is missing', () => {
    expect(ttlAnchorMs(undefined, 1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('uses Date.now() only when both timestamps are missing (optimistic send)', () => {
    expect(ttlAnchorMs()).toBe(Date.now());
    expect(ttlAnchorMs(undefined, undefined)).toBe(Date.now());
  });

  it('ignores an invalid serverTimestamp and falls back to client', () => {
    expect(ttlAnchorMs('not-a-date', 42)).toBe(42);
  });
});

describe('isTtlExpired', () => {
  it('is false when ttl is 0 (off)', () => {
    expect(isTtlExpired(0, 0, 10_000)).toBe(false);
    expect(isTtlExpired(5_000, 0, 10_000)).toBe(false);
  });

  it('is true when ttlAnchor + ttl <= now', () => {
    expect(isTtlExpired(1_000, 5, 6_000)).toBe(true);
    expect(isTtlExpired(1_000, 5, 5_999)).toBe(false);
  });
});
