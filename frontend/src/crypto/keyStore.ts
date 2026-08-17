/**
 * Secure Key Storage module for BurnedChats.
 * 
 * Provides in-memory storage for cryptographic keys with secure destruction.
 * Keys are NEVER persisted to localStorage, IndexedDB, or any other persistent storage.
 * 
 * Security features:
 * - Keys stored only in memory (volatile)
 * - Secure burn() with memory overwriting
 * - Automatic cleanup on page unload
 * - Session isolation (keys indexed by sessionId)
 * 
 * WARNING: This module stores sensitive cryptographic material.
 * Always call burn() or burnAll() when sessions end.
 */

import type { KeyPair, SharedSecret } from '@/types';
import { decryptMessage } from '@/crypto/aes';
import { clearHiddenMessagesStorage } from '@/utils/hiddenMessagesStorage';

// ============================================
// Background burn configuration (IMP-AUDIT-10)
// ============================================

/**
 * Delay before wiping in-memory keys when the Mini App stays in the background.
 * Single source of truth for the security vs UX trade-off (see decision log).
 */
export const BACKGROUND_BURN_THRESHOLD_MS = 45_000;

/** Why {@link burnAll} was last invoked. */
export type BurnAllReason = 'manual' | 'page_unload' | 'background_timeout';

// ============================================
// Types
// ============================================

/**
 * Complete cryptographic state for a session.
 * Contains all keys needed for E2EE communication.
 */
export interface SessionKeys {
  /** Session identifier */
  sessionId: string;
  /** Our ECDH key pair for this session */
  keyPair: KeyPair;
  /** Peer's public key (after handshake) */
  peerPublicKey?: CryptoKey;
  /** Shared secret and derived AES key (after handshake) */
  sharedSecret?: SharedSecret;
  /** Raw shared secret bytes for fingerprint regeneration */
  rawSharedSecret?: ArrayBuffer;
  /** Timestamp when keys were created */
  createdAt: number;
}

/**
 * Callback for key events.
 */
export type KeyStoreEventCallback = (sessionId: string, eventType: KeyStoreEventType) => void;

/**
 * Key store event types.
 */
export type KeyStoreEventType = 'stored' | 'updated' | 'burned' | 'burned_all';

// ============================================
// Internal Storage
// ============================================

/**
 * In-memory key storage.
 * Uses Map for O(1) access and easy iteration for cleanup.
 */
const keyStore = new Map<string, SessionKeys>();

/**
 * Event listeners for key store changes.
 */
const eventListeners = new Set<KeyStoreEventCallback>();

/**
 * Flag to track if beforeunload handler is installed.
 */
let unloadHandlerInstalled = false;

/** Tracks the most recent {@link burnAll} reason (cleared on next burnAll). */
let lastBurnAllReason: BurnAllReason | null = null;

// ============================================
// Store Operations
// ============================================

/**
 * Stores a new key pair for a session.
 * 
 * Called when initiating or accepting a chat request.
 * The key pair is used for ECDH key exchange.
 * 
 * @param sessionId - Unique session identifier
 * @param keyPair - ECDH key pair to store
 * @throws Error if sessionId is empty or keyPair is invalid
 * 
 * @example
 * ```ts
 * const keyPair = await generateKeyPair();
 * storeKeyPair(sessionId, keyPair);
 * ```
 */
export function storeKeyPair(sessionId: string, keyPair: KeyPair): void {
  validateSessionId(sessionId);
  
  if (!keyPair || !keyPair.publicKey || !keyPair.privateKey) {
    throw new Error('Invalid key pair: both public and private keys are required');
  }

  const existing = keyStore.get(sessionId);
  
  if (existing) {
    // Update existing entry
    existing.keyPair = keyPair;
    existing.createdAt = Date.now();
    notifyListeners(sessionId, 'updated');
  } else {
    // Create new entry
    keyStore.set(sessionId, {
      sessionId,
      keyPair,
      createdAt: Date.now(),
    });
    notifyListeners(sessionId, 'stored');
  }

  // Ensure cleanup handler is installed
  installUnloadHandler();
}

/**
 * Stores the peer's public key after receiving it during handshake.
 * 
 * @param sessionId - Session identifier
 * @param peerPublicKey - Peer's imported public key
 * @throws Error if session doesn't exist or key is invalid
 * 
 * @example
 * ```ts
 * const peerKey = await importPublicKey(peerPublicKeyBase64);
 * storePeerPublicKey(sessionId, peerKey);
 * ```
 */
