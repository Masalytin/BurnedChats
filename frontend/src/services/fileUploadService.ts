/**
 * File upload pipeline: encrypt → upload → return fileId.
 *
 * Uses XMLHttpRequest (not fetch) to support upload progress tracking.
 * For images/videos, a thumbnail is generated, encrypted, and uploaded
 * in parallel with the main file.
 */

import WebApp from '@twa-dev/sdk';
import { encryptFile } from '@/crypto/fileEncryption';
import { generateImageThumbnail, generateVideoThumbnail } from '@/utils/thumbnail';

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
  size: number;
}

export interface UploadOptions {
  onProgress?: (percent: number) => void;
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
 * @param options - Optional progress callback and AbortSignal
 * @returns Upload result containing fileId, optional thumbnailFileId, and size
 */
export async function uploadFile(
  file: File,
  key: CryptoKey,
  context: FileContext,
  options?: UploadOptions,
): Promise<UploadResult> {
  const signal = options?.signal;
  throwIfAborted(signal);

  const encryptedBlob = await encryptFile(file, key);
  throwIfAborted(signal);

  const thumbnail = await generateThumbnail(file);
  let encryptedThumbnail: ArrayBuffer | null = null;

  if (thumbnail) {
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

async function generateThumbnail(file: File): Promise<Blob | null> {
  if (IMAGE_MIME_TYPES.has(file.type)) {
    return generateImageThumbnail(file);
  }
  if (VIDEO_MIME_TYPES.has(file.type)) {
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

    const initData = getInitData();
    if (initData) {
      xhr.setRequestHeader('X-Telegram-Init-Data', initData);
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
      } else {
        const errorBody = xhr.response as { error?: string; message?: string } | null;
        reject(
          new Error(
            errorBody?.message ??
              `Upload failed with status ${xhr.status}`,
          ),
        );
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during file upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new DOMException('Upload aborted', 'AbortError'));
    });

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        reject(new DOMException('Upload aborted', 'AbortError'));
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

function getInitData(): string {
  return WebApp.initData || '';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Upload aborted', 'AbortError');
  }
}
