/**
 * File encryption/decryption module for BurnedChats.
 *
 * Encrypts files client-side using AES-256-GCM before uploading to the server
 * (zero-knowledge). Uses the same shared key as text messages (derived from
 * ECDH or room group key).
 *
 * Two binary formats are supported:
 *
 *   Single-shot (files <= 5 MB):
 *     [FORMAT_SINGLE (1 byte)] [IV (12 bytes)] [ciphertext + GCM tag]
 *
 *   Chunked (files > 5 MB, 64 KB plaintext chunks):
 *     [FORMAT_CHUNKED (1 byte)] [chunk_count (4 bytes, big-endian)]
 *     [IV₁ (12)] [encrypted_chunk₁] [IV₂ (12)] [encrypted_chunk₂] ...
 *
 * The leading format byte allows decryptFile to auto-detect the format.
 *
 * File payload encrypt/decrypt is offloaded to a Web Worker via cryptoService
 * (IMP-AUDIT-13). Metadata helpers remain on the main thread (small payloads).
 */

// ============================================
// Constants
// ============================================

const AES_ALGORITHM = 'AES-GCM';
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BITS = 128;
const GCM_TAG_BYTES = TAG_LENGTH_BITS / 8; // 16
const MAX_FILE_NAME_LENGTH = 255;

/** Plaintext chunk size for chunked encryption. */
const CHUNK_SIZE = 64 * 1024; // 64 KB

/** Files larger than this threshold use chunked encryption. */
const CHUNKED_THRESHOLD = 5 * 1024 * 1024; // 5 MB

/** Format markers — first byte of the encrypted blob. */
const FORMAT_SINGLE = 0x00;
const FORMAT_CHUNKED = 0x01;

// ============================================
// Types
// ============================================

/**
 * Result of file encryption.
 * Contains the encrypted binary data and a flag indicating the format used.
 */
export interface EncryptedBlob {
  /** Raw encrypted bytes (includes format header, IV(s), ciphertext). */
  data: ArrayBuffer;
  /** True when chunked encryption was used (file > 5 MB). */
  isChunked: boolean;
}

/** Optional callbacks for long-running encrypt/decrypt operations. */
export interface EncryptOptions {
  /** Chunked encryption reports 0–100 per chunk; single-shot fires 100% when done. */
  onProgress?: (percent: number) => void;
  /** When aborted, in-thread helpers throw AbortError between chunks. */
  signal?: AbortSignal;
}