export function storePeerPublicKey(sessionId: string, peerPublicKey: CryptoKey): void {
  validateSessionId(sessionId);
  
  const session = keyStore.get(sessionId);
  if (!session) {
    throw new Error(`No keys found for session: ${sessionId}`);
  }

  if (!peerPublicKey) {
    throw new Error('Invalid peer public key');
  }

  session.peerPublicKey = peerPublicKey;
  notifyListeners(sessionId, 'updated');
}

/**
 * Stores the shared secret after ECDH computation.
 * 
 * This includes the derived AES key for message encryption.
 * 
 * @param sessionId - Session identifier
 * @param sharedSecret - Shared secret with AES key and fingerprint
 * @param rawSecret - Raw ECDH shared secret bytes (for fingerprint regeneration)
 * @throws Error if session doesn't exist
 * 
 * @example
 * ```ts
 * const rawSecret = await computeSharedSecret(privateKey, peerPublicKey);
 * const aesKey = await deriveAESKey(rawSecret, sessionId);
 * const fingerprint = await generateFingerprint(rawSecret);
 * 
 * storeSharedSecret(sessionId, { sessionId, key: aesKey, fingerprint }, rawSecret);
 * ```
 */
export function storeSharedSecret(
  sessionId: string,
  sharedSecret: SharedSecret,
  rawSecret?: ArrayBuffer
): void {
  validateSessionId(sessionId);
  
  const session = keyStore.get(sessionId);
  if (!session) {
    throw new Error(`No keys found for session: ${sessionId}`);
  }

  session.sharedSecret = sharedSecret;
  if (rawSecret) {
    // Clone the ArrayBuffer to prevent external modifications
    session.rawSharedSecret = rawSecret.slice(0);
  }
  notifyListeners(sessionId, 'updated');
}

// ============================================
// Retrieve Operations
// ============================================

/**
 * Retrieves all keys for a session.
 * 
 * @param sessionId - Session identifier
 * @returns SessionKeys or undefined if not found
 * 
 * @example
 * ```ts
 * const keys = getSessionKeys(sessionId);
 * if (keys?.sharedSecret) {
 *   // Ready for encrypted communication
 * }
 * ```
 */
export function getSessionKeys(sessionId: string): SessionKeys | undefined {
  return keyStore.get(sessionId);
}

/**
 * Retrieves the key pair for a session.
 * 
 * @param sessionId - Session identifier
 * @returns KeyPair or undefined if not found
 */
export function getKeyPair(sessionId: string): KeyPair | undefined {
  return keyStore.get(sessionId)?.keyPair;
}

/**
 * Retrieves the peer's public key for a session.
 * 
 * @param sessionId - Session identifier
 * @returns CryptoKey or undefined if not found/not yet received
 */
export function getPeerPublicKey(sessionId: string): CryptoKey | undefined {
  return keyStore.get(sessionId)?.peerPublicKey;
}

/**
 * Retrieves the shared secret (AES key) for a session.
 * 
 * @param sessionId - Session identifier
 * @returns SharedSecret or undefined if handshake not complete
 */
export function getSharedSecret(sessionId: string): SharedSecret | undefined {
  return keyStore.get(sessionId)?.sharedSecret;
}

/**
 * Retrieves just the AES key for encryption/decryption.
 * 
 * @param sessionId - Session identifier
 * @returns CryptoKey or undefined if handshake not complete
 */
export function getAESKey(sessionId: string): CryptoKey | undefined {
  return keyStore.get(sessionId)?.sharedSecret?.key;
}

/**
 * Retrieves the visual fingerprint for verification.
 * 
 * @param sessionId - Session identifier
 * @returns Fingerprint string or undefined if handshake not complete
 */
export function getFingerprint(sessionId: string): string | undefined {
  return keyStore.get(sessionId)?.sharedSecret?.fingerprint;
}

/**
 * Checks if a session has completed handshake.
 * 
 * @param sessionId - Session identifier
 * @returns true if session has shared secret and is ready for encrypted messages
 */
export function isHandshakeComplete(sessionId: string): boolean {
  const session = keyStore.get(sessionId);
  return !!(session?.sharedSecret?.key);
}

/**
 * Checks if a session exists in the store.
 * 
 * @param sessionId - Session identifier
 * @returns true if session keys exist
 */
export function hasSession(sessionId: string): boolean {
  return keyStore.has(sessionId);
}

/**
 * Gets all active session IDs.
 * 
 * @returns Array of session IDs
 */
export function getActiveSessionIds(): string[] {
  return Array.from(keyStore.keys());
}

