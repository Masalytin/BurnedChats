import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

type NativeUserEvent = globalThis.PointerEvent | globalThis.MouseEvent;

export interface UseLongPressOptions {
  onLongPress: (event: NativeUserEvent) => void;
  /** Short left-click (after pointer up) when a long-press was not fired. */
  onShortClick?: (event: ReactMouseEvent) => void;
  /** Default 400 ms */
  delay?: number;
  /** Default 10 px */
  moveThreshold?: number;
  /**
   * When `false`, pointer tracking and the long-press timer are not started
   * (e.g. no action menu in context).
   */
  enabled?: boolean;
}

export interface UseLongPressHandlers {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
  onPointerLeave: (e: ReactPointerEvent) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  /** Stops a synthetic `click` after a successful long-press (attach to the same node). */
  onClickCapture: (e: ReactMouseEvent) => void;
  onClick: (e: ReactMouseEvent) => void;
}

export interface UseLongPressResult {
  handlers: UseLongPressHandlers;
}

/**
 * Long-press (primary button / touch) and context-menu (right-click) trigger
 * `onLongPress`. Movement past `moveThreshold` or pointer leave/cancel aborts
 * the timer so scrolling does not open the menu.
 */
export function useLongPress({
  onLongPress,
  onShortClick,
  delay = 400,
  moveThreshold = 10,
  enabled = true,
}: UseLongPressOptions): UseLongPressResult {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef({ x: 0, y: 0, pointerId: -1, active: false });
  const movedTooFarRef = useRef(false);
  const suppressClickRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  const fireLongPress = useCallback(
    (event: NativeUserEvent) => {
      suppressClickRef.current = true;
      onLongPress(event);
    },
    [onLongPress],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      clearTimer();
      movedTooFarRef.current = false;
      suppressClickRef.current = false;
      startRef.current = {
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        active: true,
      };
      const native = e.nativeEvent;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        startRef.current.active = false;
        fireLongPress(native);
      }, delay);
    },
    [clearTimer, delay, enabled, fireLongPress],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled) return;
      if (!startRef.current.active || e.pointerId !== startRef.current.pointerId) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (dx * dx + dy * dy > moveThreshold * moveThreshold) {
        movedTooFarRef.current = true;
        clearTimer();
        startRef.current.active = false;
      }
    },
    [clearTimer, enabled, moveThreshold],
  );

  const endPressTracking = useCallback(() => {
    startRef.current.active = false;
    clearTimer();
  }, [clearTimer]);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      if (e.pointerId !== startRef.current.pointerId && startRef.current.pointerId !== -1) return;
      endPressTracking();
    },
    [enabled, endPressTracking],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled) return;
      if (e.pointerId !== startRef.current.pointerId && startRef.current.active) return;
      endPressTracking();
    },
    [enabled, endPressTracking],
  );

  const onPointerLeave = useCallback(() => {
    if (!enabled) return;
    if (!startRef.current.active) return;
    endPressTracking();
  }, [enabled, endPressTracking]);

  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!enabled) {
        return;
      }
      clearTimer();
      startRef.current.active = false;
      fireLongPress(e.nativeEvent);
    },
    [clearTimer, enabled, fireLongPress],
  );

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const handleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (suppressClickRef.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (movedTooFarRef.current) {
        return;
      }
      onShortClick?.(e);
    },
    [onShortClick],
  );

  const handlers: UseLongPressHandlers = {
    onPointerDown,
    onPointerUp,
    onPointerMove,
    onPointerCancel,
    onPointerLeave,
    onContextMenu,
    onClickCapture,
    onClick: handleClick,
  };

  return { handlers };
}
