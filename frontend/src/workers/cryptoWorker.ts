/**
 * Web Worker entry for file AES-GCM encrypt/decrypt (IMP-AUDIT-13).
 *
 * Delegates to {@link encryptFileInThread} / {@link decryptFileInThread} in
 * fileEncryption.ts — no duplicated crypto logic here.
 */

import {
  encryptFileInThread,
  decryptFileInThread,
} from '../crypto/fileEncryption';

export type CryptoWorkerInbound =
  | {
      type: 'encryptFile';
      requestId: string;
      plaintext: ArrayBuffer;
      key: CryptoKey;
    }
  | {
      type: 'decryptFile';
      requestId: string;
      encryptedData: ArrayBuffer;
      key: CryptoKey;
    }
  | { type: 'cancel'; requestId: string };

export type CryptoWorkerOutbound =
  | { type: 'progress'; requestId: string; percent: number }
  | {
      type: 'encryptResult';
      requestId: string;
      data: ArrayBuffer;
      isChunked: boolean;
    }
  | { type: 'decryptResult'; requestId: string; data: ArrayBuffer }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; message: string };

let activeRequestId: string | null = null;
let activeAbort: AbortController | null = null;

self.onmessage = (event: MessageEvent<CryptoWorkerInbound>) => {
  const msg = event.data;

  if (msg.type === 'cancel') {
    if (activeRequestId === msg.requestId) {
      activeAbort?.abort();
    }
    return;
  }

  if (msg.type === 'encryptFile' || msg.type === 'decryptFile') {
    void runJob(msg);
  }
};

async function runJob(
  msg: Extract<CryptoWorkerInbound, { type: 'encryptFile' | 'decryptFile' }>,
): Promise<void> {
  activeRequestId = msg.requestId;
  activeAbort = new AbortController();
  const signal = activeAbort.signal;

  try {
    if (msg.type === 'encryptFile') {
      const result = await encryptFileInThread(msg.plaintext, msg.key, {
        onProgress: (percent) => {
          const outbound: CryptoWorkerOutbound = {
            type: 'progress',
            requestId: msg.requestId,
            percent,
          };
          self.postMessage(outbound);
        },
        signal,
      });

      const outbound: CryptoWorkerOutbound = {
        type: 'encryptResult',
        requestId: msg.requestId,
        data: result.data,
        isChunked: result.isChunked,
      };
      self.postMessage(outbound, { transfer: [result.data] });
      return;
    }

    const blob = await decryptFileInThread(msg.encryptedData, msg.key, {
      onProgress: (percent) => {
        const outbound: CryptoWorkerOutbound = {
          type: 'progress',
          requestId: msg.requestId,
          percent,
        };
        self.postMessage(outbound);
      },
      signal,
    });

    const data = await blob.arrayBuffer();
    const outbound: CryptoWorkerOutbound = {
      type: 'decryptResult',
      requestId: msg.requestId,
      data,
    };
    self.postMessage(outbound, { transfer: [data] });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const outbound: CryptoWorkerOutbound = { type: 'cancelled', requestId: msg.requestId };
      self.postMessage(outbound);
      return;
    }

    const message = error instanceof Error ? error.message : 'Crypto worker failed';
    const outbound: CryptoWorkerOutbound = { type: 'error', requestId: msg.requestId, message };
    self.postMessage(outbound);
  } finally {
    if (activeRequestId === msg.requestId) {
      activeRequestId = null;
      activeAbort = null;
    }
  }
}
