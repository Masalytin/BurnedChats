import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const DEFAULT_THRESHOLD = 60;

export interface UseSwipeGestureOptions {
  onSwipeRight: () => void;
  threshold?: number;
  /** When false, no pointer handling (e.g. selection mode). */
  enabled?: boolean;
}

/**
 * Right-swipe (pointer) with distance ≥ threshold. Uses pointer events (touch/mouse/pen).
 */
export function useSwipeGesture({
  onSwipeRight,
  threshold = DEFAULT_THRESHOLD,
  enabled = true,
}: UseSwipeGestureOptions) {
  const startRef = useRef<{ x: number; y: number; pointerId: number; active: boolean } | null>(null);
  const maxDxRef = useRef(0);
  const maxDyRef = useRef(0);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      startRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: true };
      maxDxRef.current = 0;
      maxDyRef.current = 0;
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled || !startRef.current?.active) return;
      if (e.pointerId !== startRef.current.pointerId) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (dx > maxDxRef.current) maxDxRef.current = dx;
      if (Math.abs(dy) > maxDyRef.current) maxDyRef.current = Math.abs(dy);
    },
    [enabled],
  );

  const end = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled || !startRef.current?.active) {
        startRef.current = null;
        return;
      }
      if (e.pointerId !== startRef.current.pointerId) {
        return;
      }
      startRef.current.active = false;
      const dx = maxDxRef.current;
      const dy = maxDyRef.current;
      startRef.current = null;
      if (dx >= threshold && dx > dy * 1.2) {
        onSwipeRight();
      }
    },
    [enabled, onSwipeRight, threshold],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      end(e);
    },
    [end],
  );

  const onPointerCancel = useCallback(() => {
    startRef.current = null;
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
