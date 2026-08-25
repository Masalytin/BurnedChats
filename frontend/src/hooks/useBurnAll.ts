import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';

export type BurnAllState = 'idle' | 'burning' | 'done' | 'error';

export type BurnAllErrorCode = 'NOT_CONNECTED' | 'INTERNAL_ERROR';

export interface BurnAllCompleteEvent {
  wipeIdentity: boolean;
  burnedSessions: number;
  burnedRooms: number;
  leftRooms: number;
  timestamp: number;
}

export interface BurnAllRequest {
  wipeIdentity: boolean;
}

interface UseBurnAllWebSocket {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

interface UseBurnAllOptions extends UseBurnAllWebSocket {
  onComplete?: (event: BurnAllCompleteEvent) => void;
  onError?: (error: BurnAllErrorCode) => void;
}

interface UseBurnAllReturn {
  burnAllState: BurnAllState;
  error: BurnAllErrorCode | null;
  requestBurnAll: (request: BurnAllRequest) => void;
  resetBurnAll: () => void;
}

const BURN_ALL_DESTINATION = '/app/user.burnAll';
const BURN_ALL_COMPLETE_DESTINATION = '/user/queue/burn-all-complete';

export function useBurnAll(options: UseBurnAllOptions): UseBurnAllReturn {
  const { isConnected, subscribe, unsubscribe, publish, onComplete, onError } = options;
  const [burnAllState, setBurnAllState] = useState<BurnAllState>('idle');
  const [error, setError] = useState<BurnAllErrorCode | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  const handleError = useCallback((code: BurnAllErrorCode) => {
    setError(code);
    setBurnAllState('error');
    onErrorRef.current?.(code);
  }, []);

  const resetBurnAll = useCallback(() => {
    setBurnAllState('idle');
    setError(null);
  }, []);

  const requestBurnAll = useCallback(
    (request: BurnAllRequest) => {
      if (burnAllState === 'burning') {
        return;
      }

      if (!isConnected) {
        handleError('NOT_CONNECTED');
        return;
      }

      setBurnAllState('burning');
      setError(null);
      publish(BURN_ALL_DESTINATION, request);
    },
    [burnAllState, isConnected, publish, handleError],
  );

  const handleBurnAllComplete = useCallback(
    (message: IMessage) => {
      try {
        const event = JSON.parse(message.body) as BurnAllCompleteEvent;
        setBurnAllState('done');
        setError(null);
        onCompleteRef.current?.(event);
      } catch {
        handleError('INTERNAL_ERROR');
      }
    },
    [handleError],
  );

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    subscribe(BURN_ALL_COMPLETE_DESTINATION, handleBurnAllComplete);
    return () => {
      unsubscribe(BURN_ALL_COMPLETE_DESTINATION);
    };
  }, [isConnected, subscribe, unsubscribe, handleBurnAllComplete]);

  return {
    burnAllState,
    error,
    requestBurnAll,
    resetBurnAll,
  };
}
