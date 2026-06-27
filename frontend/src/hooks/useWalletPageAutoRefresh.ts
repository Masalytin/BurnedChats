import { useEffect, useRef } from 'react';

export interface UseWalletPageAutoRefreshOptions {
  refresh: () => Promise<void>;
  enabled: boolean;
  debounceMs?: number;
  /** When true, auto-refresh will not start a parallel in-flight call. */
  isRefreshing?: boolean;
}

const DEFAULT_DEBOUNCE_MS = 2500;

/**
 * Debounced wallet page refresh on mount and when the document becomes visible again.
 * Skips when disabled (e.g. disconnected wallet) or while a refresh is already in flight.
 */
export function useWalletPageAutoRefresh(options: UseWalletPageAutoRefreshOptions): void {
  const {
    refresh,
    enabled,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    isRefreshing = false,
  } = options;

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const refreshRef = useRef(refresh);
  const enabledRef = useRef(enabled);
  const isRefreshingRef = useRef(isRefreshing);

  refreshRef.current = refresh;
  enabledRef.current = enabled;
  isRefreshingRef.current = isRefreshing;

  useEffect(() => {
    const clearTimer = (): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const runRefresh = async (): Promise<void> => {
      if (!enabledRef.current || isRefreshingRef.current || inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      try {
        await refreshRef.current();
      } finally {
        inFlightRef.current = false;
      }
    };

    const scheduleRefresh = (): void => {
      if (!enabledRef.current) {
        return;
      }
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void runRefresh();
      }, debounceMs);
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        clearTimer();
        return;
      }
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
      }
    };

    if (enabled) {
      scheduleRefresh();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, debounceMs]);
}
