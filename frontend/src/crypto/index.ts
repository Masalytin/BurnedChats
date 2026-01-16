/**
 * Cryptography modules for BurnedChats E2EE.
 * 
 * Provides end-to-end encryption using:
 * - ECDH (P-256) for key exchange
 * - HKDF-SHA256 for key derivation
 * - AES-256-GCM for message encryption
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

// AES-GCM encryption
export {
  encrypt,
  decrypt,
  encryptMessage,
  decryptMessage,
  isValidAESKey,
  isValidIV,
  type EncryptedData,
  type EncryptOptions,
  type DecryptOptions,
} from './aes';
