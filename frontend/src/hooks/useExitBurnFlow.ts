import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { BurnAllErrorCode, BurnAllState } from '@/hooks/useBurnAll';

export const EXIT_BURN_ACK_TIMEOUT_MS = 10_000;

export type ExitBurnError = BurnAllErrorCode | 'TIMEOUT';

interface UseExitBurnFlowOptions {
  burnAllState: BurnAllState;
  burnAllError: BurnAllErrorCode | null;
  requestBurnAll: (request: { wipeIdentity: boolean }) => void;
  resetBurnAll: () => void;
  exitBurnPendingRef: MutableRefObject<boolean>;
}

interface UseExitBurnFlowReturn {
  isBurning: boolean;
  error: ExitBurnError | null;
  startBurnAndExit: () => void;
  retryBurnAndExit: () => void;
  resetExitBurn: () => void;
}

export function useExitBurnFlow(options: UseExitBurnFlowOptions): UseExitBurnFlowReturn {
  const { burnAllState, burnAllError, requestBurnAll, resetBurnAll, exitBurnPendingRef } = options;

  const [exitBurnActive, setExitBurnActive] = useState(false);
  const [error, setError] = useState<ExitBurnError | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const resetExitBurn = useCallback(() => {
    clearTimeoutRef();
    exitBurnPendingRef.current = false;
    setExitBurnActive(false);
    setError(null);
    resetBurnAll();
  }, [clearTimeoutRef, exitBurnPendingRef, resetBurnAll]);

  const startBurnAndExit = useCallback(() => {
    if (exitBurnActive && burnAllState === 'burning') {
      return;
    }

    clearTimeoutRef();
    exitBurnPendingRef.current = true;
    setExitBurnActive(true);
    setError(null);
    resetBurnAll();
    requestBurnAll({ wipeIdentity: false });

    timeoutRef.current = setTimeout(() => {
      if (!exitBurnPendingRef.current) {
        return;
      }
      exitBurnPendingRef.current = false;
      setExitBurnActive(false);
      setError('TIMEOUT');
      resetBurnAll();
    }, EXIT_BURN_ACK_TIMEOUT_MS);
  }, [burnAllState, clearTimeoutRef, exitBurnActive, exitBurnPendingRef, requestBurnAll, resetBurnAll]);

  const retryBurnAndExit = useCallback(() => {
    resetExitBurn();
    startBurnAndExit();
  }, [resetExitBurn, startBurnAndExit]);

  useEffect(() => {
    if (!exitBurnActive) {
      return;
    }

    if (burnAllState === 'done') {
      clearTimeoutRef();
      setExitBurnActive(false);
      setError(null);
      return;
    }

    if (burnAllState === 'error' && burnAllError) {
      clearTimeoutRef();
      exitBurnPendingRef.current = false;
      setError(burnAllError);
      setExitBurnActive(false);
    }
  }, [burnAllError, burnAllState, clearTimeoutRef, exitBurnActive, exitBurnPendingRef]);

  useEffect(() => () => clearTimeoutRef(), [clearTimeoutRef]);

  return {
    isBurning: exitBurnActive && burnAllState === 'burning',
    error,
    startBurnAndExit,
    retryBurnAndExit,
    resetExitBurn,
  };
}
