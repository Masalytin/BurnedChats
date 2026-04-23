import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

const DEFAULT_DOUBLE_MS = 350;
const DEFAULT_MOVE_PX = 10;

type Options = {
  /** `menuEnabled && !isSelecting` */
  active: boolean;
  onOpenMenu: () => void;
  doubleTapMaxMs?: number;
  moveThresholdPx?: number;
};

/**
 * Desktop: double-click opens the message action menu.
 * Touch: two quick taps (pointer up) with little movement opens the same menu.
 */
export function useMessageRowDoubleOpenMenu({
  active,
  onOpenMenu,
  doubleTapMaxMs = DEFAULT_DOUBLE_MS,
  moveThresholdPx = DEFAULT_MOVE_PX,
}: Options) {
  const lastTouchUpRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const moveThreshSq = moveThresholdPx * moveThresholdPx;

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();
      onOpenMenu();
    },
    [active, onOpenMenu],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!active || e.button !== 0) return;
      if (e.pointerType !== 'touch') return;
      const now = Date.now();
      const prev = lastTouchUpRef.current;
      const x = e.clientX;
      const y = e.clientY;
      if (prev) {
        const dt = now - prev.t;
        const dx = x - prev.x;
        const dy = y - prev.y;
        if (dt <= doubleTapMaxMs && dx * dx + dy * dy <= moveThreshSq) {
          lastTouchUpRef.current = null;
          onOpenMenu();
          return;
        }
      }
      lastTouchUpRef.current = { t: now, x, y };
    },
    [active, doubleTapMaxMs, moveThreshSq, onOpenMenu],
  );

  return { onDoubleClick, onPointerUp };
}
