// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useSwipeGesture } from '../useSwipeGesture';

function TestSwipe({ onSwipeRight }: { onSwipeRight: () => void }) {
  const swipe = useSwipeGesture({ onSwipeRight, threshold: 60, enabled: true });
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      data-testid="sw"
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
    />
  );
}

describe('useSwipeGesture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('invokes onSwipeRight after pointer moves right by threshold', () => {
    const fn = vi.fn();
    const { getByTestId } = render(<TestSwipe onSwipeRight={fn} />);
    const el = getByTestId('sw');
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 80, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 80, clientY: 0, button: 0, pointerId: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
