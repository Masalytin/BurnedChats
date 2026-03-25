/**
 * Transfer queue manager for file upload and download operations.
 *
 * - Upload queue: sequential (1 concurrent)
 * - Download queue: up to 2 concurrent, thumbnails prioritised
 * - Automatic retry on network errors (max 3 attempts, exponential backoff)
 * - Cancel individual operations or all at once (for burn)
 */

import { uploadFile, type FileContext, type UploadResult } from '@/services/fileUploadService';
import { downloadFile, downloadThumbnail } from '@/services/fileDownloadService';
import type { DecryptedFile } from '@/services/fileDownloadService';

// ============================================
// Types
// ============================================

export type TransferStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TransferType = 'upload' | 'download';

export interface TransferHandle<T = unknown> {
  id: string;
  type: TransferType;
  status: TransferStatus;
  progress: number;
  result: Promise<T>;
}

type StatusListener = (id: string, status: TransferStatus, progress: number) => void;

interface QueueEntry<T> {
  id: string;
  type: TransferType;
  priority: number;
  status: TransferStatus;
  progress: number;
  abortController: AbortController;
  execute: (signal: AbortSignal, onProgress: (p: number) => void) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

// ============================================
// Constants
// ============================================

const MAX_UPLOAD_CONCURRENT = 1;
const MAX_DOWNLOAD_CONCURRENT = 2;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

const PRIORITY_THUMBNAIL = 10;
const PRIORITY_NORMAL = 0;

// ============================================
// State
// ============================================

let nextId = 1;

const uploadQueue: QueueEntry<UploadResult>[] = [];
const downloadQueue: QueueEntry<DecryptedFile | string>[] = [];

let activeUploads = 0;
let activeDownloads = 0;

let listener: StatusListener | null = null;

// ============================================
// Public API
// ============================================

/**
 * Registers a callback that fires whenever a transfer's status or progress changes.
 * Only one listener is supported — subsequent calls replace the previous one.
 */
export function onTransferUpdate(cb: StatusListener): void {
  listener = cb;
}

/**
 * Enqueue a file upload.
 *
 * @returns TransferHandle with a `result` promise that resolves to UploadResult
 */
export function enqueueUpload(
  file: File,
  key: CryptoKey,
  context: FileContext,
): TransferHandle<UploadResult> {
  const id = `upload-${nextId++}`;

  let resolve!: (v: UploadResult) => void;
  let reject!: (r: unknown) => void;
  const result = new Promise<UploadResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const entry: QueueEntry<UploadResult> = {
    id,
    type: 'upload',
    priority: PRIORITY_NORMAL,
    status: 'queued',
    progress: 0,
    abortController: new AbortController(),
    execute: (signal, onProgress) => uploadFile(file, key, context, { signal, onProgress }),
    resolve,
    reject,
  };

  uploadQueue.push(entry);
  notify(entry);
  drainUploadQueue();

  return makeHandle(entry, result);
}

/**
 * Enqueue a full-file download.
 *
 * @returns TransferHandle with a `result` promise that resolves to DecryptedFile
 */
export function enqueueDownload(
  fileId: string,
  key: CryptoKey,
): TransferHandle<DecryptedFile> {
  return enqueueDownloadInternal<DecryptedFile>(
    PRIORITY_NORMAL,
    (signal, onProgress) => downloadFile(fileId, key, { signal, onProgress }),
  );
}

/**
 * Enqueue a thumbnail download (higher priority than regular downloads).
 *
 * @returns TransferHandle with a `result` promise that resolves to an Object URL
 */
export function enqueueThumbnailDownload(
  fileId: string,
  key: CryptoKey,
): TransferHandle<string> {
  return enqueueDownloadInternal<string>(
    PRIORITY_THUMBNAIL,
    (_signal, _onProgress) => downloadThumbnail(fileId, key),
  );
}

/**
 * Cancel a specific transfer by ID. In-flight operations are aborted;
 * queued operations are removed.
 */
export function cancel(transferId: string): void {
  cancelInQueue(uploadQueue, transferId);
  cancelInQueue(downloadQueue, transferId);
}

/**
 * Cancel all pending and in-flight transfers. Use on burn / session destroy.
 */
export function cancelAll(): void {
  cancelAllInQueue(uploadQueue);
  cancelAllInQueue(downloadQueue);
  activeUploads = 0;
  activeDownloads = 0;
}

// ============================================
// Internal: download enqueue
// ============================================

function enqueueDownloadInternal<T extends DecryptedFile | string>(
  priority: number,
  execute: (signal: AbortSignal, onProgress: (p: number) => void) => Promise<T>,
): TransferHandle<T> {
  const id = `download-${nextId++}`;

  let resolve!: (v: T) => void;
  let reject!: (r: unknown) => void;
  const result = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const entry: QueueEntry<DecryptedFile | string> = {
    id,
    type: 'download',
    priority,
    status: 'queued',
    progress: 0,
    abortController: new AbortController(),
    execute: execute as (signal: AbortSignal, onProgress: (p: number) => void) => Promise<DecryptedFile | string>,
    resolve: resolve as (v: DecryptedFile | string) => void,
    reject,
  };

  insertByPriority(downloadQueue, entry);
  notify(entry);
  drainDownloadQueue();

  return makeHandle(entry, result) as TransferHandle<T>;
}

// ============================================
// Queue processing
// ============================================

function drainUploadQueue(): void {
  while (activeUploads < MAX_UPLOAD_CONCURRENT && uploadQueue.length > 0) {
    const entry = uploadQueue.find((e) => e.status === 'queued');
    if (!entry) break;
    activeUploads++;
    processEntry(entry).finally(() => {
      activeUploads--;
      drainUploadQueue();
    });
  }
}

function drainDownloadQueue(): void {
  while (activeDownloads < MAX_DOWNLOAD_CONCURRENT && downloadQueue.length > 0) {
    const entry = downloadQueue.find((e) => e.status === 'queued');
    if (!entry) break;
    activeDownloads++;
    processEntry(entry).finally(() => {
      activeDownloads--;
      drainDownloadQueue();
    });
  }
}

async function processEntry<T>(entry: QueueEntry<T>): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (isCancelled(entry)) return;

