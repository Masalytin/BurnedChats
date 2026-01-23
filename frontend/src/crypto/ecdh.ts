/**
 * ECDH (Elliptic Curve Diffie-Hellman) key exchange module.
 * 
 * Uses the Web Crypto API with P-256 curve for secure key exchange.
 * This enables two parties to establish a shared secret over an insecure channel.
 * 
 * Security notes:
 * - P-256 (secp256r1) provides ~128-bit security level
 * - Keys are non-extractable by default for security
 * - All operations are performed in the browser's native crypto implementation
 */

import type { 
  KeyPair, 
  VisualFingerprintElement, 
  FingerprintShape, 
  FingerprintColor 
} from '@/types';

// ============================================
// Constants
// ============================================

/** ECDH algorithm parameters using P-256 curve */
const ECDH_ALGORITHM: EcKeyGenParams = {
  name: 'ECDH',
  namedCurve: 'P-256',
};

/** Key usage for ECDH key derivation */
const ECDH_KEY_USAGES: KeyUsage[] = ['deriveKey', 'deriveBits'];

/** Format for public key export/import (uncompressed point) */
const PUBLIC_KEY_FORMAT: 'spki' | 'raw' = 'spki';

// ============================================
// Key Generation
// ============================================

/**
 * Generates a new ECDH key pair for key exchange.
 * 
 * The private key is non-extractable for security - it never leaves
 * the Web Crypto subsystem. The public key can be exported and shared.
 * 
 * @returns A promise resolving to a KeyPair containing public and private CryptoKeys
 * @throws Error if key generation fails (e.g., Web Crypto not available)
 * 
 * @example
 * ```ts
 * const keyPair = await generateKeyPair();
 * const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);
 * // Send publicKeyBase64 to peer via server
 * ```
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const cryptoKeyPair = await crypto.subtle.generateKey(
    ECDH_ALGORITHM,
    false, // extractable = false for security (private key stays in crypto subsystem)
    ECDH_KEY_USAGES
  );

  return {
    publicKey: cryptoKeyPair.publicKey,
    privateKey: cryptoKeyPair.privateKey,
  };
}

// ============================================
// Key Export
// ============================================

/**
 * Exports a public key to Base64 string for transmission.
 * 
 * The exported format is SPKI (SubjectPublicKeyInfo), which is a
 * standard ASN.1 encoding that includes the algorithm identifier.
 * 
 * @param publicKey - The CryptoKey to export (must be a public key)
 * @returns Base64-encoded public key string
 * @throws Error if the key cannot be exported
 * 
 * @example
 * ```ts
 * const keyPair = await generateKeyPair();
 * const exported = await exportPublicKey(keyPair.publicKey);
 * // exported: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE..."
 * ```
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey(PUBLIC_KEY_FORMAT, publicKey);
  return arrayBufferToBase64(exported);
}

// ============================================
// Key Import
// ============================================

/**
 * Imports a peer's public key from Base64 string.
 * 
 * After importing, the key can be used with computeSharedSecret()
 * to derive a shared encryption key.
 * 
 * @param publicKeyBase64 - Base64-encoded public key from peer
 * @returns Imported CryptoKey ready for ECDH operations
 * @throws Error if the key format is invalid or import fails
 * 
 * @example
 * ```ts
 * // Receive peer's public key via server
 * const peerPublicKey = await importPublicKey(peerPublicKeyBase64);
 * const sharedSecret = await computeSharedSecret(myPrivateKey, peerPublicKey);
 * ```
 */
export async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const keyData = base64ToArrayBuffer(publicKeyBase64);
  
  return crypto.subtle.importKey(
    PUBLIC_KEY_FORMAT,
    keyData,
    ECDH_ALGORITHM,
    true, // extractable = true (it's already a public key)
    [] // No key usages needed for the imported public key (used in derivation via our private key)
  );
}

// ============================================
// Shared Secret Derivation
// ============================================

/**
 * Computes the shared secret using ECDH.
 * 
 * This combines our private key with the peer's public key to derive
 * raw shared bits. The result should be passed to deriveAESKey() for
 * proper key derivation using HKDF.
 * 
 * @param privateKey - Our ECDH private key
 * @param peerPublicKey - Peer's imported public key
 * @returns Raw shared secret as ArrayBuffer (256 bits for P-256)
 * @throws Error if derivation fails
 * 
 * @example
 * ```ts
 * const sharedBits = await computeSharedSecret(myKeyPair.privateKey, peerPublicKey);
 * const aesKey = await deriveAESKey(sharedBits, sessionId);
 * ```
 */
export async function computeSharedSecret(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: peerPublicKey,
    },
    privateKey,
    256 // P-256 produces 256 bits
  );
}

// ============================================
// Key Derivation (HKDF)
// ============================================

