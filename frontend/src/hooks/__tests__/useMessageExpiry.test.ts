// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecryptedMessage } from '@/types';
import { useMessageExpiry } from '../useMessageExpiry';

const NOW = new Date('2026-09-04T12:00:00.000Z').getTime();

function msg(overrides: Partial<DecryptedMessage> & { id: string }): DecryptedMessage {
  return {
    sessionId: 'sess-1',
    fromUserId: 1,
    content: 'hi',
    timestamp: NOW,
    status: 'delivered',
    isOwn: false,
    type: 'text',
    ...overrides,
  };
}

describe('useMessageExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides messages whose ttlAnchor + ttl <= now', () => {
    const messages = [
      msg({ id: 'alive', ttlAnchorMs: NOW - 2_000 }),
      msg({ id: 'dead', ttlAnchorMs: NOW - 10_000 }),
    ];

    const { result } = renderHook(() =>
      useMessageExpiry({ messages, messageTtlSeconds: 5 }),
    );

    expect(result.current.visibleMessages.map((m) => m.id)).toEqual(['alive']);
    expect(result.current.hideExpired).toEqual(['dead']);
  });

  it('is a no-op when ttl is 0 and does not resurrect already-listed messages', () => {
    const messages = [
      msg({ id: 'old', ttlAnchorMs: NOW - 86_400_000 }),
      msg({ id: 'new', ttlAnchorMs: NOW }),
    ];

    const { result } = renderHook(() =>
      useMessageExpiry({ messages, messageTtlSeconds: 0 }),
    );

    expect(result.current.visibleMessages.map((m) => m.id)).toEqual(['old', 'new']);
    expect(result.current.hideExpired).toEqual([]);
  });

  it('schedules setTimeout to the next deadline, not setInterval', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const messages = [
      msg({ id: 'soon', ttlAnchorMs: NOW - 4_000 }),
      msg({ id: 'later', ttlAnchorMs: NOW }),
    ];

    renderHook(() => useMessageExpiry({ messages, messageTtlSeconds: 5 }));

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalled();
    const delays = setTimeoutSpy.mock.calls
      .map(([, delay]) => delay)
      .filter((d): d is number => typeof d === 'number');
    expect(delays.some((d) => d === 1_000)).toBe(true);
  });

  it('hides the next message when the deadline timeout fires', () => {
    const messages = [msg({ id: 'soon', ttlAnchorMs: NOW - 4_000 })];

    const { result } = renderHook(() =>
      useMessageExpiry({ messages, messageTtlSeconds: 5 }),
    );

    expect(result.current.visibleMessages).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.visibleMessages).toHaveLength(0);
    expect(result.current.hideExpired).toEqual(['soon']);
  });
});
