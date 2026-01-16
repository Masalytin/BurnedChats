/**
 * Cryptography modules for BurnedChats E2EE.
 * 
 * Provides end-to-end encryption using:
 * - ECDH (P-256) for key exchange
 * - HKDF-SHA256 for key derivation
 * - AES-256-GCM for message encryption (see aes.ts)
 */

// ECDH key exchange
export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  computeSharedSecret,
  deriveAESKey,
  generateFingerprint,
  isCryptoAvailable,
} from './ecdh';
