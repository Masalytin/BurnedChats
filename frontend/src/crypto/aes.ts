/**
 * AES-256-GCM encryption module for BurnedChats.
 * 
 * Provides authenticated encryption using AES-GCM (Galois/Counter Mode).
 * This ensures both confidentiality and integrity of encrypted messages.
 * 
 * Security notes:
 * - AES-256 provides 256-bit key strength
 * - GCM mode provides authenticated encryption (AEAD)
 * - Each message uses a unique 96-bit (12 byte) IV
 * - 128-bit authentication tag is appended to ciphertext
 */

// ============================================
// Constants
// ============================================

/** AES-GCM algorithm identifier */
const AES_ALGORITHM = 'AES-GCM';

/** 
 * IV (Initialization Vector) length in bytes.
 * NIST recommends 96 bits (12 bytes) for GCM mode.
 */
const IV_LENGTH_BYTES = 12;

/**
 * Authentication tag length in bits.
 * 128 bits provides strong integrity protection.
 */
const TAG_LENGTH_BITS = 128;

// ============================================
// Types
// ============================================

/**
 * Result of encryption operation.
 * Contains the ciphertext and IV needed for decryption.
 */
export interface EncryptedData {
  /** Base64-encoded ciphertext (includes auth tag) */
  ciphertext: string;
  /** Base64-encoded initialization vector */
  iv: string;
}

/**
 * Options for encryption.
 */
export interface EncryptOptions {
  /** Optional additional authenticated data (AAD) - not encrypted but authenticated */
  additionalData?: string;
}

/**
 * Options for decryption.
 */
export interface DecryptOptions {
  /** Optional additional authenticated data (must match encryption) */
  additionalData?: string;
}

// ============================================
// Encryption
// ============================================

/**
 * Encrypts a plaintext message using AES-256-GCM.
 * 
 * Generates a cryptographically random IV for each message to ensure
 * that identical plaintexts produce different ciphertexts. The IV is
 * returned separately and must be transmitted along with the ciphertext.
 * 
 * @param key - AES-GCM CryptoKey (from deriveAESKey)
 * @param plaintext - The message to encrypt
 * @param options - Optional encryption settings
 * @returns EncryptedData with Base64-encoded ciphertext and IV
 * @throws Error if encryption fails
 * 
 * @example
 * ```ts
 * const aesKey = await deriveAESKey(sharedSecret, sessionId);
 * const encrypted = await encrypt(aesKey, "Hello, World!");
 * // Send encrypted.ciphertext and encrypted.iv to peer
 * ```
 */
export async function encrypt(
  key: CryptoKey,
  plaintext: string,
  options: EncryptOptions = {}
): Promise<EncryptedData> {
  // Generate a random IV for this message
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  
  // Encode plaintext to bytes
  const plaintextBytes = new TextEncoder().encode(plaintext);
  
  // Prepare algorithm parameters
  const algorithmParams: AesGcmParams = {
    name: AES_ALGORITHM,
    iv,
    tagLength: TAG_LENGTH_BITS,
  };

  // Add AAD if provided (used for session binding)
  if (options.additionalData) {
    algorithmParams.additionalData = new TextEncoder().encode(options.additionalData);
  }
  
  // Perform encryption
  const ciphertextBuffer = await crypto.subtle.encrypt(
    algorithmParams,
    key,
    plaintextBytes
  );
  
  return {
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

// ============================================
// Decryption
// ============================================

/**
 * Decrypts an AES-256-GCM encrypted message.
 * 
 * Verifies the authentication tag to ensure the message hasn't been
 * tampered with. If verification fails, an error is thrown.
 * 
 * @param key - AES-GCM CryptoKey (from deriveAESKey)
 * @param ciphertext - Base64-encoded ciphertext
 * @param iv - Base64-encoded initialization vector used during encryption
 * @param options - Optional decryption settings
 * @returns Decrypted plaintext string
 * @throws Error if decryption or authentication fails
 * 
 * @example
 * ```ts
 * const aesKey = await deriveAESKey(sharedSecret, sessionId);
 * const plaintext = await decrypt(aesKey, encrypted.ciphertext, encrypted.iv);
 * console.log(plaintext); // "Hello, World!"
 * ```
 */
export async function decrypt(
  key: CryptoKey,
  ciphertext: string,
  iv: string,
  options: DecryptOptions = {}
): Promise<string> {
  // Decode Base64 inputs
  const ciphertextBytes = base64ToArrayBuffer(ciphertext);
  const ivBytes = base64ToArrayBuffer(iv);
  
  // Prepare algorithm parameters
  const algorithmParams: AesGcmParams = {
    name: AES_ALGORITHM,
    iv: ivBytes,
    tagLength: TAG_LENGTH_BITS,
  };

  // Add AAD if provided (must match encryption)
  if (options.additionalData) {
    algorithmParams.additionalData = new TextEncoder().encode(options.additionalData);
  }
  
  // Perform decryption (throws if authentication fails)
  const plaintextBuffer = await crypto.subtle.decrypt(
    algorithmParams,
    key,
    ciphertextBytes
  );
  
  // Decode bytes to string
  return new TextDecoder().decode(plaintextBuffer);
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Encrypts a message with session binding.
 * 
 * Uses the session ID as additional authenticated data (AAD) to bind
 * the ciphertext to a specific session. This prevents replay attacks
 * where an attacker tries to use a message from one session in another.
 * 
 * @param key - AES-GCM CryptoKey
 * @param plaintext - Message to encrypt
 * @param sessionId - Session identifier for binding
 * @returns EncryptedData with session-bound ciphertext
 * 
 * @example
 * ```ts
 * const encrypted = await encryptMessage(aesKey, "Secret message", sessionId);
 * ```
 */
export async function encryptMessage(
  key: CryptoKey,
  plaintext: string,
  sessionId: string
): Promise<EncryptedData> {
  return encrypt(key, plaintext, { additionalData: sessionId });
}

/**
 * Decrypts a session-bound message.
 * 
 * @param key - AES-GCM CryptoKey
 * @param ciphertext - Base64-encoded ciphertext
 * @param iv - Base64-encoded IV
 * @param sessionId - Session identifier (must match encryption)
 * @returns Decrypted plaintext
 * @throws Error if session ID doesn't match or message is tampered
 * 
 * @example
 * ```ts
 * const plaintext = await decryptMessage(aesKey, ciphertext, iv, sessionId);
 * ```
 */
export async function decryptMessage(
  key: CryptoKey,
  ciphertext: string,
  iv: string,
  sessionId: string
): Promise<string> {
  return decrypt(key, ciphertext, iv, { additionalData: sessionId });
}

// ============================================
// Utility Functions
// ============================================

/**
 * Converts an ArrayBuffer to a Base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts a Base64 string to an ArrayBuffer.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ============================================
// Validation Helpers
// ============================================

/**
 * Checks if a key is valid for AES-GCM operations.
 * 
 * @param key - CryptoKey to validate
 * @returns true if key can be used for AES-GCM encryption/decryption
 */
export function isValidAESKey(key: CryptoKey): boolean {
  return (
    key.algorithm.name === AES_ALGORITHM &&
    (key.usages.includes('encrypt') || key.usages.includes('decrypt'))
  );
}

/**
 * Validates that an IV has the correct length.
 * 
 * @param ivBase64 - Base64-encoded IV to validate
 * @returns true if IV is valid for AES-GCM
 */
export function isValidIV(ivBase64: string): boolean {
  try {
    const ivBytes = base64ToArrayBuffer(ivBase64);
    return ivBytes.byteLength === IV_LENGTH_BYTES;
  } catch {
    return false;
  }
}
