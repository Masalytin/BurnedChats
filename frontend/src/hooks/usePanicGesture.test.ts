// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFERENCES_STORAGE_KEY } from '@/preferences/preferencesStorage';
import { usePanicGesture } from './usePanicGesture';

const PANIC_DELAY_MS = 1500;

function dispatchPointer(
  target: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { clientX?: number; clientY?: number; pointerId?: number } = {},
) {
  const { clientX = 0, clientY = 0, pointerId = 1 } = init;
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId,
      clientX,
      clientY,
    }),
  );
}

describe('usePanicGesture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ hapticsEnabled: true }));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('calls onTrigger after ~1.5s long-press on target element', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const targetRef = { current: target };
    const onTrigger = vi.fn();

    renderHook(() =>
      usePanicGesture({
        targetRef,
        enabled: true,
        onTrigger,
      }),
    );

    act(() => {
      dispatchPointer(target, 'pointerdown', { clientX: 10, clientY: 10 });
    });
    expect(onTrigger).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(PANIC_DELAY_MS);
    });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    target.remove();
  });

  it('does not trigger on short tap (pointer up before delay)', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const targetRef = { current: target };
    const onTrigger = vi.fn();

    renderHook(() =>
      usePanicGesture({
        targetRef,
        enabled: true,
        onTrigger,
      }),
    );

    act(() => {
      dispatchPointer(target, 'pointerdown');
      dispatchPointer(target, 'pointerup');
      vi.advanceTimersByTime(PANIC_DELAY_MS);
    });
    expect(onTrigger).not.toHaveBeenCalled();

    target.remove();
  });

  it('cancels when pointer moves past 10px threshold', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const targetRef = { current: target };
    const onTrigger = vi.fn();

    renderHook(() =>
      usePanicGesture({
        targetRef,
        enabled: true,
        onTrigger,
      }),
    );

    act(() => {
      dispatchPointer(target, 'pointerdown', { clientX: 0, clientY: 0 });
      dispatchPointer(target, 'pointermove', { clientX: 20, clientY: 0 });
      vi.advanceTimersByTime(PANIC_DELAY_MS);
    });
    expect(onTrigger).not.toHaveBeenCalled();

    target.remove();
  });

  it('does not arm when enabled is false', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const targetRef = { current: target };
    const onTrigger = vi.fn();

    renderHook(() =>
      usePanicGesture({
        targetRef,
        enabled: false,
        onTrigger,
      }),
    );

    act(() => {
      dispatchPointer(target, 'pointerdown');
      vi.advanceTimersByTime(PANIC_DELAY_MS);
    });
    expect(onTrigger).not.toHaveBeenCalled();

    target.remove();
  });

  it('fires haptic escalation only when haptics preference is enabled', () => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ hapticsEnabled: false }));
    const impactOccurred = vi.fn();
    const notificationOccurred = vi.fn();
    vi.stubGlobal('Telegram', {
      WebApp: {
        initData: 'test',
        HapticFeedback: { impactOccurred, notificationOccurred },
      },
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const targetRef = { current: target };
    const onTrigger = vi.fn();

    renderHook(() =>
      usePanicGesture({
        targetRef,
        enabled: true,
        onTrigger,
      }),
    );

    act(() => {
      dispatchPointer(target, 'pointerdown');
      vi.advanceTimersByTime(PANIC_DELAY_MS);
    });

    expect(impactOccurred).not.toHaveBeenCalled();
    expect(notificationOccurred).not.toHaveBeenCalled();
    expect(onTrigger).toHaveBeenCalledTimes(1);

    target.remove();
    vi.unstubAllGlobals();
  });
});
