/**
 * Web Worker entry for PoW solving (IMP-ASPOW-06 / IMP-POWFAST-01).
 *
 * Delegates all hash logic to {@link solvePow} in crypto/pow.ts — no duplicated
 * Hashcash / leadingZeroBits implementation here.
 */

import { solvePow } from '../crypto/pow';

export type PowWorkerInbound =
  | { type: 'solve'; requestId: string; challengeId: string; difficulty: number }
  | { type: 'cancel'; requestId: string };

export type PowWorkerOutbound =
  | { type: 'progress'; requestId: string; iterations: number }
  | { type: 'result'; requestId: string; nonce: string; iterations: number }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; message: string };

/** Max rate for outbound `{ type: 'progress' }` (IMP-POWFAST-01). */
const PROGRESS_THROTTLE_MS = 100;

export interface PowWorkerRuntime {
  dispatch(msg: PowWorkerInbound): void;
}

/**
 * Testable Worker runtime. The Worker entry binds this to `self.onmessage`.
 * A repeat inbound `solve` must abort the previous controller — not overwrite it.
 */
export function createPowWorkerRuntime(
  postMessage: (msg: PowWorkerOutbound) => void,
): PowWorkerRuntime {
  let activeRequestId: string | null = null;
  let activeAbort: AbortController | null = null;

  const dispatch = (msg: PowWorkerInbound): void => {
    if (msg.type === 'cancel') {
      if (activeRequestId === msg.requestId) {
        activeAbort?.abort();
      }
      return;
    }

    if (msg.type === 'solve') {
      void runSolve(msg);
    }
  };

  async function runSolve(msg: Extract<PowWorkerInbound, { type: 'solve' }>): Promise<void> {
    activeAbort?.abort();
    activeRequestId = msg.requestId;
    activeAbort = new AbortController();
    let lastProgressAt = 0;

    try {
      const result = await solvePow(
        msg.challengeId,
        msg.difficulty,
        activeAbort.signal,
        (iterations) => {
          const now = performance.now();
          if (now - lastProgressAt < PROGRESS_THROTTLE_MS) {
            return;
          }
          lastProgressAt = now;
          postMessage({ type: 'progress', requestId: msg.requestId, iterations });
        },
      );
      const outbound: PowWorkerOutbound = {
        type: 'result',
        requestId: msg.requestId,
        nonce: result.nonce,
        iterations: result.iterations,
      };
      postMessage(outbound);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const outbound: PowWorkerOutbound = { type: 'cancelled', requestId: msg.requestId };
        postMessage(outbound);
        return;
      }

      const message = error instanceof Error ? error.message : 'PoW worker failed';
      const outbound: PowWorkerOutbound = { type: 'error', requestId: msg.requestId, message };
      postMessage(outbound);
    } finally {
      if (activeRequestId === msg.requestId) {
        activeRequestId = null;
        activeAbort = null;
      }
    }
  }

  return { dispatch };
}

const workerScope = typeof self !== 'undefined' ? self : undefined;
if (workerScope !== undefined) {
  const runtime = createPowWorkerRuntime((msg) => {
    workerScope.postMessage(msg);
  });
  workerScope.onmessage = (event: MessageEvent<PowWorkerInbound>) => {
    runtime.dispatch(event.data);
  };
}