/**
 * Gets the number of active sessions.
 * 
 * @returns Number of sessions with stored keys
 */
export function getSessionCount(): number {
  return keyStore.size;
}

// ============================================
// Burn Operations (Secure Destruction)
// ============================================

/**
 * Securely destroys all keys for a session.
 * 
 * This function performs secure destruction by:
 * 1. Overwriting ArrayBuffer contents with zeros
 * 2. Nullifying all object references
 * 3. Removing from the store
 * 
 * Note: CryptoKey objects cannot be directly overwritten as they are
 * managed by the browser's crypto subsystem. However, they become
 * unreachable and will be garbage collected.
 * 
 * @param sessionId - Session identifier to burn
 * @returns true if session was found and burned, false if not found
 * 
 * @example
 * ```ts
 * // When user ends chat or presses burn button
 * burn(sessionId);
 * ```
 */
export function burn(sessionId: string): boolean {
  const session = keyStore.get(sessionId);
  if (!session) {
    return false;
  }

  // Securely wipe the raw shared secret (ArrayBuffer can be overwritten)
  if (session.rawSharedSecret) {
    secureWipeArrayBuffer(session.rawSharedSecret);
  }

  // Nullify all references to allow garbage collection
  // @ts-expect-error - Intentionally setting to undefined for secure cleanup (keyPair is required)
  session.keyPair = undefined;
  session.peerPublicKey = undefined;
  session.sharedSecret = undefined;
  session.rawSharedSecret = undefined;

  // Remove from store
  keyStore.delete(sessionId);

  clearHiddenMessagesStorage('dm', sessionId);
  
  notifyListeners(sessionId, 'burned');
  
  return true;
}

/**
 * Securely destroys ALL stored keys.
 * 
 * Called on page unload or when user logs out.
 * Iterates through all sessions and burns each one.
 * 
 * @example
 * ```ts
 * // On logout or app close
 * burnAll();
 * ```
 */
/**
 * Returns the reason for the most recent {@link burnAll} call.
 */
export function getLastBurnAllReason(): BurnAllReason | null {
  return lastBurnAllReason;
}

export function burnAll(reason: BurnAllReason = 'manual'): void {
  lastBurnAllReason = reason;
  const sessionIds = Array.from(keyStore.keys());
  
  for (const sessionId of sessionIds) {
    burn(sessionId);
  }

  // Double-check the store is empty
  keyStore.clear();

  // Also wipe all room group keys
  burnAllGroupKeys();
  
  // Notify listeners (use empty string to indicate all sessions)
  notifyListeners('', 'burned_all');
}

// ============================================
// Page Unload Handler
// ============================================

/**
 * Handler for page unload events.
 * Automatically burns all keys when page is closed/refreshed.
 */
function handlePageUnload(): void {
  burnAll('page_unload');
}

/**
 * Installs the beforeunload handler if not already installed.
 * Called automatically when first key is stored.
 */
function installUnloadHandler(): void {
  if (unloadHandlerInstalled) {
    return;
  }

  if (typeof window !== 'undefined') {
    // Use both events for better browser coverage
    window.addEventListener('beforeunload', handlePageUnload);
    window.addEventListener('unload', handlePageUnload);
    
    unloadHandlerInstalled = true;
  }
}

/**
 * Removes the beforeunload handler.
 * Call this for testing or when you want to disable auto-cleanup.
 */
export function removeUnloadHandler(): void {
  if (typeof window !== 'undefined' && unloadHandlerInstalled) {
    window.removeEventListener('beforeunload', handlePageUnload);
    window.removeEventListener('unload', handlePageUnload);
    unloadHandlerInstalled = false;
  }
}

/**
 * Checks if the unload handler is currently installed.
 * 
 * @returns true if handler is active
 */
export function isUnloadHandlerInstalled(): boolean {
  return unloadHandlerInstalled;
}

// ============================================
// Event Listeners
// ============================================

/**
 * Adds a listener for key store events.
 * 
 * @param callback - Function to call on key store changes
 * @returns Unsubscribe function
 * 
 * @example
 * ```ts
 * const unsubscribe = addKeyStoreListener((sessionId, event) => {
 *   console.log(`Session ${sessionId}: ${event}`);
 * });
 * 
 * // Later:
 * unsubscribe();
 * ```
 */
export function addKeyStoreListener(callback: KeyStoreEventCallback): () => void {
  eventListeners.add(callback);
  return () => eventListeners.delete(callback);
}

