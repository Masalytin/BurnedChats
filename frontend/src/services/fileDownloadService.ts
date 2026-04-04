/**
 * File download pipeline: download encrypted blob → decrypt → return Blob.
 *
 * Uses fetch with ReadableStream for download progress tracking.
 * Maintains an in-memory cache of decrypted files so repeated opens
 * (e.g. tapping a thumbnail to view full-size) are instant.
 */

import WebApp from '@twa-dev/sdk';
import { decryptFile } from '@/crypto/fileEncryption';
import {
  decryptFailedError,
  fileTransferErrorFromDownloadResponse,
  FileTransferError,
  isFileTransferError,
} from '@/services/fileTransferErrors';

// ============================================
// Types
// ============================================

export interface DecryptedFile {
  blob: Blob;
  objectUrl: string;
}

export interface DownloadOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  /** MIME type to set on the decrypted Blob (e.g. 'image/jpeg'). */
  mimeType?: string;
}

// ============================================
// Constants
// ============================================

const DOWNLOAD_PATH = '/api/files';

// ============================================
// In-memory cache
// ============================================

const cache = new Map<string, DecryptedFile>();

// ============================================
// Public API
// ============================================

/**
 * Downloads an encrypted file from the server, decrypts it client-side,
 * and returns the plaintext Blob with an Object URL ready for display.
 *
 * Results are cached in memory — subsequent calls for the same fileId
 * return immediately without a network request.
 *
 * @param fileId  - Server-assigned file identifier
 * @param key     - AES-256-GCM CryptoKey used to encrypt the file
 * @param options - Optional progress callback and AbortSignal
 * @returns Decrypted file with Blob and Object URL
 */
export async function downloadFile(
  fileId: string,
  key: CryptoKey,
  options?: DownloadOptions,
): Promise<DecryptedFile> {
  const cached = cache.get(fileId);
  if (cached) return cached;

  let encryptedData: ArrayBuffer;
  try {
    encryptedData = await fetchBlob(fileId, options);
  } catch (e) {
    if (isFileTransferError(e)) {
      console.warn('[fileTransfer:download]', e.kind, e.serverErrorCode ?? '', {
        httpStatus: e.httpStatus,
      });
    }
    throw e;
  }

  let rawBlob: Blob;
  try {
    rawBlob = await decryptFile(encryptedData, key);
  } catch (e) {
    evictCachedFile(fileId);
    const err = decryptFailedError(e);
    console.warn('[fileTransfer:download]', err.kind);
    throw err;
  }

  const blob = options?.mimeType
    ? new Blob([rawBlob], { type: options.mimeType })
    : rawBlob;
  const objectUrl = URL.createObjectURL(blob);

  const result: DecryptedFile = { blob, objectUrl };
  cache.set(fileId, result);
  return result;
}

/**
 * Downloads and decrypts a thumbnail, returning an Object URL
 * suitable for `<img src>` or CSS `background-image`.
 *
 * Thumbnails are cached the same way as full files.
 *
 * @param fileId - Server-assigned file identifier for the thumbnail
 * @param key    - AES-256-GCM CryptoKey
 * @returns Object URL pointing to the decrypted thumbnail
 */
export async function downloadThumbnail(
  fileId: string,
  key: CryptoKey,
): Promise<string> {
  const result = await downloadFile(fileId, key, { mimeType: 'image/jpeg' });
  return result.objectUrl;
}

/**
 * Saves a decrypted file to the user's device.
 *
 * Tries Web Share API first (works in Telegram WebView on mobile),
 * then falls back to the `<a download>` trick (desktop browsers).
 */
export async function saveDecryptedFile(
  blob: Blob,
  fileName: string,
): Promise<void> {
  if (navigator.share && navigator.canShare) {
    try {
      const file = new File([blob], fileName, { type: blob.type });
      const shareData = { files: [file] };
      if (navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      // User cancelled or API unavailable — fall through
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Evicts a single file from the cache and revokes its Object URL.
 */
export function evictCachedFile(fileId: string): void {
  const entry = cache.get(fileId);
  if (entry) {
    URL.revokeObjectURL(entry.objectUrl);
    cache.delete(fileId);
  }
}

/**
 * Clears the entire download cache, revoking all Object URLs.
 * Call this on burn / session destroy to free memory.
 */
export function clearDownloadCache(): void {
  for (const entry of cache.values()) {
    URL.revokeObjectURL(entry.objectUrl);
  }
  cache.clear();
}

// ============================================
// Fetch with streaming progress
// ============================================

async function fetchBlob(
  fileId: string,
  options?: DownloadOptions,
): Promise<ArrayBuffer> {
  const apiBase = import.meta.env.VITE_API_URL || '';
  const url = `${apiBase}${DOWNLOAD_PATH}/${encodeURIComponent(fileId)}`;

  const headers: Record<string, string> = {};
  const initData = WebApp.initData || '';
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      signal: options?.signal,
    });
  } catch {
    throw new FileTransferError('Network error during file download', 'network', {
      retryable: true,
    });
  }

  if (!response.ok) {
    let serverCode: string | undefined;
    let serverMessage: string | undefined;
    const ct = response.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      try {
        const j = await response.json() as { error?: string; message?: string };
        serverCode = j.error;
        serverMessage = j.message;
      } catch {
        // ignore malformed JSON
      }
    }
    throw fileTransferErrorFromDownloadResponse(response.status, serverCode, serverMessage);
  }

  if (!options?.onProgress || !response.body) {
    return response.arrayBuffer();
  }

  return readStreamWithProgress(response, options.onProgress);
}

async function readStreamWithProgress(
  response: Response,
  onProgress: (percent: number) => void,
): Promise<ArrayBuffer> {
  const contentLength = Number(response.headers.get('Content-Length') || 0);
  const reader = response.body!.getReader();

  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    received += value.byteLength;

    if (contentLength > 0) {
      onProgress(Math.round((received / contentLength) * 100));
    }
  }

  if (contentLength > 0 && received !== contentLength) {
    throw new FileTransferError(
      'Downloaded size does not match Content-Length',
      'bad_request',
      { retryable: true, serverErrorCode: 'SIZE_MISMATCH' },
    );
  }

  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result.buffer as ArrayBuffer;
}

export { isFileTransferError };
