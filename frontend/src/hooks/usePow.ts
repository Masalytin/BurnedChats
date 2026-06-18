import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPowService,
  type PowAction,
  type PowProgressUpdate,
  type PowService,
  type PowServiceDeps,
  type PowSolution,
} from '../services/powService';

export type PowPhase = 'idle' | 'requesting' | 'solving' | 'done' | 'error';

export interface UsePowOptions extends PowServiceDeps {
  /** Optional progress callback for UI (IMP-ASPOW-07). */
  onProgress?: (update: PowProgressUpdate) => void;
}

export interface UsePowReturn {
  phase: PowPhase;
  /** Latest iteration count from the active or last solve (for UI). */
  progressIterations: number;
  solveFor: (action: PowAction) => Promise<PowSolution>;
  cancel: () => void;
}

/**
 * React hook for client-side PoW state and orchestration.
 *
 * Wraps {@link createPowService} with phase tracking for UI consumers.
 */
export function usePow({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onProgress,
}: UsePowOptions): UsePowReturn {
  const [phase, setPhase] = useState<PowPhase>('idle');
  const [progressIterations, setProgressIterations] = useState(0);

  const onProgressRef = useRef(onProgress);
  const serviceRef = useRef<PowService | null>(null);

  useEffect(() => {
    onProgressRef.current = onProgress;
  });

  useEffect(() => {
    serviceRef.current?.cancel();
    const service = createPowService({
      isConnected,
      subscribe,
      unsubscribe,
      publish,
    });
    serviceRef.current = service;
    return () => {
      service.cancel();
      if (serviceRef.current === service) {
        serviceRef.current = null;
      }
    };
  }, [isConnected, subscribe, unsubscribe, publish]);

  const cancel = useCallback(() => {
    serviceRef.current?.cancel();
    setPhase('idle');
    setProgressIterations(0);
  }, []);

  const solveFor = useCallback(async (action: PowAction): Promise<PowSolution> => {
    const service = serviceRef.current;
    if (!service) {
      throw new Error('PoW service unavailable');
    }

    setPhase('requesting');
    setProgressIterations(0);

    const handleProgress = (update: PowProgressUpdate): void => {
      setProgressIterations(update.iterations);
      onProgressRef.current?.(update);
    };

    try {
      const solution = await service.solveFor(action, {
        onPhase: setPhase,
        onProgress: handleProgress,
      });
      setPhase('done');
      return solution;
    } catch (error) {
      setPhase('error');
      throw error;
    }
  }, []);

  return {
    phase,
    progressIterations,
    solveFor,
    cancel,
  };
}
