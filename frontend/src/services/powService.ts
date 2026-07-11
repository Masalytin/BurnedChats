/**
 * PoW orchestration: STOMP challenge request → Web Worker solve → PowSolution.
 *
 * Contract: docs/specs/SECURITY.md (anti-spam / PoW section).
 */

import type { IMessage } from '@stomp/stompjs';
import type { PowWorkerInbound, PowWorkerOutbound } from '../workers/powWorker';

/** Wire-format gated actions (DESIGN.md §3). */
export type PowAction = 'session_create' | 'search' | 'room_create' | 'invite';

/** Challenge issued by the server on /user/queue/pow-challenge. */
export interface PowChallenge {
  challengeId: string;
  action: PowAction;
  difficulty: number;
  ttlMs: number;
}

/** Solution attached to gated STOMP requests. */
export interface PowSolution {
  challengeId: string;
  nonce: string;
}

export interface PowProgressUpdate {
  /** Hash iterations completed so far (final count on success). */
  iterations: number;
}

export type PowSolvePhase = 'requesting' | 'solving';

export interface PowServiceDeps {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

export interface PowService {
  solveFor: (
    action: PowAction,
    options?: {
      onProgress?: (update: PowProgressUpdate) => void;
      onPhase?: (phase: PowSolvePhase) => void;
      signal?: AbortSignal;
    },
  ) => Promise<PowSolution>;
  cancel: () => void;
}

const POW_CHALLENGE_REQUEST_DEST = '/app/pow.challenge';
const POW_CHALLENGE_RESPONSE_DEST = '/user/queue/pow-challenge';

/** Max wait for server challenge after publish (ms). */
const CHALLENGE_RESPONSE_TIMEOUT_MS = 30_000;

/** Max time for Web Worker PoW solve before hard terminate (ms). */
const SOLVE_TIMEOUT_MS = 60_000;

function createPowWorker(): Worker {
  return new Worker(new URL('../workers/powWorker.ts', import.meta.url), { type: 'module' });
}

function parseChallengeEvent(body: string, expectedAction: PowAction): PowChallenge {
  const data = JSON.parse(body) as Partial<PowChallenge>;

  if (
    typeof data.challengeId !== 'string'
    || data.challengeId.length === 0
    || typeof data.action !== 'string'
    || typeof data.difficulty !== 'number'
  ) {
    throw new Error('Invalid PoW challenge response');
  }

  if (data.action !== expectedAction) {
    throw new Error(`PoW challenge action mismatch: expected ${expectedAction}, got ${data.action}`);
  }

  return {
    challengeId: data.challengeId,
    action: data.action as PowAction,
    difficulty: data.difficulty,
    ttlMs: typeof data.ttlMs === 'number' ? data.ttlMs : 60_000,
  };
}

/**
 * Creates a PoW orchestrator bound to the current STOMP WebSocket API.
 *
 * Subscribes to `/user/queue/pow-challenge` only for the duration of a single
 * challenge request; one Web Worker is spawned per solve and terminated afterward.
 */
export function createPowService(deps: PowServiceDeps): PowService {
  let activeAbort: AbortController | null = null;
  let activeWorker: Worker | null = null;

  const terminateWorker = (): void => {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  };

  const cancel = (): void => {
    activeAbort?.abort();
    activeAbort = null;
    terminateWorker();
  };

  const requestChallenge = (action: PowAction, signal?: AbortSignal): Promise<PowChallenge> => {
    if (!deps.isConnected) {
      return Promise.reject(new Error('WebSocket not connected'));
    }

    return new Promise<PowChallenge>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        deps.unsubscribe(POW_CHALLENGE_RESPONSE_DEST);
        signal?.removeEventListener('abort', onAbort);
      };

      const fail = (error: Error): void => {
        cleanup();
        reject(error);
      };

      const succeed = (challenge: PowChallenge): void => {
        cleanup();
        resolve(challenge);
      };

      const onAbort = (): void => {
        fail(createAbortError('PoW challenge request aborted'));
      };

      const timeoutId = setTimeout(() => {
        fail(new Error('PoW challenge request timed out'));
      }, CHALLENGE_RESPONSE_TIMEOUT_MS);

      if (signal?.aborted) {
        fail(createAbortError('PoW challenge request aborted'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      deps.subscribe(POW_CHALLENGE_RESPONSE_DEST, (message: IMessage) => {
        try {
          const challenge = parseChallengeEvent(message.body, action);
          succeed(challenge);
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Failed to parse PoW challenge'));
        }
      });

      deps.publish(POW_CHALLENGE_REQUEST_DEST, { action });
    });
  };

  const solveInWorker = (
    challenge: PowChallenge,
    onProgress?: (update: PowProgressUpdate) => void,
    signal?: AbortSignal,
  ): Promise<PowSolution> => {
    const worker = createPowWorker();
    activeWorker = worker;
    const requestId = crypto.randomUUID();

    return new Promise<PowSolution>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        worker.terminate();
        if (activeWorker === worker) {
          activeWorker = null;
        }
        signal?.removeEventListener('abort', onAbort);
      };

      const fail = (error: Error): void => {
        cleanup();
        reject(error);
      };

      const succeed = (nonce: string, iterations: number): void => {
        onProgress?.({ iterations });
        cleanup();
        resolve({ challengeId: challenge.challengeId, nonce });
      };

      const onAbort = (): void => {
        const cancelMsg: PowWorkerInbound = { type: 'cancel', requestId };
        worker.postMessage(cancelMsg);
      };

      if (signal?.aborted) {
        fail(createAbortError('PoW solving aborted'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      const timeoutId = setTimeout(() => {
        fail(new Error('PoW solve timed out'));
      }, SOLVE_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<PowWorkerOutbound>) => {
        const msg = event.data;
        if (msg.requestId !== requestId) {
          return;
        }

        switch (msg.type) {
          case 'progress':
            onProgress?.({ iterations: msg.iterations });
            break;
          case 'result':
            succeed(msg.nonce, msg.iterations);
            break;
          case 'cancelled':
            fail(createAbortError('PoW solving aborted'));
            break;
          case 'error':
            fail(new Error(msg.message));
            break;
          default:
            break;
        }
      };

      worker.onerror = (event) => {
        fail(new Error(event.message || 'PoW worker error'));
      };

      const solveMsg: PowWorkerInbound = {
        type: 'solve',
        requestId,
        challengeId: challenge.challengeId,
        difficulty: challenge.difficulty,
      };
      worker.postMessage(solveMsg);
    });
  };

  const solveFor = async (
    action: PowAction,
    options?: {
      onProgress?: (update: PowProgressUpdate) => void;
      onPhase?: (phase: PowSolvePhase) => void;
      signal?: AbortSignal;
    },
  ): Promise<PowSolution> => {
    cancel();

    const abort = new AbortController();
    activeAbort = abort;

    const combinedSignal = options?.signal
      ? anySignal([abort.signal, options.signal])
      : abort.signal;

    try {
      options?.onPhase?.('requesting');
      const challenge = await requestChallenge(action, combinedSignal);
      options?.onPhase?.('solving');
      return await solveInWorker(challenge, options?.onProgress, combinedSignal);
    } finally {
      if (activeAbort === abort) {
        activeAbort = null;
      }
      terminateWorker();
    }
  };

  return { solveFor, cancel };
}

function createAbortError(message: string): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/** Combines multiple AbortSignals; aborts when any source aborts. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return controller.signal;
}
