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
 */

// ============================================
// Constants
// ============================================

const AES_ALGORITHM = 'AES-GCM';
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BITS = 128;
const GCM_TAG_BYTES = TAG_LENGTH_BITS / 8; // 16

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

// ============================================
// Public API
// ============================================

/**
 * Encrypts a file using AES-256-GCM.
 *
 * Files <= 5 MB are encrypted in a single pass (simpler, fast).
 * Files >  5 MB are split into 64 KB plaintext chunks, each encrypted
 * with its own random IV for memory efficiency.
 *
 * @param file - File or Blob to encrypt
 * @param key  - AES-256-GCM CryptoKey (shared secret or room group key)
 * @returns EncryptedBlob with binary data and format flag
 * @throws Error if encryption fails
 */
export async function encryptFile(
  file: File | Blob,
  key: CryptoKey,
): Promise<EncryptedBlob> {
  const plaintext = await file.arrayBuffer();

  if (plaintext.byteLength <= CHUNKED_THRESHOLD) {
    return encryptSingle(new Uint8Array(plaintext), key);
  }
  return encryptChunked(new Uint8Array(plaintext), key);
}

/**
 * Decrypts an encrypted blob back into a Blob.
 *
 * Auto-detects the format (single-shot vs chunked) from the leading byte.
 *
 * @param encryptedData - Raw encrypted bytes produced by encryptFile
 * @param key           - The same AES-256-GCM CryptoKey used for encryption
 * @returns Decrypted Blob
 * @throws Error if format is unknown or decryption/authentication fails
 */
export async function decryptFile(
  encryptedData: ArrayBuffer,
  key: CryptoKey,
): Promise<Blob> {
  const bytes = new Uint8Array(encryptedData);

  if (bytes.byteLength < 1) {
    throw new Error('Invalid encrypted data: empty');
  }

  const format = bytes[0];

  if (format === FORMAT_SINGLE) {
    return decryptSingle(bytes, key);
  }
  if (format === FORMAT_CHUNKED) {
    return decryptChunked(bytes, new DataView(encryptedData), key);
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
): Promise<EncryptedBlob> {
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
): Promise<EncryptedBlob> {
  const chunkCount = Math.ceil(plaintext.byteLength / CHUNK_SIZE);

  const encryptedChunks: { iv: Uint8Array; data: Uint8Array }[] = [];
  let totalPayloadSize = 0;

  for (let i = 0; i < chunkCount; i++) {
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
): Promise<Blob> {
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

  return new Blob([plaintext]);
}

// ============================================
// Chunked decryption
// ============================================

async function decryptChunked(
  bytes: Uint8Array,
  view: DataView,
  key: CryptoKey,
): Promise<Blob> {
  const chunkCount = view.getUint32(1, false);

  if (chunkCount === 0) {
    throw new Error('Invalid chunked data: zero chunks');
  }

  const decryptedParts: ArrayBuffer[] = [];
  let offset = 5; // 1 (format) + 4 (chunk_count)

  for (let i = 0; i < chunkCount; i++) {
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
  }

  return new Blob(decryptedParts);
}

// ============================================
// Exported constants (useful for tests & downstream modules)
// ============================================

export {
  CHUNK_SIZE as FILE_CHUNK_SIZE,
  CHUNKED_THRESHOLD as FILE_CHUNKED_THRESHOLD,
};