export interface DecryptOptions {
  /** Chunked decryption reports 0–100 per chunk; single-shot fires 100% when done. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Plaintext file metadata that the server must never see.
 * Encrypted client-side and sent inline in STOMP messages.
 */
export interface FileMetaPlain {
  fileName: string;
  mimeType: string;
}

// ============================================
// Public API (routes through cryptoService worker)
// ============================================

/**
 * Encrypts a file using AES-256-GCM (Web Worker when available).
 *
 * @param file - File or Blob to encrypt
 * @param key  - AES-256-GCM CryptoKey (shared secret or room group key)
 * @param options - Optional progress and abort signal
 */
export async function encryptFile(
  file: File | Blob,
  key: CryptoKey,
  options?: EncryptOptions,
): Promise<EncryptedBlob> {
  const { getCryptoService } = await import('../services/cryptoService');
  return getCryptoService().encryptFile(file, key, options);
}

/**
 * Decrypts an encrypted blob back into a Blob (Web Worker when available).
 *
 * Auto-detects the format (single-shot vs chunked) from the leading byte.
 */
export async function decryptFile(
  encryptedData: ArrayBuffer,
  key: CryptoKey,
  options?: DecryptOptions,
): Promise<Blob> {
  const { getCryptoService } = await import('../services/cryptoService');
  return getCryptoService().decryptFile(encryptedData, key, options);
}

/**
 * In-thread file encryption — used by cryptoWorker and vitest inline fallback.
 * Callers pass plaintext bytes already read from a File/Blob.
 */
export async function encryptFileInThread(
  plaintext: ArrayBuffer,
  key: CryptoKey,
  options?: EncryptOptions,
): Promise<EncryptedBlob> {
  const bytes = new Uint8Array(plaintext);

  if (bytes.byteLength <= CHUNKED_THRESHOLD) {
    const result = await encryptSingle(bytes, key, options?.signal);
    options?.onProgress?.(100);
    return result;
  }
  return encryptChunked(bytes, key, options?.onProgress, options?.signal);
}

/**
 * In-thread file decryption — used by cryptoWorker and vitest inline fallback.
 */
export async function decryptFileInThread(
  encryptedData: ArrayBuffer,
  key: CryptoKey,
  options?: DecryptOptions,
): Promise<Blob> {
  const bytes = new Uint8Array(encryptedData);

  if (bytes.byteLength < 1) {
    throw new Error('Invalid encrypted data: empty');
  }

  const format = bytes[0];

  if (format === FORMAT_SINGLE) {
    return decryptSingle(bytes, key, options?.onProgress, options?.signal);
  }
  if (format === FORMAT_CHUNKED) {
    return decryptChunked(bytes, new DataView(encryptedData), key, options?.onProgress, options?.signal);
  }

  throw new Error(
    `Unknown file encryption format: 0x${format.toString(16).padStart(2, '0')}`,
  );
}

// ============================================
// Single-shot encryption (files <= 5 MB)
// ============================================

async function encryptSingle(
  plaintext: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
  signal?: AbortSignal,
): Promise<EncryptedBlob> {
  throwIfAborted(signal);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv, tagLength: TAG_LENGTH_BITS },
    key,
    plaintext,
  );

  const ctBytes = new Uint8Array(ciphertext);

  // [FORMAT_SINGLE (1)] [IV (12)] [ciphertext + tag]
  const result = new Uint8Array(1 + IV_LENGTH_BYTES + ctBytes.byteLength);
  result[0] = FORMAT_SINGLE;
  result.set(iv, 1);
  result.set(ctBytes, 1 + IV_LENGTH_BYTES);

  return { data: result.buffer as ArrayBuffer, isChunked: false };
}

// ============================================
// Chunked encryption (files > 5 MB)
// ============================================

async function encryptChunked(
  plaintext: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<EncryptedBlob> {
  const chunkCount = Math.ceil(plaintext.byteLength / CHUNK_SIZE);

  const encryptedChunks: { iv: Uint8Array; data: Uint8Array }[] = [];
  let totalPayloadSize = 0;

  for (let i = 0; i < chunkCount; i++) {
    throwIfAborted(signal);

    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, plaintext.byteLength);
    const chunk = plaintext.slice(start, end);

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    const encrypted = await crypto.subtle.encrypt(
      { name: AES_ALGORITHM, iv, tagLength: TAG_LENGTH_BITS },
      key,
      chunk,
    );

    const encData = new Uint8Array(encrypted);
    encryptedChunks.push({ iv, data: encData });
    totalPayloadSize += IV_LENGTH_BYTES + encData.byteLength;
    onProgress?.(Math.round(((i + 1) / chunkCount) * 100));
  }

  // [FORMAT_CHUNKED (1)] [chunk_count (4)] [IV₁ (12)] [chunk₁] ...
  const result = new Uint8Array(1 + 4 + totalPayloadSize);
  result[0] = FORMAT_CHUNKED;

  new DataView(result.buffer).setUint32(1, chunkCount, false);

  let offset = 5;
  for (const { iv, data } of encryptedChunks) {
    result.set(iv, offset);
    offset += IV_LENGTH_BYTES;
    result.set(data, offset);
    offset += data.byteLength;
  }

  return { data: result.buffer as ArrayBuffer, isChunked: true };
}

// ============================================
// Single-shot decryption
// ============================================

async function decryptSingle(
  bytes: Uint8Array,
  key: CryptoKey,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal);

  const minSize = 1 + IV_LENGTH_BYTES + GCM_TAG_BYTES;
  if (bytes.byteLength < minSize) {
    throw new Error(
      `Invalid single-shot encrypted data: expected at least ${minSize} bytes, got ${bytes.byteLength}`,
    );
  }

  const iv = bytes.slice(1, 1 + IV_LENGTH_BYTES);
  const ciphertext = bytes.slice(1 + IV_LENGTH_BYTES);

  const plaintext = await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv, tagLength: TAG_LENGTH_BITS },
    key,
    ciphertext,
  );

  onProgress?.(100);
  return new Blob([plaintext]);
}

