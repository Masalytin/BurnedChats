/**
 * Password-based Key Derivation Function (KDF) for room passwords.
 *
 * Uses the Web Crypto API (PBKDF2 with SHA-256) to derive a fixed-length
 * "proof" from a plaintext password and a random salt.
 *
 * Security design:
 * - The plaintext password is NEVER sent to the server.
 * - Only (salt, proof) leave the device.
 * - The server stores hash(proof), adding another layer of protection.
 * - PBKDF2 parameters must match the backend (PasswordProofService.java):
 *     iterations: 200_000, hash: SHA-256, keyLength: 256 bits.
 *
 * Usage:
 *  // When creating a room:
 *  const { salt, proof } = await derivePasswordProof(password);
 *  // Send { salt, proof } via STOMP CREATE_ROOM
 *
 *  // When joining a room (salt comes from server):
 *  const { proof } = await derivePasswordProof(password, existingSalt);
 *  // Send { proof } via STOMP JOIN_BY_PASSWORD
 */

// ============================================
// Constants — must match backend PasswordProofService.java
// ============================================

const PBKDF2_ITERATIONS = 200_000;
const PROOF_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;

// ============================================
// Types
// ============================================

export interface PasswordProofResult {
  /** Base64-encoded random salt (16 bytes). */
  salt: string;
  /** Base64-encoded PBKDF2 output (32 bytes / 256 bits). */
  proof: string;
}

// ============================================
// Core functions
// ============================================

/**
 * Derive a password proof using PBKDF2/SHA-256.
 *
 * When creating a room, call without `existingSalt` to generate a fresh salt.
 * When joining a room, pass the salt received from the server.
 *
 * @param password     The user's plaintext password — never stored or sent.
 * @param existingSalt Optional Base64-encoded salt. If omitted, a new salt is generated.
 * @returns            `{ salt, proof }` — both Base64-encoded.
 *
 * @example
 * // Creating a room:
 * const { salt, proof } = await derivePasswordProof('my-secret');
 *
 * // Joining a room (salt fetched from server):
 * const { proof } = await derivePasswordProof('my-secret', serverSalt);
 */
export async function derivePasswordProof(
  password: string,
  existingSalt?: string
): Promise<PasswordProofResult> {
  const saltBuffer: ArrayBuffer = existingSalt
    ? base64ToArrayBuffer(existingSalt)
    : generateSalt();

  const keyMaterial = await importPasswordMaterial(password);

  const proofBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    PROOF_LENGTH_BITS
  );

  return {
    salt: arrayBufferToBase64(saltBuffer),
    proof: arrayBufferToBase64(proofBuffer),
  };
}

/**
 * Validate that a password meets the minimum security requirements:
 * - At least 8 characters.
 *
 * @param password the password to check
 * @returns an error message key, or null if the password is acceptable
 */
export function validatePassword(password: string): string | null {
  if (!password || password.length < 8) {
    return 'room.create.passwordTooShort';
  }
  return null;
}

// ============================================
// Internal helpers
// ============================================

/**
 * Generate a cryptographically random salt.
 */
function generateSalt(): ArrayBuffer {
  const salt = new Uint8Array(SALT_LENGTH_BYTES);
  crypto.getRandomValues(salt);
  return salt.buffer as ArrayBuffer;
}

/**
 * Import a password string as raw key material for PBKDF2.
 */
async function importPasswordMaterial(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
}

/**
 * Convert an ArrayBuffer or Uint8Array to a Base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert a Base64 string to an ArrayBuffer.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}