/**
 * Removes a listener for key store events.
 * 
 * @param callback - The callback to remove
 */
export function removeKeyStoreListener(callback: KeyStoreEventCallback): void {
  eventListeners.delete(callback);
}

// ============================================
// Internal Utilities
// ============================================

/**
 * Validates a session ID.
 * @throws Error if sessionId is invalid
 */
function validateSessionId(sessionId: string): void {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new Error('Invalid session ID: must be a non-empty string');
  }
}

/**
 * Notifies all listeners of a key store event.
 */
function notifyListeners(sessionId: string, eventType: KeyStoreEventType): void {
  for (const listener of eventListeners) {
    try {
      listener(sessionId, eventType);
    } catch (error) {
      // Don't let listener errors break the key store
      console.error('Key store listener error:', error);
    }
  }
}

/**
 * Securely wipes an ArrayBuffer by overwriting with zeros.
 * 
 * This provides defense-in-depth against memory scraping attacks.
 * While JavaScript doesn't guarantee memory handling, this makes
 * the sensitive data harder to recover.
 */
function secureWipeArrayBuffer(buffer: ArrayBuffer): void {
  try {
    const view = new Uint8Array(buffer);
    
    // First pass: overwrite with zeros
    view.fill(0);
    
    // Second pass: overwrite with ones (helps detect incomplete wipes)
    view.fill(0xFF);
    
    // Third pass: final zeros
    view.fill(0);
    
    // Additional passes with random data for extra security
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(view);
      view.fill(0);
    }
  } catch {
    // Buffer might already be detached or invalid
    // This is fine - it means the data is already inaccessible
  }
}

// ============================================
// Group Key Storage (Rooms E2EE)
// ============================================

/**
 * Cryptographic state for a room's group key at a specific epoch.
 */
export interface RoomGroupKeyEntry {
  roomId: string;
  epoch: number;
  key: CryptoKey;
  createdAt: number;
}

/** Per-room multi-epoch group key bucket (latest epoch used for encryption). */
interface RoomGroupKeyBucket {
  roomId: string;
  latestEpoch: number;
  epochs: Map<number, RoomGroupKeyEntry>;
}

/** In-memory group key store (roomId → epoch map). */
const groupKeyStore = new Map<string, RoomGroupKeyBucket>();

function getRoomBucket(roomId: string): RoomGroupKeyBucket | undefined {
  return groupKeyStore.get(roomId);
}

function getOrCreateRoomBucket(roomId: string): RoomGroupKeyBucket {
  let bucket = groupKeyStore.get(roomId);
  if (!bucket) {
    bucket = { roomId, latestEpoch: -1, epochs: new Map() };
    groupKeyStore.set(roomId, bucket);
  }
  return bucket;
}

/**
 * Stores the group key for a room epoch.
 *
 * Retains previously stored epoch keys so sync can decrypt historical ciphertext
 * until wire metadata includes per-message `keyEpoch` (IMP-WFT-04).
 *
 * @param roomId - Room identifier
 * @param epoch - Key epoch (0 for initial key, incremented on rekey)
 * @param key - AES-256-GCM CryptoKey
 */
export function storeGroupKey(roomId: string, epoch: number, key: CryptoKey): void {
  validateSessionId(roomId);
  const bucket = getOrCreateRoomBucket(roomId);
  bucket.epochs.set(epoch, { roomId, epoch, key, createdAt: Date.now() });
  if (epoch >= bucket.latestEpoch) {
    bucket.latestEpoch = epoch;
  }
  notifyListeners(roomId, 'updated');
}

/**
 * Retrieves the stored group key entry for a room (latest epoch).
 *
 * @param roomId - Room identifier
 * @returns RoomGroupKeyEntry or undefined if not found
 */
export function getGroupKeyEntry(roomId: string): RoomGroupKeyEntry | undefined {
  const bucket = getRoomBucket(roomId);
  if (!bucket || bucket.latestEpoch < 0) return undefined;
  return bucket.epochs.get(bucket.latestEpoch);
}

/**
 * Retrieves the AES CryptoKey for a specific room epoch.
 */
export function getGroupKeyForEpoch(roomId: string, epoch: number): CryptoKey | undefined {
  return getRoomBucket(roomId)?.epochs.get(epoch)?.key;
}

/**
 * Returns all stored epoch numbers for a room, newest first.
 */
export function getGroupKeyEpochs(roomId: string): number[] {
  const bucket = getRoomBucket(roomId);
  if (!bucket) return [];
  return Array.from(bucket.epochs.keys()).sort((a, b) => b - a);
}

