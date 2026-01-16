/**
 * Unit tests for ECDH key exchange module.
 * 
 * Tests cover:
 * - Key pair generation
 * - Public key export/import
 * - Shared secret computation
 * - AES key derivation via HKDF
 * - Fingerprint generation
 */

import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  computeSharedSecret,
  deriveAESKey,
  generateFingerprint,
  isCryptoAvailable,
} from './ecdh';

// ============================================
// Key Generation Tests
// ============================================

describe('ECDH Key Generation', () => {
  describe('generateKeyPair()', () => {
    it('should generate a valid key pair', async () => {
      const keyPair = await generateKeyPair();
      
      expect(keyPair).toHaveProperty('publicKey');
      expect(keyPair).toHaveProperty('privateKey');
      expect(keyPair.publicKey).toBeInstanceOf(CryptoKey);
      expect(keyPair.privateKey).toBeInstanceOf(CryptoKey);
    });

    it('should generate public key with correct algorithm', async () => {
      const keyPair = await generateKeyPair();
      const algorithm = keyPair.publicKey.algorithm as EcKeyAlgorithm;
      
      expect(algorithm.name).toBe('ECDH');
      expect(algorithm.namedCurve).toBe('P-256');
    });

    it('should generate private key that can derive keys', async () => {
      const keyPair = await generateKeyPair();
      
      expect(keyPair.privateKey.usages).toContain('deriveBits');
    });

    it('should generate unique key pairs each time', async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();
      
      const exported1 = await exportPublicKey(keyPair1.publicKey);
      const exported2 = await exportPublicKey(keyPair2.publicKey);
      
      expect(exported1).not.toBe(exported2);
    });
  });
});

// ============================================
// Key Export/Import Tests
// ============================================

describe('ECDH Key Export/Import', () => {
  describe('exportPublicKey()', () => {
    it('should export public key as Base64 string', async () => {
      const keyPair = await generateKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);
      
      expect(typeof exported).toBe('string');
      expect(exported.length).toBeGreaterThan(0);
    });

    it('should produce valid Base64 output', async () => {
      const keyPair = await generateKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);
      
      const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
      expect(exported).toMatch(base64Pattern);
    });

    it('should produce consistent exports for same key', async () => {
      const keyPair = await generateKeyPair();
      
      const exported1 = await exportPublicKey(keyPair.publicKey);
      const exported2 = await exportPublicKey(keyPair.publicKey);
      
      expect(exported1).toBe(exported2);
    });
  });

  describe('importPublicKey()', () => {
    it('should import exported public key', async () => {
      const keyPair = await generateKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);
      
      const imported = await importPublicKey(exported);
      
      expect(imported).toBeInstanceOf(CryptoKey);
    });

    it('should preserve algorithm after import', async () => {
      const keyPair = await generateKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);
      const imported = await importPublicKey(exported);
      
      const algorithm = imported.algorithm as EcKeyAlgorithm;
      expect(algorithm.name).toBe('ECDH');
      expect(algorithm.namedCurve).toBe('P-256');
    });

    it('should fail with invalid Base64', async () => {
      await expect(
        importPublicKey('not-valid-base64!!!')
      ).rejects.toThrow();
    });

    it('should fail with random data', async () => {
      const randomBase64 = btoa('random-invalid-key-data');
      
      await expect(
        importPublicKey(randomBase64)
      ).rejects.toThrow();
    });
  });
});

// ============================================
// Shared Secret Tests
// ============================================

describe('ECDH Shared Secret', () => {
  describe('computeSharedSecret()', () => {
    it('should compute shared secret between two parties', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      
      const aliceShared = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      
      expect(aliceShared).toBeInstanceOf(ArrayBuffer);
      expect(aliceShared.byteLength).toBe(32); // 256 bits for P-256
    });

    it('should produce identical secrets for both parties', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      
      const aliceShared = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      
      const bobShared = await computeSharedSecret(
        bobKeyPair.privateKey,
        aliceKeyPair.publicKey
      );
      
      // Convert to comparable format
      const aliceBytes = new Uint8Array(aliceShared);
      const bobBytes = new Uint8Array(bobShared);
      
      expect(aliceBytes).toEqual(bobBytes);
    });

    it('should produce different secrets with different peers', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      const charlieKeyPair = await generateKeyPair();
      
      const aliceBobShared = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      
      const aliceCharlieShared = await computeSharedSecret(
        aliceKeyPair.privateKey,
        charlieKeyPair.publicKey
      );
      
      const aliceBobBytes = new Uint8Array(aliceBobShared);
      const aliceCharlieBytes = new Uint8Array(aliceCharlieShared);
      
      expect(aliceBobBytes).not.toEqual(aliceCharlieBytes);
    });
  });
});

// ============================================
// Key Derivation Tests
// ============================================