// ============================================
// Chunked decryption
// ============================================

async function decryptChunked(
  bytes: Uint8Array,
  view: DataView,
  key: CryptoKey,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const chunkCount = view.getUint32(1, false);

  if (chunkCount === 0) {
    throw new Error('Invalid chunked data: zero chunks');
  }

  const decryptedParts: ArrayBuffer[] = [];
  let offset = 5; // 1 (format) + 4 (chunk_count)

  for (let i = 0; i < chunkCount; i++) {
    throwIfAborted(signal);

    if (offset + IV_LENGTH_BYTES > bytes.byteLength) {
      throw new Error(`Truncated chunked data at chunk ${i}: missing IV`);
    }

    const iv = bytes.slice(offset, offset + IV_LENGTH_BYTES);
    offset += IV_LENGTH_BYTES;

    let encChunkSize: number;
    if (i < chunkCount - 1) {
      encChunkSize = CHUNK_SIZE + GCM_TAG_BYTES;
    } else {
      encChunkSize = bytes.byteLength - offset;
    }

    if (offset + encChunkSize > bytes.byteLength) {
      throw new Error(`Truncated chunked data at chunk ${i}: incomplete ciphertext`);
    }

    const encryptedChunk = bytes.slice(offset, offset + encChunkSize);
    offset += encChunkSize;

    const decrypted = await crypto.subtle.decrypt(
      { name: AES_ALGORITHM, iv, tagLength: TAG_LENGTH_BITS },
      key,
      encryptedChunk,
    );

    decryptedParts.push(decrypted);
    onProgress?.(Math.round(((i + 1) / chunkCount) * 100));
  }

  return new Blob(decryptedParts);
}

// ============================================
// File Metadata Encryption (main thread — small payloads)
// ============================================

/**
 * Encrypts file metadata (fileName, mimeType) into a single Base64 string.
 */
export async function encryptFileMetadata(
  meta: FileMetaPlain,
  key: CryptoKey,
): Promise<string> {
  if (meta.fileName.length > MAX_FILE_NAME_LENGTH) {
    throw new Error(
      `fileName exceeds maximum length of ${MAX_FILE_NAME_LENGTH} characters`,
    );
  }

  const json = JSON.stringify(meta);
  const plaintext = new TextEncoder().encode(json);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv, tagLength: TAG_LENGTH_BITS },
    key,
    plaintext,
  );

  const ctBytes = new Uint8Array(ciphertext);
  const combined = new Uint8Array(IV_LENGTH_BYTES + ctBytes.byteLength);
  combined.set(iv, 0);
  combined.set(ctBytes, IV_LENGTH_BYTES);

  return uint8ToBase64(combined);
}

/**
 * Decrypts a Base64-encoded encrypted metadata string back to FileMetaPlain.
 */
export async function decryptFileMetadata(
  encrypted: string,
  key: CryptoKey,
): Promise<FileMetaPlain> {
  const combined = base64ToUint8(encrypted);

  const minSize = IV_LENGTH_BYTES + GCM_TAG_BYTES;
  if (combined.byteLength < minSize) {
    throw new Error(
      `Invalid encrypted metadata: expected at least ${minSize} bytes, got ${combined.byteLength}`,
    );
  }

  const iv = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);

  const plaintext = await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv, tagLength: TAG_LENGTH_BITS },
    key,
    ciphertext,
  );

  const json = new TextDecoder().decode(plaintext);
  const parsed: unknown = JSON.parse(json);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as FileMetaPlain).fileName !== 'string' ||
    typeof (parsed as FileMetaPlain).mimeType !== 'string'
  ) {
    throw new Error('Invalid file metadata structure');
  }

  return parsed as FileMetaPlain;
}

// ============================================
// Base64 helpers (binary-safe)
// ============================================

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (typeof DOMException !== 'undefined') {
    throw new DOMException('Crypto operation aborted', 'AbortError');
  }
  const err = new Error('Crypto operation aborted');
  err.name = 'AbortError';
  throw err;
}

// ============================================
// Exported constants (useful for tests & downstream modules)
// ============================================

export {
  CHUNK_SIZE as FILE_CHUNK_SIZE,
  CHUNKED_THRESHOLD as FILE_CHUNKED_THRESHOLD,
};
