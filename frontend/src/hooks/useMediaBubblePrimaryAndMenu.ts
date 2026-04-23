import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

const PRIMARY_DELAY_MS = 280;
const DOUBLE_TAP_MAX_MS = 350;
const MOVE_THRESHOLD_PX = 10;

type Options = {
  /** `onOpenActionMenu` available */
  menuEnabled: boolean;
  isSelecting: boolean;
  onOpenMenu: () => void;
  runPrimary: () => void | Promise<void>;
};

/**
 * When the action menu is available and not in selection mode, defers the primary
 * bubble action slightly so a double-click / double-tap can open the menu instead.
 */
export function useMediaBubblePrimaryAndMenu({
  menuEnabled,
  isSelecting,
  onOpenMenu,
  runPrimary,
}: Options) {
  const timerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const lastTouchUpRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const moveThreshSq = MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX;

  const shouldDefer = menuEnabled && !isSelecting;

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearTimer();
    },
    [clearTimer],
  );

  const onInnerClick = useCallback(() => {
    if (isSelecting) {
      void runPrimary();
      return;
    }
    if (!shouldDefer) {
      void runPrimary();
      return;
    }
    clearTimer();
    timerRef.current = globalThis.setTimeout(() => {
      timerRef.current = null;
      void runPrimary();
    }, PRIMARY_DELAY_MS);
  }, [isSelecting, shouldDefer, clearTimer, runPrimary]);

  const onInnerDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!shouldDefer) return;
      e.preventDefault();
      e.stopPropagation();
      clearTimer();
      onOpenMenu();
    },
    [shouldDefer, clearTimer, onOpenMenu],
  );

  const onRootPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!shouldDefer || e.button !== 0) return;
      if (e.pointerType !== 'touch') return;
      const now = Date.now();
      const prev = lastTouchUpRef.current;
      const x = e.clientX;
      const y = e.clientY;
      if (prev) {
        const dt = now - prev.t;
        const dx = x - prev.x;
        const dy = y - prev.y;
        if (dt <= DOUBLE_TAP_MAX_MS && dx * dx + dy * dy <= moveThreshSq) {
          lastTouchUpRef.current = null;
          clearTimer();
          suppressClickRef.current = true;
          onOpenMenu();
          return;
        }
      }
      lastTouchUpRef.current = { t: now, x, y };
    },
    [shouldDefer, clearTimer, moveThreshSq, onOpenMenu],
  );

  const onRootClickCapture = useCallback((e: ReactMouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    onInnerClick,
    onInnerDoubleClick,
    onRootPointerUp,
    onRootClickCapture,
  };
}