    if (attempt > 0) {
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
      if (isCancelled(entry)) return;
    }

    entry.status = 'in_progress';
    entry.progress = 0;
    notify(entry);

    try {
      const result = await entry.execute(
        entry.abortController.signal,
        (percent) => {
          entry.progress = percent;
          notify(entry);
        },
      );

      entry.status = 'completed';
      entry.progress = 100;
      notify(entry);
      entry.resolve(result);
      removeFromQueue(entry);
      return;
    } catch (err: unknown) {
      if (isCancelled(entry)) return;

      if (isAbortError(err)) {
        entry.status = 'cancelled';
        notify(entry);
        entry.reject(err);
        removeFromQueue(entry);
        return;
      }

      if (isClientError(err) || attempt === MAX_RETRIES) {
        entry.status = 'failed';
        entry.progress = 0;
        notify(entry);
        entry.reject(err);
        removeFromQueue(entry);
        return;
      }

      lastError = err;
      entry.status = 'queued';
      entry.progress = 0;
      notify(entry);
    }
  }

  entry.status = 'failed';
  notify(entry);
  entry.reject(lastError);
  removeFromQueue(entry);
}

// ============================================
// Cancel helpers
// ============================================

function cancelInQueue<T>(queue: QueueEntry<T>[], transferId: string): void {
  const idx = queue.findIndex((e) => e.id === transferId);
  if (idx === -1) return;

  const entry = queue[idx];
  entry.status = 'cancelled';
  entry.abortController.abort();
  notify(entry);
  entry.reject(new DOMException('Transfer cancelled', 'AbortError'));
  queue.splice(idx, 1);
}

function cancelAllInQueue<T>(queue: QueueEntry<T>[]): void {
  for (const entry of [...queue]) {
    entry.status = 'cancelled';
    entry.abortController.abort();
    notify(entry);
    entry.reject(new DOMException('Transfer cancelled', 'AbortError'));
  }
  queue.length = 0;
}

// ============================================
// Helpers
// ============================================

function makeHandle<T>(entry: QueueEntry<T>, result: Promise<T>): TransferHandle<T> {
  return {
    get id() { return entry.id; },
    get type() { return entry.type; },
    get status() { return entry.status; },
    get progress() { return entry.progress; },
    result,
  };
}

function notify<T>(entry: QueueEntry<T>): void {
  listener?.(entry.id, entry.status, entry.progress);
}

function insertByPriority<T>(queue: QueueEntry<T>[], entry: QueueEntry<T>): void {
  const idx = queue.findIndex((e) => e.priority < entry.priority);
  if (idx === -1) {
    queue.push(entry);
  } else {
    queue.splice(idx, 0, entry);
  }
}

function removeFromQueue<T>(entry: QueueEntry<T>): void {
  const queue = entry.type === 'upload'
    ? uploadQueue
    : downloadQueue;

  const idx = (queue as QueueEntry<unknown>[]).indexOf(entry as QueueEntry<unknown>);
  if (idx !== -1) queue.splice(idx, 1);
}

/** Reads status without TS control-flow narrowing (status is mutated externally by cancel). */
function isCancelled<T>(entry: QueueEntry<T>): boolean {
  return (entry.status as TransferStatus) === 'cancelled';
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function isClientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const match = err.message.match(/(\d{3})/);
  if (!match) return false;
  const code = Number(match[1]);
  return code >= 400 && code < 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
