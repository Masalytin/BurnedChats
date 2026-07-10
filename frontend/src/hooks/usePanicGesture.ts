import { useEffect, useRef, type RefObject } from 'react';
import WebApp from '@twa-dev/sdk';
import { areHapticsEnabled } from '@/preferences/preferencesStorage';

export const PANIC_LONG_PRESS_MS = 1500;
export const PANIC_MOVE_THRESHOLD_PX = 10;

export interface UsePanicGestureOptions {
  targetRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onTrigger: () => void;
}

function triggerImpact(style: 'light' | 'medium' | 'heavy') {
  if (!areHapticsEnabled()) {
    return;
  }
  try {
    WebApp.HapticFeedback.impactOccurred(style);
  } catch {
    // Haptics unavailable outside Telegram
  }
}

function triggerWarningNotification() {
  if (!areHapticsEnabled()) {
    return;
  }
  try {
    WebApp.HapticFeedback.notificationOccurred('warning');
  } catch {
    // Haptics unavailable outside Telegram
  }
}

/**
 * Long-press (~1.5s) detector on a DOM target with haptic escalation.
 * Cancels on movement past threshold so scroll/drag does not trigger panic burn.
 */
export function usePanicGesture({ targetRef, enabled, onTrigger }: UsePanicGestureOptions): void {
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  useEffect(() => {
    const target = targetRef.current;
    if (!target || !enabled) {
      return;
    }

    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let hapticTimers: ReturnType<typeof setTimeout>[] = [];
    let startX = 0;
    let startY = 0;
    let activePointerId = -1;
    let tracking = false;

    const clearPressTimer = () => {
      if (pressTimer != null) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    const clearHapticTimers = () => {
      for (const timer of hapticTimers) {
        clearTimeout(timer);
      }
      hapticTimers = [];
    };

    const stopTracking = () => {
      tracking = false;
      activePointerId = -1;
      clearPressTimer();
      clearHapticTimers();
    };

    const fireTrigger = () => {
      stopTracking();
      triggerWarningNotification();
      onTriggerRef.current();
    };

    const scheduleHapticEscalation = () => {
      clearHapticTimers();
      hapticTimers = [
        setTimeout(() => triggerImpact('light'), 400),
        setTimeout(() => triggerImpact('medium'), 900),
      ];
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      stopTracking();
      tracking = true;
      activePointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      scheduleHapticEscalation();
      pressTimer = setTimeout(fireTrigger, PANIC_LONG_PRESS_MS);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!tracking || event.pointerId !== activePointerId) {
        return;
      }

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (dx * dx + dy * dy > PANIC_MOVE_THRESHOLD_PX * PANIC_MOVE_THRESHOLD_PX) {
        stopTracking();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!tracking || event.pointerId !== activePointerId) {
        return;
      }
      stopTracking();
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (!tracking || event.pointerId !== activePointerId) {
        return;
      }
      stopTracking();
    };

    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerCancel);
    target.addEventListener('pointerleave', onPointerUp);

    return () => {
      stopTracking();
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerCancel);
      target.removeEventListener('pointerleave', onPointerUp);
    };
  }, [enabled, targetRef]);
}
