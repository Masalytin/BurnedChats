/**
 * File upload pipeline: encrypt → upload → return fileId.
 *
 * Uses XMLHttpRequest (not fetch) to support upload progress tracking.
 * For images/videos, a thumbnail is generated, encrypted, and uploaded
 * in parallel with the main file.
 */

import { getRestAuthHeaders } from '@/auth/authCredentialsAccessor';
import { encryptFile } from '@/crypto/fileEncryption';
import { generateImageThumbnail, generateVideoThumbnail } from '@/utils/thumbnail';
import { resolveFileMime } from '@/utils/fileValidation';
import { FileTransferError, fileTransferErrorFromUploadXHR } from '@/services/fileTransferErrors';

// ============================================
// Types
// ============================================

export interface FileContext {
  type: 'session' | 'room';
  id: string;
}

export interface UploadResult {
  fileId: string;
  thumbnailFileId?: string;
  /** Local data URL for immediate preview (sender); no extra download. */
  thumbnailDataUrl?: string;
  size: number;
}

export interface UploadOptions {
  /** XHR upload progress 0–100 (main file, or weighted main+thumbnail). */
  onProgress?: (percent: number) => void;
  /** Main file encryption progress 0–100 (chunked for large files). */
  onEncryptProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

interface UploadResponse {
  fileId: string;
  size: number;
}

// ============================================
// Constants
// ============================================

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
]);

const UPLOAD_PATH = '/api/files/upload';

// ============================================
// Public API
// ============================================

/**
 * Encrypts and uploads a file to the server.
 *
 * For images and videos a thumbnail is automatically generated, encrypted,
 * and uploaded alongside the main file.  Progress is tracked via XHR and
 * reported through the optional `onProgress` callback as a percentage [0-100].
 *
 * @param file    - Source file to upload
 * @param key     - AES-256-GCM CryptoKey (shared session or room key)
 * @param context - Upload context (session or room with its ID)
 * @param options - Optional upload progress, encrypt progress (large files), and AbortSignal
 * @returns Upload result containing fileId, optional thumbnailFileId,
 *   optional thumbnailDataUrl for local preview, and size
 */
export async function uploadFile(
  file: File,
  key: CryptoKey,
  context: FileContext,
  options?: UploadOptions,
): Promise<UploadResult> {
  const signal = options?.signal;
  throwIfAborted(signal);

  const encryptedBlob = await encryptFile(file, key, {
    onProgress: (percent) => options?.onEncryptProgress?.(percent),
  });
  throwIfAborted(signal);

  const thumbnail = await generateThumbnail(file);
  let encryptedThumbnail: ArrayBuffer | null = null;
  let thumbnailDataUrl: string | undefined;

  if (thumbnail) {
    try {
      thumbnailDataUrl = await blobToDataUrl(thumbnail);
    } catch {
      // Sender preview is optional
    }
    const result = await encryptFile(thumbnail, key);
    encryptedThumbnail = result.data;
    throwIfAborted(signal);
  }

  if (encryptedThumbnail) {
    const mainWeight = encryptedBlob.data.byteLength;
    const thumbWeight = encryptedThumbnail.byteLength;
    const totalWeight = mainWeight + thumbWeight;

    let mainProgress = 0;
    let thumbProgress = 0;

    const reportCombined = () => {
      if (!options?.onProgress) return;
      const combined =
        (mainProgress * mainWeight + thumbProgress * thumbWeight) / totalWeight;
      options.onProgress(Math.round(combined));
    };

    const [mainResponse, thumbResponse] = await Promise.all([
      uploadBlob(encryptedBlob.data, context, signal, (p) => {
        mainProgress = p;
        reportCombined();
      }),
      uploadBlob(encryptedThumbnail, context, signal, (p) => {
        thumbProgress = p;
        reportCombined();
      }),
    ]);

    return {
      fileId: mainResponse.fileId,
      thumbnailFileId: thumbResponse.fileId,
      thumbnailDataUrl,
      size: mainResponse.size,
    };
  }

  const response = await uploadBlob(
    encryptedBlob.data,
    context,
    signal,
    options?.onProgress,
  );

  return {
    fileId: response.fileId,
    size: response.size,
  };
}

// ============================================
// Thumbnail generation
// ============================================

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('FileReader result is not a string'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

async function generateThumbnail(file: File): Promise<Blob | null> {
  const mime = resolveFileMime(file);
  if (IMAGE_MIME_TYPES.has(mime)) {
    return generateImageThumbnail(file);
  }
  if (VIDEO_MIME_TYPES.has(mime)) {
    return generateVideoThumbnail(file);
  }
  return null;
}

// ============================================
// XHR upload with progress
// ============================================

function uploadBlob(
  data: ArrayBuffer,
  context: FileContext,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<UploadResponse> {
  return new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const apiBase = import.meta.env.VITE_API_URL || '';
    xhr.open('POST', `${apiBase}${UPLOAD_PATH}`);

    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Context-Type', context.type);
    xhr.setRequestHeader('X-Context-Id', context.id);

    for (const [name, value] of Object.entries(getRestAuthHeaders())) {
      xhr.setRequestHeader(name, value);
    }

    xhr.responseType = 'json';

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = xhr.response as UploadResponse;
        resolve(body);
        return;
      }

      if (xhr.status === 0) {
        const err = new FileTransferError('Network error during file upload', 'network', {
          retryable: true,
        });
        logTransferFailure('upload', err);
        reject(err);
        return;
      }

      const parsed = parseXhrJsonBody(xhr);
      const err = fileTransferErrorFromUploadXHR(
        xhr.status,
        parsed.error,
        parsed.message ?? undefined,
      );
      logTransferFailure('upload', err);
      reject(err);
    });

    xhr.addEventListener('error', () => {
      const err = new FileTransferError('Network error during file upload', 'network', {
        retryable: true,
      });
      logTransferFailure('upload', err);
      reject(err);
    });

    xhr.addEventListener('abort', () => {
      reject(new FileTransferError('Upload aborted', 'aborted', { retryable: false }));
    });

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        reject(new FileTransferError('Upload aborted', 'aborted', { retryable: false }));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(data);
  });
}

// ============================================
// Helpers
// ============================================

function logTransferFailure(op: 'upload' | 'download', err: FileTransferError): void {
  console.warn(`[fileTransfer:${op}]`, err.kind, err.serverErrorCode ?? '', {
    httpStatus: err.httpStatus,
  });
}

function parseXhrJsonBody(xhr: XMLHttpRequest): { error?: string; message?: string } {
  try {
    const raw = xhr.responseText;
    if (!raw) return {};
    return JSON.parse(raw) as { error?: string; message?: string };
  } catch {
    return {};
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new FileTransferError('Upload aborted', 'aborted', { retryable: false });
  }
}