/**
 * Retrieves only the AES CryptoKey for a room (latest epoch).
 *
 * @param roomId - Room identifier
 * @returns CryptoKey or undefined if not found
 */
export function getGroupKey(roomId: string): CryptoKey | undefined {
  return getGroupKeyEntry(roomId)?.key;
}

/**
 * Attempts room message decryption by trying each stored epoch key (newest first).
 * Wire messages lack `keyEpoch`, so this is a temporary O(epochs) fallback.
 */
export async function resolveDecryptionKeyForRoomMessage(
  roomId: string,
  encryptedContent: string,
  iv: string,
): Promise<string> {
  const epochs = getGroupKeyEpochs(roomId);
  if (epochs.length === 0) {
    throw new Error(`No group keys for room ${roomId}`);
  }

  let lastError: unknown;
  for (const epoch of epochs) {
    const key = getGroupKeyForEpoch(roomId, epoch);
    if (!key) continue;
    try {
      return await decryptMessage(key, encryptedContent, iv, roomId);
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`Failed to decrypt room message for ${roomId}`);
}

/**
 * Result of resolving which AES key to use for a chat context (DM session vs room).
 */
export interface ResolvedKey {
  key: CryptoKey;
  context: 'session' | 'room';
  contextId: string;
}

/**
 * Resolves the AES key for decrypting messages in either a 1-on-1 session or a room.
 *
 * Room hooks set `sessionId` to `roomId` while the key lives in {@link getGroupKey};
 * DM sessions use {@link getAESKey}. Tries session store first, then group key store.
 *
 * @param contextId - Session ID (DM) or room ID (room messages)
 * @param options - Pass `{ silent: true }` to skip console warning (e.g. polling from React hooks)
 * @returns Resolved key with context metadata, or undefined if neither store has a key
 */
export function resolveDecryptionKey(
  contextId: string,
  options?: { silent?: boolean },
): ResolvedKey | undefined {
  const sessionKey = getAESKey(contextId);
  if (sessionKey) {
    return { key: sessionKey, context: 'session', contextId };
  }

  const groupKey = getGroupKey(contextId);
  if (groupKey) {
    return { key: groupKey, context: 'room', contextId };
  }

  if (contextId && !options?.silent) {
    console.warn(
      '[keyStore] No decryption key for contextId=%s (no session AES key, no room group key)',
      contextId,
    );
  }

  return undefined;
}

/**
 * Checks whether a group key is stored for the given room.
 *
 * @param roomId - Room identifier
 */
export function hasGroupKey(roomId: string): boolean {
  const bucket = getRoomBucket(roomId);
  return !!bucket && bucket.epochs.size > 0;
}

/**
 * Room IDs that currently have at least one epoch group key in memory.
 */
export function getActiveGroupKeyRoomIds(): string[] {
  return Array.from(groupKeyStore.keys());
}

/**
 * Securely removes all epoch keys for a room.
 *
 * @param roomId - Room identifier
 * @returns true if a key was found and removed, false otherwise
 */
export function burnGroupKey(roomId: string): boolean {
  const bucket = getRoomBucket(roomId);
  if (!bucket) return false;

  for (const entry of bucket.epochs.values()) {
    // @ts-expect-error - Intentional nullification for secure cleanup
    entry.key = undefined;
  }
  groupKeyStore.delete(roomId);

  clearHiddenMessagesStorage('room', roomId);
  notifyListeners(roomId, 'burned');
  return true;
}

/**
 * Removes all stored group keys (called from burnAll).
 */
export function burnAllGroupKeys(): void {
  for (const roomId of Array.from(groupKeyStore.keys())) {
    burnGroupKey(roomId);
  }
  groupKeyStore.clear();
}

// ============================================
// Debug Utilities (Development Only)
// ============================================

/**
 * Gets debug information about the key store.
 * Only use in development - do not expose key material!
 * 
 * @returns Object with store statistics
 */
export function getDebugInfo(): {
  sessionCount: number;
  sessionIds: string[];
  groupKeyCount: number;
  groupKeyRoomIds: string[];
  unloadHandlerInstalled: boolean;
  listenerCount: number;
} {
  return {
    sessionCount: keyStore.size,
    sessionIds: Array.from(keyStore.keys()),
    groupKeyCount: groupKeyStore.size,
    groupKeyRoomIds: Array.from(groupKeyStore.keys()),
    unloadHandlerInstalled,
    listenerCount: eventListeners.size,
  };
}
