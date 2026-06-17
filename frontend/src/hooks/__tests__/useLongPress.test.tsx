// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useLongPress } from '../useLongPress';

function makePointerDown(x: number, y: number, pointerId = 1): ReactPointerEvent {
  const ev = new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId }) as unknown as ReactPointerEvent;
  Object.defineProperty(ev, 'clientX', { value: x, configurable: true });
  Object.defineProperty(ev, 'clientY', { value: y, configurable: true });
  return ev;
}

function makePointerMove(x: number, y: number, pointerId = 1): ReactPointerEvent {
  const ev = new PointerEvent('pointermove', { bubbles: true, button: 0, pointerId }) as unknown as ReactPointerEvent;
  Object.defineProperty(ev, 'clientX', { value: x, configurable: true });
  Object.defineProperty(ev, 'clientY', { value: y, configurable: true });
  return ev;
}

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes onLongPress after delay', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useLongPress({
        onLongPress,
        delay: 400,
        moveThreshold: 10,
      }),
    );
    act(() => {
      result.current.handlers.onPointerDown(makePointerDown(10, 10));
    });
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('cancels when pointer moves past threshold', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useLongPress({ onLongPress, delay: 400, moveThreshold: 5 }),
    );
    act(() => {
      result.current.handlers.onPointerDown(makePointerDown(0, 0, 2));
      result.current.handlers.onPointerMove(makePointerMove(20, 0, 2));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not arm timer when enabled is false', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, enabled: false, delay: 100 }));
    act(() => {
      result.current.handlers.onPointerDown(makePointerDown(0, 0, 3));
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
