/**
 * Unit tests for the file encryption/decryption module.
 *
 * Covers:
 * - Single-shot encrypt/decrypt roundtrip (files <= 5 MB)
 * - Chunked encrypt/decrypt roundtrip (files > 5 MB)
 * - Format auto-detection in decryptFile
 * - Edge cases: empty file, exact threshold, boundary chunk sizes
 * - Error handling: wrong key, tampered data, truncated data
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  encryptFile,
  decryptFile,
  FILE_CHUNK_SIZE,
  FILE_CHUNKED_THRESHOLD,
} from './fileEncryption';
import { deriveAESKey, generateKeyPair, computeSharedSecret } from './ecdh';

// ============================================
// Helpers
// ============================================

async function createTestKey(): Promise<CryptoKey> {
  const kp1 = await generateKeyPair();
  const kp2 = await generateKeyPair();
  const raw = await computeSharedSecret(kp1.privateKey, kp2.publicKey);
  return deriveAESKey(raw, 'test-file-session');
}

function makeBlob(size: number, pattern = 0xab): Blob {
  const buf = new Uint8Array(size);
  buf.fill(pattern);
  return new Blob([buf]);
}

function makeRandomBlob(size: number): Blob {
  const buf = new Uint8Array(size);
  const maxChunk = 65_536;
  for (let offset = 0; offset < size; offset += maxChunk) {
    const end = Math.min(offset + maxChunk, size);
    crypto.getRandomValues(buf.subarray(offset, end));
  }
  return new Blob([buf]);
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

// ============================================
// Single-shot encryption tests (files <= 5 MB)
// ============================================

describe('File Encryption — single-shot', () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await createTestKey();
  });

  it('should encrypt and return EncryptedBlob with isChunked=false', async () => {
    const blob = makeBlob(1024);
    const result = await encryptFile(blob, key);

    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('isChunked', false);
    expect(result.data.byteLength).toBeGreaterThan(1024);
  });

  it('should roundtrip a small file (1 KB)', async () => {
    const original = makeRandomBlob(1024);
    const encrypted = await encryptFile(original, key);
    const decrypted = await decryptFile(encrypted.data, key);

    expect(await blobToBytes(decrypted)).toEqual(await blobToBytes(original));
  });

  it('should roundtrip an empty file (0 bytes)', async () => {
    const original = new Blob([]);
    const encrypted = await encryptFile(original, key);
    const decrypted = await decryptFile(encrypted.data, key);

    expect(encrypted.isChunked).toBe(false);
    expect((await decrypted.arrayBuffer()).byteLength).toBe(0);
  });

  it('should roundtrip a file exactly at threshold (5 MB)', { timeout: 30_000 }, async () => {
    const original = makeRandomBlob(FILE_CHUNKED_THRESHOLD);
    const encrypted = await encryptFile(original, key);

    expect(encrypted.isChunked).toBe(false);

    const decrypted = await decryptFile(encrypted.data, key);
    expect(await blobToBytes(decrypted)).toEqual(await blobToBytes(original));
  });

  it('should produce unique ciphertext for the same plaintext', async () => {
    const blob = makeBlob(256);
    const enc1 = await encryptFile(blob, key);
    const enc2 = await encryptFile(blob, key);

    const a = new Uint8Array(enc1.data);
    const b = new Uint8Array(enc2.data);
    const same = a.length === b.length && a.every((v, i) => v === b[i]);
    expect(same).toBe(false);
  });
});

// ============================================
// Chunked encryption tests (files > 5 MB)
// ============================================

describe('File Encryption — chunked', () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await createTestKey();
  });

  it('should use chunked mode for files > 5 MB', async () => {
    const original = makeBlob(FILE_CHUNKED_THRESHOLD + 1);
    const encrypted = await encryptFile(original, key);

    expect(encrypted.isChunked).toBe(true);
  });

  it('should roundtrip a file just above threshold (5 MB + 1)', { timeout: 60_000 }, async () => {
    const original = makeRandomBlob(FILE_CHUNKED_THRESHOLD + 1);
    const encrypted = await encryptFile(original, key);
    const decrypted = await decryptFile(encrypted.data, key);

    expect(await blobToBytes(decrypted)).toEqual(await blobToBytes(original));
  });

  it('should roundtrip a file spanning multiple full chunks', { timeout: 60_000 }, async () => {
    const size = FILE_CHUNKED_THRESHOLD + FILE_CHUNK_SIZE * 2;
    const original = makeRandomBlob(size);
    const encrypted = await encryptFile(original, key);
    const decrypted = await decryptFile(encrypted.data, key);

    expect(await blobToBytes(decrypted)).toEqual(await blobToBytes(original));
  });

  it('should roundtrip a file with a partial last chunk', { timeout: 60_000 }, async () => {
    const size = FILE_CHUNKED_THRESHOLD + FILE_CHUNK_SIZE + 42;
    const original = makeRandomBlob(size);
    const encrypted = await encryptFile(original, key);
    const decrypted = await decryptFile(encrypted.data, key);

    expect(await blobToBytes(decrypted)).toEqual(await blobToBytes(original));
  });

  it('should produce the correct chunk_count in the header', async () => {
    const size = FILE_CHUNKED_THRESHOLD + FILE_CHUNK_SIZE * 2 + 1;
    const expectedChunks = Math.ceil(size / FILE_CHUNK_SIZE);

    const encrypted = await encryptFile(makeBlob(size), key);
    const view = new DataView(encrypted.data);

    expect(view.getUint8(0)).toBe(0x01);
    expect(view.getUint32(1, false)).toBe(expectedChunks);
  });
});

// ============================================
// Format detection
// ============================================

describe('decryptFile — format auto-detection', () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await createTestKey();
  });

  it('should auto-detect single-shot format', async () => {
    const enc = await encryptFile(makeBlob(100), key);
    expect(new Uint8Array(enc.data)[0]).toBe(0x00);

    const dec = await decryptFile(enc.data, key);
    expect((await dec.arrayBuffer()).byteLength).toBe(100);
  });

  it('should auto-detect chunked format', async () => {
    const enc = await encryptFile(makeBlob(FILE_CHUNKED_THRESHOLD + 1), key);
    expect(new Uint8Array(enc.data)[0]).toBe(0x01);

    const dec = await decryptFile(enc.data, key);
    expect((await dec.arrayBuffer()).byteLength).toBe(FILE_CHUNKED_THRESHOLD + 1);
  });

  it('should reject unknown format byte', async () => {
    const bad = new Uint8Array([0xff, 0, 0, 0]);
    await expect(decryptFile(bad.buffer as ArrayBuffer, key)).rejects.toThrow(
      /Unknown file encryption format/,
    );
  });

  it('should reject empty data', async () => {
    await expect(decryptFile(new ArrayBuffer(0), key)).rejects.toThrow(/empty/);
  });
});

// ============================================
// Error handling & security
// ============================================

describe('File Encryption — error cases', () => {
  let key: CryptoKey;
  let wrongKey: CryptoKey;

  beforeAll(async () => {
    key = await createTestKey();
    wrongKey = await createTestKey();
  });

  it('should fail decryption with a wrong key (single)', async () => {
    const enc = await encryptFile(makeBlob(100), key);
    await expect(decryptFile(enc.data, wrongKey)).rejects.toThrow();
  });

  it('should fail decryption with a wrong key (chunked)', async () => {
    const enc = await encryptFile(makeBlob(FILE_CHUNKED_THRESHOLD + 1), key);
    await expect(decryptFile(enc.data, wrongKey)).rejects.toThrow();
  });

  it('should fail on tampered ciphertext (single)', async () => {
    const enc = await encryptFile(makeBlob(100), key);
    const bytes = new Uint8Array(enc.data);
    bytes[bytes.length - 1] ^= 0xff;
    await expect(decryptFile(bytes.buffer as ArrayBuffer, key)).rejects.toThrow();
  });

  it('should fail on tampered ciphertext (chunked)', async () => {
    const enc = await encryptFile(makeBlob(FILE_CHUNKED_THRESHOLD + 1), key);
    const bytes = new Uint8Array(enc.data);
    bytes[bytes.length - 1] ^= 0xff;
    await expect(decryptFile(bytes.buffer as ArrayBuffer, key)).rejects.toThrow();
  });

  it('should fail on truncated single-shot data', async () => {
    const data = new Uint8Array([0x00, 1, 2, 3]);
    await expect(decryptFile(data.buffer as ArrayBuffer, key)).rejects.toThrow(
      /at least/,
    );
  });

  it('should fail on truncated chunked data (missing ciphertext)', async () => {
    const buf = new ArrayBuffer(6);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    bytes[0] = 0x01;
    view.setUint32(1, 2, false);
    await expect(decryptFile(buf, key)).rejects.toThrow(/Truncated/);
  });
});

// ============================================
// Data integrity across formats
// ============================================

describe('File Encryption — data integrity', () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await createTestKey();
  });

  it('should preserve exact bytes through encrypt/decrypt', async () => {
    const sizes = [0, 1, 255, 1024, 65536];
    for (const size of sizes) {
      const original = makeRandomBlob(size);
      const encrypted = await encryptFile(original, key);
      const decrypted = await decryptFile(encrypted.data, key);
      expect(await blobToBytes(decrypted)).toEqual(await blobToBytes(original));
    }
  });

  it('should handle File objects the same as Blobs', async () => {
    const blob = makeRandomBlob(512);
    const file = new File([blob], 'test.bin', { type: 'application/octet-stream' });

    const encBlob = await encryptFile(blob, key);
    const encFile = await encryptFile(file, key);

    const decBlob = await decryptFile(encBlob.data, key);
    const decFile = await decryptFile(encFile.data, key);

    expect(await blobToBytes(decBlob)).toEqual(await blobToBytes(decFile));
    expect(await blobToBytes(decFile)).toEqual(await blobToBytes(blob));
  });
});
