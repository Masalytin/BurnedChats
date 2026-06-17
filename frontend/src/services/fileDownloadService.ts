/**
 * File download pipeline: download encrypted blob → decrypt → return Blob.
 *
 * Uses fetch with ReadableStream for download progress tracking.
 * Maintains an in-memory cache of decrypted files so repeated opens
 * (e.g. tapping a thumbnail to view full-size) are instant.
 */

import { getRestAuthHeaders } from '@/auth/authCredentialsAccessor';
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

/** Map MIME → preferred extension when {@code fileName} has none (saves / share sheet). */
const MIME_TO_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/vnd.rar': '.rar',
  'application/x-rar-compressed': '.rar',
};

// ============================================
// In-memory cache
// ============================================

const cache = new Map<string, DecryptedFile>();

/** Thumbnail previews use data URLs so strict CSP (`img-src` without `blob:`) still works. */
const thumbnailDataUrlCache = new Map<string, string>();

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
 * @param options - Optional progress (0–100: ~0–50 while downloading, ~50–100 while decrypting),
 *   AbortSignal, and MIME override for the decrypted Blob
 * @returns Decrypted file with Blob and Object URL
 */
export async function downloadFile(
  fileId: string,
  key: CryptoKey,
  options?: DownloadOptions,
): Promise<DecryptedFile> {
  const cached = cache.get(fileId);
  if (cached) {
    if (options?.mimeType && cached.blob.type !== options.mimeType) {
      const retyped = new Blob([cached.blob], { type: options.mimeType });
      const objectUrl = URL.createObjectURL(retyped);
      URL.revokeObjectURL(cached.objectUrl);
      const updated: DecryptedFile = { blob: retyped, objectUrl };
      cache.set(fileId, updated);
      return updated;
    }
    return cached;
  }

  let encryptedData: ArrayBuffer;
  try {
    const fetchOptions =
      options?.onProgress != null
        ? {
            ...options,
            onProgress: (p: number) => {
              options.onProgress!(Math.round((p / 100) * 50));
            },
          }
        : options;
    encryptedData = await fetchBlob(fileId, fetchOptions);
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
    rawBlob = await decryptFile(encryptedData, key, {
      onProgress:
        options?.onProgress != null
          ? (p) => options.onProgress!(50 + Math.round((p / 100) * 50))
          : undefined,
    });
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
 * Downloads and decrypts a thumbnail, returning a `data:` URL
 * suitable for `<img src>` under CSP that allows `data:` but not `blob:`.
 *
 * Thumbnails are cached in memory by fileId.
 *
 * @param fileId - Server-assigned file identifier for the thumbnail
 * @param key    - AES-256-GCM CryptoKey
 * @returns Data URL of the decrypted thumbnail (JPEG)
 */
export async function downloadThumbnail(
  fileId: string,
  key: CryptoKey,
): Promise<string> {
  const hit = thumbnailDataUrlCache.get(fileId);
  if (hit) return hit;

  let encryptedData: ArrayBuffer;
  try {
    encryptedData = await fetchBlob(fileId, undefined);
  } catch (e) {
    throw e;
  }

  let rawBlob: Blob;
  try {
    rawBlob = await decryptFile(encryptedData, key);
  } catch (e) {
    thumbnailDataUrlCache.delete(fileId);
    throw decryptFailedError(e);
  }

  const blob = new Blob([rawBlob], { type: 'image/jpeg' });
  const dataUrl = await blobToDataURL(blob);
  thumbnailDataUrlCache.set(fileId, dataUrl);
  return dataUrl;
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
  const name = ensureDownloadFileName(fileName, blob.type);

  if (navigator.share && navigator.canShare) {
    try {
      const file = new File([blob], name, { type: blob.type });
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
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Evicts a single file from the cache and revokes its Object URL when applicable.
 */
export function evictCachedFile(fileId: string): void {
  const entry = cache.get(fileId);
  if (entry) {
    URL.revokeObjectURL(entry.objectUrl);
    cache.delete(fileId);
  }
  thumbnailDataUrlCache.delete(fileId);
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
  thumbnailDataUrlCache.clear();
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

  const headers: Record<string, string> = getRestAuthHeaders();

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

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * If {@code fileName} has no extension, append one from {@code mimeType} when known.
 */
function ensureDownloadFileName(fileName: string, mimeType: string): string {
  const trimmed = (fileName || 'file').trim() || 'file';
  const mime = (mimeType || '').trim().toLowerCase();
  const dot = trimmed.lastIndexOf('.');
  if (dot > 0 && dot < trimmed.length - 1) {
    return trimmed;
  }
  const ext = MIME_TO_EXT[mime];
  return ext ? `${trimmed}${ext}` : trimmed;
}

export { isFileTransferError };
