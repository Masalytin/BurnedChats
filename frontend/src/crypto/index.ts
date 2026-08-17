/**
 * Cryptography modules for BurnedChats E2EE.
 * 
 * Provides end-to-end encryption using:
 * - ECDH (P-256) for key exchange
 * - HKDF-SHA256 for key derivation
 * - AES-256-GCM for message encryption
 * - Secure in-memory key storage
 */

// ECDH key exchange
export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  computeSharedSecret,
  deriveAESKey,
  generateFingerprint,
  generateVisualFingerprint,
  hashSortedPublicKeys,
  formatSafetyNumber,
  FINGERPRINT_HASH_BYTES,
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

// Room password KDF (PBKDF2)
export {
  derivePasswordProof,
  validatePassword,
  type PasswordProofResult,
} from './kdf';

// Secure key storage
export {
  // Store operations
  storeKeyPair,
  storePeerPublicKey,
  storeSharedSecret,
  // Retrieve operations
  getSessionKeys,
  getKeyPair,
  getPeerPublicKey,
  getSharedSecret,
  getAESKey,
  resolveDecryptionKey,
  getFingerprint,
  isHandshakeComplete,
  hasSession,
  getActiveSessionIds,
  getSessionCount,
  // Group key operations (Rooms E2EE)
  storeGroupKey,
  getGroupKey,
  getGroupKeyEntry,
  getGroupKeyForEpoch,
  getGroupKeyEpochs,
  resolveDecryptionKeyForRoomMessage,
  hasGroupKey,
  getActiveGroupKeyRoomIds,
  burnGroupKey,
  burnAllGroupKeys,
  // Burn operations
  burn,
  burnAll,
  // Event handling
  addKeyStoreListener,
  removeKeyStoreListener,
  // Unload handler management
  removeUnloadHandler,
  isUnloadHandlerInstalled,
  // Debug
  getDebugInfo,
  // Types
  type SessionKeys,
  type RoomGroupKeyEntry,
  type ResolvedKey,
  type KeyStoreEventCallback,
  type KeyStoreEventType,
} from './keyStore';

// Group key crypto (Rooms E2EE)
export {
  generateGroupKey,
  wrapGroupKey,
  unwrapGroupKey,
} from './groupKey';

// File encryption (AES-256-GCM for files)
export {
  encryptFile,
  decryptFile,
  encryptFileMetadata,
  decryptFileMetadata,
  FILE_CHUNK_SIZE,
  FILE_CHUNKED_THRESHOLD,
  type EncryptedBlob,
  type FileMetaPlain,
} from './fileEncryption';
