/**
 * Group key management for BurnedChats Rooms (E2EE).
 *
 * Implements the Shared Group Key protocol (P2-3.1.1):
 * - AES-256-GCM symmetric group key per room
 * - ECIES-like wrap/unwrap: ECDH ephemeral + HKDF-SHA256 + AES-GCM
 * - extractable=true so the owner can re-wrap the key for new members
 *
 * Reference: docs/phases/phase-2-rooms/GROUP_KEY_PROTOCOL.md
 */

import type { KeyBundle } from '@/types';

// ============================================
// Constants
// ============================================

const HKDF_SALT_STRING = 'BurnedChats-KeyWrap-v1';

// ============================================
// Utilities
// ============================================

function toBase64(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ============================================
// Key Generation
// ============================================

/**
 * Generates a new AES-256-GCM group key for a room.
 *
 * The key is extractable=true so the owner can wrap it for new members.
 * It lives only in memory (keyStore) — never persisted.
 *
 * @returns AES-256-GCM CryptoKey (extractable, encrypt/decrypt)
 */
export async function generateGroupKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can wrapKey for peers
    ['encrypt', 'decrypt']
  );
}

// ============================================
// Key Wrapping (Owner → New Member)
// ============================================

/**
 * Encrypts the group key for a specific peer (ECIES-like scheme).
 *
 * Steps:
 *  1. Generate ephemeral ECDH key pair
 *  2. Derive shared bits: ECDH(ephemeral.private, peer.public)
 *  3. Derive wrap key: HKDF(sharedBits, salt='BurnedChats-KeyWrap-v1')
 *  4. Wrap group key with AES-GCM
 *  5. Return KeyBundle (ephemeralPublicKey + encryptedKey + iv)
 *
 * @param groupKey - AES-256-GCM group key (must be extractable)
 * @param peerPublicKey - Recipient's ECDH P-256 public key (CryptoKey)
 * @param recipientTgId - Telegram ID of the recipient (for bundle identification)
 * @param roomId - Room identifier
 * @param epoch - Current key epoch (starts at 0)
 * @returns KeyBundle to send via STOMP to the recipient
 */
export async function wrapGroupKey(
  groupKey: CryptoKey,
  peerPublicKey: CryptoKey,
  recipientTgId: string,
  roomId: string,
  epoch: number
): Promise<KeyBundle> {
  // 1. Ephemeral ECDH key pair
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // public key must be exportable
    ['deriveKey', 'deriveBits']
  );

  // 2. ECDH shared bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    ephemeral.privateKey,
    256
  );

  // 3. HKDF → wrap key (AES-GCM, wrapKey usage)
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey']
  );
  const wrapKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(HKDF_SALT_STRING),
      info: new Uint8Array(0),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey']
  );

  // 4. Wrap group key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await crypto.subtle.wrapKey(
    'raw',
    groupKey,
    wrapKey,
    { name: 'AES-GCM', iv }
  );

  // 5. Export ephemeral public key in raw format (65 bytes, P-256 uncompressed)
  const ephemeralPubRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey);

  return {
    roomId,
    epoch,
    recipientTgId,
    ephemeralPublicKey: toBase64(ephemeralPubRaw),
    encryptedKey: toBase64(wrappedKey),
    iv: toBase64(iv),
  };
}

// ============================================
// Key Unwrapping (New Member)
// ============================================

/**
 * Decrypts the group key from a KeyBundle received via STOMP.
 *
 * Steps:
 *  1. Import ephemeral public key from bundle (raw format)
 *  2. Derive shared bits: ECDH(my.private, ephemeral.public)
 *  3. Derive unwrap key: HKDF(sharedBits, salt='BurnedChats-KeyWrap-v1')
 *  4. Unwrap group key with AES-GCM
 *
 * The resulting key is non-extractable (stored only for encrypt/decrypt).
 *
 * @param bundle - KeyBundle received from the server
 * @param myPrivateKey - Our ECDH P-256 private key
 * @returns AES-256-GCM CryptoKey (non-extractable, encrypt/decrypt)
 */
export async function unwrapGroupKey(
  bundle: KeyBundle,
  myPrivateKey: CryptoKey
): Promise<CryptoKey> {
  // 1. Import ephemeral public key from raw bytes
  const ephemeralPub = await crypto.subtle.importKey(
    'raw',
    fromBase64(bundle.ephemeralPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // 2. ECDH shared bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPub },
    myPrivateKey,
    256
  );

  // 3. HKDF → unwrap key (AES-GCM, unwrapKey usage)
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey']
  );
  const unwrapKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(HKDF_SALT_STRING),
      info: new Uint8Array(0),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['unwrapKey']
  );

  // 4. Unwrap group key (non-extractable for message encryption)
  return crypto.subtle.unwrapKey(
    'raw',
    fromBase64(bundle.encryptedKey),
    unwrapKey,
    { name: 'AES-GCM', iv: fromBase64(bundle.iv) },
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable when used for messages
    ['encrypt', 'decrypt']
  );
}
