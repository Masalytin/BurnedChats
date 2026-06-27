/**
 * Unit tests for AES-256-GCM encryption module.
 * 
 * Tests cover:
 * - Basic encrypt/decrypt cycle
 * - Session-bound encryption
 * - Error handling for invalid inputs
 * - Validation helpers
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptMessage,
  decryptMessage,
  isValidAESKey,
  isValidIV,
  type EncryptedData,
} from './aes';
import { deriveAESKey, generateKeyPair, computeSharedSecret } from './ecdh';

// ============================================
// Test Fixtures
// ============================================

/** Generate a valid AES key for testing */
async function createTestKey(): Promise<CryptoKey> {
  // Generate key pair for ECDH
  const keyPair1 = await generateKeyPair();
  const keyPair2 = await generateKeyPair();
  
  // Compute shared secret
  const sharedSecret = await computeSharedSecret(
    keyPair1.privateKey,
    keyPair2.publicKey
  );
  
  // Derive AES key
  return deriveAESKey(sharedSecret, 'test-session-id');
}

/** Sample plaintexts for testing */
const TEST_MESSAGES = {
  simple: 'Hello, World!',
  unicode: 'Привет! 👋 こんにちは 🎉',
  empty: '',
  long: 'A'.repeat(10000),
  special: '<script>alert("xss")</script> \n\t\r\0',
};

// ============================================
// Basic Encryption/Decryption Tests
// ============================================

describe('AES-256-GCM Encryption', () => {
  let aesKey: CryptoKey;

  beforeAll(async () => {
    aesKey = await createTestKey();
  });

  describe('encrypt()', () => {
    it('should encrypt a simple message', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.simple);
      
      expect(encrypted).toHaveProperty('ciphertext');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
    });

    it('should produce Base64-encoded output', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.simple);
      
      // Base64 pattern check
      const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
      expect(encrypted.ciphertext).toMatch(base64Pattern);
      expect(encrypted.iv).toMatch(base64Pattern);
    });

    it('should generate unique IVs for each encryption', async () => {
      const encrypted1 = await encrypt(aesKey, TEST_MESSAGES.simple);
      const encrypted2 = await encrypt(aesKey, TEST_MESSAGES.simple);
      
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('should produce different ciphertexts for same plaintext', async () => {
      const encrypted1 = await encrypt(aesKey, TEST_MESSAGES.simple);
      const encrypted2 = await encrypt(aesKey, TEST_MESSAGES.simple);
      
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    it('should encrypt unicode messages', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.unicode);
      
      expect(encrypted.ciphertext).toBeTruthy();
    });

    it('should encrypt empty string', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.empty);
      
      expect(encrypted.ciphertext).toBeTruthy();
    });

    it('should encrypt long messages', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.long);
      
      expect(encrypted.ciphertext).toBeTruthy();
    });
  });

  describe('decrypt()', () => {
    it('should decrypt to original plaintext', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.simple);
      const decrypted = await decrypt(aesKey, encrypted.ciphertext, encrypted.iv);
      
      expect(decrypted).toBe(TEST_MESSAGES.simple);
    });

    it('should decrypt unicode messages correctly', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.unicode);
      const decrypted = await decrypt(aesKey, encrypted.ciphertext, encrypted.iv);
      
      expect(decrypted).toBe(TEST_MESSAGES.unicode);
    });

    it('should decrypt empty string', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.empty);
      const decrypted = await decrypt(aesKey, encrypted.ciphertext, encrypted.iv);
      
      expect(decrypted).toBe(TEST_MESSAGES.empty);
    });

    it('should decrypt long messages', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.long);
      const decrypted = await decrypt(aesKey, encrypted.ciphertext, encrypted.iv);
      
      expect(decrypted).toBe(TEST_MESSAGES.long);
    });

    it('should decrypt special characters', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.special);
      const decrypted = await decrypt(aesKey, encrypted.ciphertext, encrypted.iv);
      
      expect(decrypted).toBe(TEST_MESSAGES.special);
    });

    it('should fail with wrong key', async () => {
      const wrongKey = await createTestKey();
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.simple);
      
      await expect(
        decrypt(wrongKey, encrypted.ciphertext, encrypted.iv)
      ).rejects.toThrow();
    });

    it('should fail with wrong IV', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.simple);
      const wrongIV = 'AAAAAAAAAAAAAAAA'; // 12 bytes in Base64
      
      await expect(
        decrypt(aesKey, encrypted.ciphertext, wrongIV)
      ).rejects.toThrow();
    });

    it('should fail with tampered ciphertext', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.simple);
      
      // Decode, modify actual bytes, re-encode
      const ciphertextBytes = Uint8Array.from(
        atob(encrypted.ciphertext),
        c => c.charCodeAt(0)
      );
      // Flip bits in the middle of the ciphertext
      ciphertextBytes[Math.floor(ciphertextBytes.length / 2)] ^= 0xFF;
      
      const tamperedCiphertext = btoa(
        String.fromCharCode(...ciphertextBytes)
      );
      
      await expect(
        decrypt(aesKey, tamperedCiphertext, encrypted.iv)
      ).rejects.toThrow();
    });

    it('should fail with invalid Base64', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.simple);
      
      await expect(
        decrypt(aesKey, 'not-valid-base64!!!', encrypted.iv)
      ).rejects.toThrow('INVALID_CIPHERTEXT_ENCODING');
    });

    it('should throw domain error (not InvalidCharacterError) for undefined ciphertext', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.simple);

      await expect(
        decrypt(aesKey, undefined as unknown as string, encrypted.iv)
      ).rejects.toMatchObject({ message: 'INVALID_CIPHERTEXT_ENCODING' });

      await expect(
        decrypt(aesKey, undefined as unknown as string, encrypted.iv)
      ).rejects.not.toSatisfy(
        (error: unknown) => error instanceof DOMException && error.name === 'InvalidCharacterError'
      );
    });

    it('should throw domain error for empty ciphertext', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.simple);

      await expect(
        decrypt(aesKey, '', encrypted.iv)
      ).rejects.toThrow('INVALID_CIPHERTEXT_ENCODING');
    });

    it('should throw domain error for undefined IV', async () => {
      const encrypted = await encrypt(aesKey, TEST_MESSAGES.simple);

      await expect(
        decrypt(aesKey, encrypted.ciphertext, undefined as unknown as string)
      ).rejects.toThrow('INVALID_CIPHERTEXT_ENCODING');
    });
  });
});

