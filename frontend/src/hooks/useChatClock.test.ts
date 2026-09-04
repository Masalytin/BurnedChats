// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetChatClockForTests, useChatClock, useNow } from './useChatClock';

const NOW = new Date('2026-09-04T12:00:00.000Z').getTime();

function oneSecondIntervals(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter((call) => call[1] === 1000);
}

describe('useChatClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    resetChatClockForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts a single 1s scheduler for the first useNow(true)', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    renderHook(() => useNow(true));

    expect(oneSecondIntervals(intervalSpy)).toHaveLength(1);
  });

  it('does not create a second interval when another bubble calls useNow(true)', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    renderHook(() => useNow(true));
    renderHook(() => useNow(true));

    expect(oneSecondIntervals(intervalSpy)).toHaveLength(1);
  });

  it('does not start a scheduler when useNow(false)', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    renderHook(() => useNow(false));

    expect(oneSecondIntervals(intervalSpy)).toHaveLength(0);
  });

  it('exposes useNow from useChatClock without starting a tick', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    const { result } = renderHook(() => useChatClock());

    expect(typeof result.current.useNow).toBe('function');
    expect(typeof result.current.nowMs).toBe('number');
    expect(oneSecondIntervals(intervalSpy)).toHaveLength(0);
  });

  it('advances nowMs for subscribers when the shared tick fires', () => {
    const { result } = renderHook(() => useNow(true));

    expect(result.current).toBe(NOW);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(NOW + 1000);
  });
});