describe('ECDH Key Derivation', () => {
  describe('deriveAESKey()', () => {
    it('should derive AES-GCM key from shared secret', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      
      const sharedSecret = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      
      const aesKey = await deriveAESKey(sharedSecret, 'session-123');
      
      expect(aesKey).toBeInstanceOf(CryptoKey);
      expect(aesKey.algorithm.name).toBe('AES-GCM');
      expect(aesKey.usages).toContain('encrypt');
      expect(aesKey.usages).toContain('decrypt');
    });

    it('should produce identical keys for both parties', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      const sessionId = 'session-456';
      
      const aliceShared = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      
      const bobShared = await computeSharedSecret(
        bobKeyPair.privateKey,
        aliceKeyPair.publicKey
      );
      
      const aliceAESKey = await deriveAESKey(aliceShared, sessionId);
      const bobAESKey = await deriveAESKey(bobShared, sessionId);
      
      // Test by encrypting/decrypting a message
      const testMessage = 'Test message for key comparison';
      const encoder = new TextEncoder();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aliceAESKey,
        encoder.encode(testMessage)
      );
      
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        bobAESKey,
        encrypted
      );
      
      const decoder = new TextDecoder();
      expect(decoder.decode(decrypted)).toBe(testMessage);
    });

    it('should produce different keys for different sessions', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      
      const sharedSecret = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      
      const aesKey1 = await deriveAESKey(sharedSecret, 'session-1');
      const aesKey2 = await deriveAESKey(sharedSecret, 'session-2');
      
      // Keys should be different - test by trying to decrypt with wrong key
      const testMessage = 'Test message';
      const encoder = new TextEncoder();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey1,
        encoder.encode(testMessage)
      );
      
      // Decryption with different session key should fail
      await expect(
        crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          aesKey2,
          encrypted
        )
      ).rejects.toThrow();
    });
  });
});

// ============================================
// Fingerprint Tests
// ============================================

describe('ECDH Fingerprint', () => {
  describe('generateFingerprint()', () => {
    it('should generate 8-character hex fingerprint', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      
      const sharedSecret = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      
      const fingerprint = await generateFingerprint(sharedSecret);
      
      expect(fingerprint).toHaveLength(8);
      expect(fingerprint).toMatch(/^[0-9A-F]{8}$/);
    });

    it('should produce identical fingerprints for both parties', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      
      const aliceShared = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      
      const bobShared = await computeSharedSecret(
        bobKeyPair.privateKey,
        aliceKeyPair.publicKey
      );
      
      const aliceFingerprint = await generateFingerprint(aliceShared);
      const bobFingerprint = await generateFingerprint(bobShared);
      
      expect(aliceFingerprint).toBe(bobFingerprint);
    });

    it('should produce different fingerprints for different secrets', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      const charlieKeyPair = await generateKeyPair();
      
      const aliceBobShared = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      
      const aliceCharlieShared = await computeSharedSecret(
        aliceKeyPair.privateKey,
        charlieKeyPair.publicKey
      );
      
      const fp1 = await generateFingerprint(aliceBobShared);
      const fp2 = await generateFingerprint(aliceCharlieShared);
      
      expect(fp1).not.toBe(fp2);
    });

    it('should be consistent for same shared secret', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      
      const sharedSecret = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      
      const fp1 = await generateFingerprint(sharedSecret);
      const fp2 = await generateFingerprint(sharedSecret);
      
      expect(fp1).toBe(fp2);
    });
  });
});

// ============================================
// Utility Tests
// ============================================

describe('Utility Functions', () => {
  describe('isCryptoAvailable()', () => {
    it('should return true in Node.js/jsdom environment', () => {
      expect(isCryptoAvailable()).toBe(true);
    });
  });
});

// ============================================
// Full E2E Key Exchange Flow
// ============================================

describe('Full Key Exchange Flow', () => {
  it('should complete full ECDH key exchange between two parties', async () => {
    // 1. Alice generates her key pair
    const aliceKeyPair = await generateKeyPair();
    
    // 2. Bob generates his key pair
    const bobKeyPair = await generateKeyPair();
    
    // 3. Alice exports her public key
    const alicePublicKeyExported = await exportPublicKey(aliceKeyPair.publicKey);
    
    // 4. Bob exports his public key
    const bobPublicKeyExported = await exportPublicKey(bobKeyPair.publicKey);
    
    // 5. Alice imports Bob's public key
    const bobPublicKeyImported = await importPublicKey(bobPublicKeyExported);
    
    // 6. Bob imports Alice's public key
    const alicePublicKeyImported = await importPublicKey(alicePublicKeyExported);
    
    // 7. Alice computes shared secret
    const aliceSharedSecret = await computeSharedSecret(
      aliceKeyPair.privateKey,
      bobPublicKeyImported
    );
    
    // 8. Bob computes shared secret
    const bobSharedSecret = await computeSharedSecret(
      bobKeyPair.privateKey,
      alicePublicKeyImported
    );
    
    // 9. Both should have same fingerprint
    const aliceFingerprint = await generateFingerprint(aliceSharedSecret);
    const bobFingerprint = await generateFingerprint(bobSharedSecret);
    expect(aliceFingerprint).toBe(bobFingerprint);
    
    // 10. Derive AES keys for encryption
    const sessionId = 'session-e2e-test';
    const aliceAESKey = await deriveAESKey(aliceSharedSecret, sessionId);
    const bobAESKey = await deriveAESKey(bobSharedSecret, sessionId);
    
    // 11. Alice encrypts a message
    const originalMessage = 'Hello Bob! This is a secret message.';
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aliceAESKey,
      new TextEncoder().encode(originalMessage)
    );
    
    // 12. Bob decrypts the message
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      bobAESKey,
      ciphertext
    );
    
    const decryptedMessage = new TextDecoder().decode(decrypted);
    expect(decryptedMessage).toBe(originalMessage);
  });
});
