/**
 * Unit tests for Group Key module (P2-3.x).
 *
 * Tests cover:
 * - generateGroupKey: produces a valid AES-256-GCM extractable CryptoKey
 * - wrapGroupKey / unwrapGroupKey: ECIES-like round-trip
 * - Cross-key isolation: unwrapping with wrong private key fails
 */

import { describe, it, expect } from 'vitest';
import { generateGroupKey, wrapGroupKey, unwrapGroupKey } from './groupKey';
import { generateKeyPair } from './ecdh';
import { encryptMessage, decryptMessage } from './aes';

// ============================================
// generateGroupKey
// ============================================

describe('generateGroupKey()', () => {
  it('generates an AES-256-GCM CryptoKey', async () => {
    const key = await generateGroupKey();

    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.type).toBe('secret');
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
  });

  it('marks the key as extractable (owner can re-wrap for new members)', async () => {
    const key = await generateGroupKey();
    expect(key.extractable).toBe(true);
  });

  it('allows encrypt/decrypt usages', async () => {
    const key = await generateGroupKey();
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('generates independent keys on repeated calls', async () => {
    const key1 = await generateGroupKey();
    const key2 = await generateGroupKey();

    // Export both and verify they differ
    const raw1 = await crypto.subtle.exportKey('raw', key1);
    const raw2 = await crypto.subtle.exportKey('raw', key2);

    const bytes1 = new Uint8Array(raw1);
    const bytes2 = new Uint8Array(raw2);

    expect(bytes1).not.toEqual(bytes2);
  });
});

// ============================================
// wrapGroupKey / unwrapGroupKey round-trip
// ============================================

describe('wrapGroupKey() / unwrapGroupKey() round-trip', () => {
  it('successfully wraps and unwraps the group key', async () => {
    const recipientKeyPair = await generateKeyPair();
    const groupKey = await generateGroupKey();

    const bundle = await wrapGroupKey(
      groupKey,
      recipientKeyPair.publicKey,
      '12345678',
      'room-test-1',
      0
    );

    expect(bundle.roomId).toBe('room-test-1');
    expect(bundle.epoch).toBe(0);
    expect(bundle.recipientInternalId).toBe('12345678');
    expect(typeof bundle.ephemeralPublicKey).toBe('string');
    expect(typeof bundle.encryptedKey).toBe('string');
    expect(typeof bundle.iv).toBe('string');

    const unwrappedKey = await unwrapGroupKey(bundle, recipientKeyPair.privateKey);

    expect(unwrappedKey).toBeInstanceOf(CryptoKey);
    expect(unwrappedKey.type).toBe('secret');
    expect(unwrappedKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
  });

  it('unwrapped key is non-extractable (for forward secrecy)', async () => {
    const recipientKeyPair = await generateKeyPair();
    const groupKey = await generateGroupKey();

    const bundle = await wrapGroupKey(
      groupKey,
      recipientKeyPair.publicKey,
      '99',
      'room-test-2',
      1
    );

    const unwrappedKey = await unwrapGroupKey(bundle, recipientKeyPair.privateKey);
    expect(unwrappedKey.extractable).toBe(false);
  });

  it('unwrapped key encrypts/decrypts correctly (functionally equivalent to original)', async () => {
    const recipientKeyPair = await generateKeyPair();
    const groupKey = await generateGroupKey();
    const sessionId = 'room-enc-test';
    const plaintext = 'Hello, encrypted group chat!';

    // Encrypt with original group key
    const { ciphertext, iv } = await encryptMessage(groupKey, plaintext, sessionId);

    // Wrap and unwrap
    const bundle = await wrapGroupKey(
      groupKey,
      recipientKeyPair.publicKey,
      '42',
      'room-test-3',
      0
    );
    const unwrappedKey = await unwrapGroupKey(bundle, recipientKeyPair.privateKey);

    // Decrypt with unwrapped key — must produce the same plaintext
    const decrypted = await decryptMessage(unwrappedKey, ciphertext, iv, sessionId);
    expect(decrypted).toBe(plaintext);
  });

  it('wraps bundle metadata correctly', async () => {
    const recipientKeyPair = await generateKeyPair();
    const groupKey = await generateGroupKey();
    const epoch = 3;

    const bundle = await wrapGroupKey(
      groupKey,
      recipientKeyPair.publicKey,
      '777',
      'room-meta',
      epoch
    );

    expect(bundle.epoch).toBe(epoch);
    expect(bundle.recipientInternalId).toBe('777');
    expect(bundle.roomId).toBe('room-meta');

    // iv should be 12 bytes → base64 length = ceil(12/3)*4 = 16 chars
    const ivBytes = atob(bundle.iv);
    expect(ivBytes.length).toBe(12);

    // ephemeralPublicKey: P-256 uncompressed = 65 bytes → base64 length = 88 chars
    const pubKeyBytes = atob(bundle.ephemeralPublicKey);
    expect(pubKeyBytes.length).toBe(65);
  });

  it('different wraps of the same key produce different ciphertexts (random IV)', async () => {
    const recipientKeyPair = await generateKeyPair();
    const groupKey = await generateGroupKey();

    const bundle1 = await wrapGroupKey(groupKey, recipientKeyPair.publicKey, '1', 'room-x', 0);
    const bundle2 = await wrapGroupKey(groupKey, recipientKeyPair.publicKey, '1', 'room-x', 0);

    // Different ephemeral keys and IVs each time
    expect(bundle1.ephemeralPublicKey).not.toBe(bundle2.ephemeralPublicKey);
    expect(bundle1.iv).not.toBe(bundle2.iv);
  });
});

// ============================================
// Cross-key isolation
// ============================================

describe('Cross-key isolation', () => {
  it('fails to unwrap with the wrong private key', async () => {
    const recipientKeyPair = await generateKeyPair();
    const wrongKeyPair = await generateKeyPair();
    const groupKey = await generateGroupKey();

    const bundle = await wrapGroupKey(
      groupKey,
      recipientKeyPair.publicKey,
      '42',
      'room-isolation',
      0
    );

    // Using wrong private key should throw (AES-GCM auth tag mismatch)
    await expect(
      unwrapGroupKey(bundle, wrongKeyPair.privateKey)
    ).rejects.toThrow();
  });
});
