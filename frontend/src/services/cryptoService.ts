/**
 * Crypto Web Worker orchestration for file encrypt/decrypt (IMP-AUDIT-13).
 *
 * Pattern mirrors {@link createPowService}: one worker per in-flight job,
 * structured-clone CryptoKey via postMessage (no raw export), terminate on
 * cancel. A bounded queue serialises jobs and provides backpressure.
 */

import type { CryptoWorkerInbound, CryptoWorkerOutbound } from '../workers/cryptoWorker';
import type { EncryptedBlob, EncryptOptions, DecryptOptions } from '../crypto/fileEncryption';

export interface CryptoService {
  encryptFile: (
    file: File | Blob,
    key: CryptoKey,
    options?: EncryptOptions & { signal?: AbortSignal },
  ) => Promise<EncryptedBlob>;
  decryptFile: (
    encryptedData: ArrayBuffer,
    key: CryptoKey,
    options?: DecryptOptions & { signal?: AbortSignal },
  ) => Promise<Blob>;
  cancelAll: () => void;
}

/** Max queued crypto jobs before new enqueue calls reject (backpressure). */
const MAX_PENDING_JOBS = 4;

function createCryptoWorker(): Worker {
  return new Worker(new URL('../workers/cryptoWorker.ts', import.meta.url), { type: 'module' });
}

function createAbortError(message: string): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

interface QueuedTask<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

let taskQueue: QueuedTask<unknown>[] = [];
let draining = false;
let activeWorker: Worker | null = null;
let activeRequestId: string | null = null;

function terminateActiveWorker(): void {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
    activeRequestId = null;
  }
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;

  while (taskQueue.length > 0) {
    const task = taskQueue.shift() as QueuedTask<unknown>;
    try {
      const result = await task.execute();
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    }
  }

  draining = false;
}

function enqueueTask<T>(execute: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (taskQueue.length >= MAX_PENDING_JOBS) {
      reject(new Error('Crypto queue full — try again later'));
      return;
    }

    taskQueue.push({
      execute: execute as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    void drainQueue();
  });
}

function runInWorker<T>(
  buildInbound: (requestId: string) => CryptoWorkerInbound,
  transferables: Transferable[],
  onProgress: ((percent: number) => void) | undefined,
  signal: AbortSignal | undefined,
  parseResult: (msg: CryptoWorkerOutbound) => T | null,
): Promise<T> {
  const worker = createCryptoWorker();
  activeWorker = worker;
  const requestId = crypto.randomUUID();
  activeRequestId = requestId;

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      worker.terminate();
      if (activeWorker === worker) {
        activeWorker = null;
        activeRequestId = null;
      }
      signal?.removeEventListener('abort', onAbort);
    };

    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const succeed = (value: T): void => {
      cleanup();
      resolve(value);
    };

    const onAbort = (): void => {
      const cancelMsg: CryptoWorkerInbound = { type: 'cancel', requestId };
      worker.postMessage(cancelMsg);
      fail(createAbortError('Crypto operation aborted'));
    };

    if (signal?.aborted) {
      fail(createAbortError('Crypto operation aborted'));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<CryptoWorkerOutbound>) => {
      const msg = event.data;
      if (msg.requestId !== requestId) return;

      switch (msg.type) {
        case 'progress':
          onProgress?.(msg.percent);
          break;
        case 'cancelled':
          fail(createAbortError('Crypto operation aborted'));
          break;
        case 'error':
          fail(new Error(msg.message));
          break;
        default: {
          const parsed = parseResult(msg);
          if (parsed !== null) {
            succeed(parsed);
          }
          break;
        }
      }
    };

    worker.onerror = (event) => {
      fail(new Error(event.message || 'Crypto worker error'));
    };

    worker.postMessage(buildInbound(requestId), { transfer: transferables });
  });
}

function shouldUseWorker(): boolean {
  return typeof Worker !== 'undefined' && !import.meta.env.VITEST;
}

export function createCryptoService(): CryptoService {
  const cancelAll = (): void => {
    for (const task of taskQueue) {
      task.reject(createAbortError('Crypto operation aborted'));
    }
    taskQueue = [];

    if (activeWorker && activeRequestId) {
      const cancelMsg: CryptoWorkerInbound = { type: 'cancel', requestId: activeRequestId };
      activeWorker.postMessage(cancelMsg);
    }
    terminateActiveWorker();
  };

  const encryptFile = async (
    file: File | Blob,
    key: CryptoKey,
    options?: EncryptOptions & { signal?: AbortSignal },
  ): Promise<EncryptedBlob> => {
    const plaintext = await file.arrayBuffer();

    return enqueueTask(async (): Promise<EncryptedBlob> => {
      if (!shouldUseWorker()) {
        const { encryptFileInThread } = await import('../crypto/fileEncryption');
        return encryptFileInThread(plaintext, key, options);
      }

      return runInWorker(
        (requestId) => ({
          type: 'encryptFile',
          requestId,
          plaintext,
          key,
        }),
        [plaintext],
        options?.onProgress,
        options?.signal,
        (msg) => {
          if (msg.type === 'encryptResult') {
            return { data: msg.data, isChunked: msg.isChunked };
          }
          return null;
        },
      );
    });
  };

  const decryptFile = async (
    encryptedData: ArrayBuffer,
    key: CryptoKey,
    options?: DecryptOptions & { signal?: AbortSignal },
  ): Promise<Blob> =>
    enqueueTask(async (): Promise<Blob> => {
      if (!shouldUseWorker()) {
        const { decryptFileInThread } = await import('../crypto/fileEncryption');
        return decryptFileInThread(encryptedData, key, options);
      }

      return runInWorker(
        (requestId) => ({
          type: 'decryptFile',
          requestId,
          encryptedData,
          key,
        }),
        [encryptedData],
        options?.onProgress,
        options?.signal,
        (msg) => {
          if (msg.type === 'decryptResult') {
            return new Blob([msg.data]);
          }
          return null;
        },
      );
    });

  return { encryptFile, decryptFile, cancelAll };
}

let defaultService: CryptoService | null = null;

/** Shared singleton used by fileEncryption and transferQueue. */
export function getCryptoService(): CryptoService {
  if (!defaultService) {
    defaultService = createCryptoService();
  }
  return defaultService;
}

/** Test hook — replace the singleton (restore with resetCryptoService). */
export function setCryptoService(service: CryptoService | null): void {
  defaultService = service;
}

export function resetCryptoService(): void {
  defaultService = null;
}