// ============================================
// Session-Bound Encryption Tests
// ============================================

describe('Session-Bound Encryption', () => {
  let aesKey: CryptoKey;
  const sessionId = 'session-12345';

  beforeAll(async () => {
    aesKey = await createTestKey();
  });

  describe('encryptMessage() / decryptMessage()', () => {
    it('should encrypt and decrypt with session binding', async () => {
      const encrypted = await encryptMessage(aesKey, TEST_MESSAGES.simple, sessionId);
      const decrypted = await decryptMessage(aesKey, encrypted.ciphertext, encrypted.iv, sessionId);
      
      expect(decrypted).toBe(TEST_MESSAGES.simple);
    });

    it('should fail decryption with wrong session ID', async () => {
      const encrypted = await encryptMessage(aesKey, TEST_MESSAGES.simple, sessionId);
      
      await expect(
        decryptMessage(aesKey, encrypted.ciphertext, encrypted.iv, 'wrong-session')
      ).rejects.toThrow();
    });

    it('should prevent using message from different session', async () => {
      const sessionA = 'session-A';
      const sessionB = 'session-B';
      
      const encrypted = await encryptMessage(aesKey, TEST_MESSAGES.simple, sessionA);
      
      // Try to decrypt in different session - should fail
      await expect(
        decryptMessage(aesKey, encrypted.ciphertext, encrypted.iv, sessionB)
      ).rejects.toThrow();
    });
  });
});

// ============================================
// Validation Helpers Tests
// ============================================

describe('Validation Helpers', () => {
  describe('isValidAESKey()', () => {
    it('should return true for valid AES-GCM key', async () => {
      const aesKey = await createTestKey();
      
      expect(isValidAESKey(aesKey)).toBe(true);
    });

    it('should return false for ECDH key', async () => {
      const keyPair = await generateKeyPair();
      
      expect(isValidAESKey(keyPair.publicKey)).toBe(false);
      expect(isValidAESKey(keyPair.privateKey)).toBe(false);
    });
  });

  describe('isValidIV()', () => {
    it('should return true for valid IV (12 bytes)', async () => {
      const aesKey = await createTestKey();
      const encrypted = await encrypt(aesKey, 'test');
      
      expect(isValidIV(encrypted.iv)).toBe(true);
    });

    it('should return false for invalid IV length', () => {
      // Too short (8 bytes)
      expect(isValidIV('AAAAAAAAAAA=')).toBe(false);
      
      // Too long (16 bytes)
      expect(isValidIV('AAAAAAAAAAAAAAAAAAAAAA==')).toBe(false);
    });

    it('should return false for invalid Base64', () => {
      expect(isValidIV('not-valid-base64!!!')).toBe(false);
    });
  });
});

// ============================================
// Edge Cases & Security Tests
// ============================================

describe('Edge Cases & Security', () => {
  let aesKey: CryptoKey;

  beforeAll(async () => {
    aesKey = await createTestKey();
  });

  it('should handle multiple sequential encryptions', async () => {
    const results: EncryptedData[] = [];
    
    for (let i = 0; i < 100; i++) {
      results.push(await encrypt(aesKey, `Message ${i}`));
    }
    
    // All IVs should be unique
    const ivSet = new Set(results.map(r => r.iv));
    expect(ivSet.size).toBe(100);
  });

  it('should maintain data integrity across encrypt/decrypt cycles', async () => {
    const messages = [
      'Short',
      'Medium length message with some content',
      'A'.repeat(1000),
      JSON.stringify({ key: 'value', nested: { a: 1, b: 2 } }),
      'Binary-like: \x00\x01\x02\x03',
    ];

    for (const msg of messages) {
      const encrypted = await encrypt(aesKey, msg);
      const decrypted = await decrypt(aesKey, encrypted.ciphertext, encrypted.iv);
      expect(decrypted).toBe(msg);
    }
  });
});
