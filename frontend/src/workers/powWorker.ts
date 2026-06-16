/**
 * Web Worker entry for PoW solving (IMP-ASPOW-06).
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

let activeRequestId: string | null = null;
let activeAbort: AbortController | null = null;

self.onmessage = (event: MessageEvent<PowWorkerInbound>) => {
  const msg = event.data;

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
  activeRequestId = msg.requestId;
  activeAbort = new AbortController();

  try {
    const result = await solvePow(msg.challengeId, msg.difficulty, activeAbort.signal);
    const outbound: PowWorkerOutbound = {
      type: 'result',
      requestId: msg.requestId,
      nonce: result.nonce,
      iterations: result.iterations,
    };
    self.postMessage(outbound);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const outbound: PowWorkerOutbound = { type: 'cancelled', requestId: msg.requestId };
      self.postMessage(outbound);
      return;
    }

    const message = error instanceof Error ? error.message : 'PoW worker failed';
    const outbound: PowWorkerOutbound = { type: 'error', requestId: msg.requestId, message };
    self.postMessage(outbound);
  } finally {
    if (activeRequestId === msg.requestId) {
      activeRequestId = null;
      activeAbort = null;
    }
  }
}