/**
 * Derives an AES-GCM key from the shared secret using HKDF.
 * 
 * HKDF (HMAC-based Key Derivation Function) is used to:
 * 1. Extract entropy from the ECDH shared secret
 * 2. Expand it into a cryptographically strong AES key
 * 
 * The session ID is used as salt to ensure each session gets a unique key,
 * even if the same key pairs are somehow reused.
 * 
 * @param sharedSecret - Raw shared secret from computeSharedSecret()
 * @param sessionId - Unique session identifier used as HKDF salt
 * @returns AES-GCM CryptoKey ready for encryption/decryption
 * @throws Error if key derivation fails
 * 
 * @example
 * ```ts
 * const sharedBits = await computeSharedSecret(privateKey, peerPublicKey);
 * const aesKey = await deriveAESKey(sharedBits, sessionId);
 * // Use aesKey with AES-GCM encrypt/decrypt functions
 * ```
 */
export async function deriveAESKey(
  sharedSecret: ArrayBuffer,
  sessionId: string
): Promise<CryptoKey> {
  // Import the shared secret as raw key material for HKDF
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    'HKDF',
    false,
    ['deriveKey']
  );

  // Use session ID as salt for domain separation
  const salt = new TextEncoder().encode(sessionId);
  
  // Application-specific info for HKDF
  const info = new TextEncoder().encode('BurnedChats-AES-GCM-Key');

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info,
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256, // 256-bit AES key
    },
    false, // Non-extractable for security
    ['encrypt', 'decrypt']
  );
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
// Verification Helpers
// ============================================

/**
 * Generates a visual fingerprint from the shared secret for verification.
 * 
 * This creates a short, human-readable code that users can compare
 * out-of-band (e.g., via voice call) to verify they have the same key
 * and are not subject to a MITM attack.
 * 
 * @param sharedSecret - The raw shared secret from ECDH
 * @returns 8-character hex fingerprint for visual comparison
 * 
 * @example
 * ```ts
 * const fingerprint = await generateFingerprint(sharedSecret);
 * // fingerprint: "A3B7C1D9"
 * // Both parties should see the same fingerprint
 * ```
 */
export async function generateFingerprint(sharedSecret: ArrayBuffer): Promise<string> {
  // Hash the shared secret to get a fixed-length fingerprint base
  const hash = await crypto.subtle.digest('SHA-256', sharedSecret);
  const hashArray = new Uint8Array(hash);
  
  // Take first 4 bytes and convert to uppercase hex
  const fingerprint = Array.from(hashArray.slice(0, 4))
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  
  return fingerprint;
}

// ============================================
// Visual Fingerprint
// ============================================

/** Available shapes for visual fingerprint display */
const FINGERPRINT_SHAPES: FingerprintShape[] = ['◆', '○', '□', '△', '⬡', '⬢'];

/** Available colors for visual fingerprint display */
const FINGERPRINT_COLORS: FingerprintColor[] = ['red', 'blue', 'green', 'purple', 'orange', 'cyan'];

/**
 * Generates a visual fingerprint from the shared secret.
 * 
 * Creates 4 colored geometric shapes that can be easily compared
 * by users to verify they have the same encryption key. This provides
 * protection against MITM attacks when users compare out-of-band.
 * 
 * The visual fingerprint uses a combination of:
 * - 6 shapes: ◆ ○ □ △ ⬡ ⬢
 * - 6 colors: red, blue, green, purple, orange, cyan
 * 
 * This gives 36^4 = 1,679,616 unique combinations, providing
 * sufficient protection against random collisions.
 * 
 * @param sharedSecret - The raw shared secret from ECDH
 * @returns Array of 4 VisualFingerprintElements (shape + color pairs)
 * 
 * @example
 * ```ts
 * const visual = await generateVisualFingerprint(sharedSecret);
 * // visual: [
 * //   { shape: '◆', color: 'red' },
 * //   { shape: '○', color: 'blue' },
 * //   { shape: '□', color: 'green' },
 * //   { shape: '△', color: 'purple' }
 * // ]
 * // Both parties should see the same 4 colored shapes
 * ```
 */
export async function generateVisualFingerprint(
  sharedSecret: ArrayBuffer
): Promise<VisualFingerprintElement[]> {
  // Hash the shared secret to get deterministic bytes
  const hash = await crypto.subtle.digest('SHA-256', sharedSecret);
  const bytes = new Uint8Array(hash);
  
  const elements: VisualFingerprintElement[] = [];
  
  // Generate 4 elements, using 2 bytes each (one for shape, one for color)
  for (let i = 0; i < 4; i++) {
    const shapeIndex = bytes[i * 2] % FINGERPRINT_SHAPES.length;
    const colorIndex = bytes[i * 2 + 1] % FINGERPRINT_COLORS.length;
    
    elements.push({
      shape: FINGERPRINT_SHAPES[shapeIndex],
      color: FINGERPRINT_COLORS[colorIndex],
    });
  }
  
  return elements;
}

/**
 * Checks if Web Crypto API is available in the current environment.
 * 
 * @returns true if crypto operations are supported
 */
export function isCryptoAvailable(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.subtle.generateKey === 'function'
  );
}
