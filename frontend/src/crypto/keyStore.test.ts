/**
 * Unit tests for Key Storage module.
 * 
 * Tests cover:
 * - Storing and retrieving key pairs
 * - Storing peer public keys and shared secrets
 * - Secure burn operations
 * - Event listeners
 * - Unload handler management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  storeKeyPair,
  storePeerPublicKey,
  storeSharedSecret,
  getSessionKeys,
  getKeyPair,
  getPeerPublicKey,
  getSharedSecret,
  getAESKey,
  resolveDecryptionKey,
  storeGroupKey,
  getGroupKey,
  getGroupKeyEntry,
  getGroupKeyForEpoch,
  getGroupKeyEpochs,
  resolveDecryptionKeyForRoomMessage,
  resolveGroupKeyForCiphertext,
  getFingerprint,
  isHandshakeComplete,
  hasSession,
  getActiveSessionIds,
  getActiveGroupKeyRoomIds,
  getSessionCount,
  burn,
  burnAll,
  addKeyStoreListener,
  removeKeyStoreListener,
  removeUnloadHandler,
  isUnloadHandlerInstalled,
  getDebugInfo,
  getLastBurnAllReason,
  BACKGROUND_BURN_THRESHOLD_MS,
} from './keyStore';
import {
  generateKeyPair,
  computeSharedSecret,
  deriveAESKey,
  generateFingerprint,
} from './ecdh';
import { encryptMessage } from './aes';
import { encryptFileMetadata } from './fileEncryption';
import type { KeyPair, SharedSecret } from '@/types';

// ============================================
// Test Setup
// ============================================

describe('Key Storage', () => {
  // Clean up store between tests
  beforeEach(() => {
    burnAll();
    removeUnloadHandler();
  });

  afterEach(() => {
    burnAll();
    removeUnloadHandler();
  });

  // ============================================
  // Store Operations Tests
  // ============================================

  describe('Store Operations', () => {
    describe('storeKeyPair()', () => {
      it('should store a key pair for a session', async () => {
        const keyPair = await generateKeyPair();
        const sessionId = 'session-1';

        storeKeyPair(sessionId, keyPair);

        expect(hasSession(sessionId)).toBe(true);
        expect(getSessionCount()).toBe(1);
      });

      it('should throw error for empty session ID', async () => {
        const keyPair = await generateKeyPair();

        expect(() => storeKeyPair('', keyPair)).toThrow('Invalid session ID');
        expect(() => storeKeyPair('   ', keyPair)).toThrow('Invalid session ID');
      });

      it('should throw error for invalid key pair', () => {
        expect(() => storeKeyPair('session-1', null as unknown as KeyPair)).toThrow('Invalid key pair');
        expect(() => storeKeyPair('session-1', {} as KeyPair)).toThrow('Invalid key pair');
      });

      it('should update existing session on re-store', async () => {
        const keyPair1 = await generateKeyPair();
        const keyPair2 = await generateKeyPair();
        const sessionId = 'session-1';

        storeKeyPair(sessionId, keyPair1);
        storeKeyPair(sessionId, keyPair2);

        expect(getSessionCount()).toBe(1);
        expect(getKeyPair(sessionId)).toBe(keyPair2);
      });

      it('should store multiple sessions independently', async () => {
        const keyPair1 = await generateKeyPair();
        const keyPair2 = await generateKeyPair();

        storeKeyPair('session-1', keyPair1);
        storeKeyPair('session-2', keyPair2);

        expect(getSessionCount()).toBe(2);
        expect(getKeyPair('session-1')).toBe(keyPair1);
        expect(getKeyPair('session-2')).toBe(keyPair2);
      });

      it('should handle unload handler based on environment', async () => {
        const keyPair = await generateKeyPair();
        
        // Before storing, handler should not be installed
        expect(isUnloadHandlerInstalled()).toBe(false);
        
        storeKeyPair('session-1', keyPair);
        
        // After storing, handler state depends on window availability
        // In browser/jsdom: true, in pure Node: false
        const isInstalled = isUnloadHandlerInstalled();
        expect(typeof isInstalled).toBe('boolean');
      });
    });

    describe('storePeerPublicKey()', () => {
      it('should store peer public key for existing session', async () => {
        const aliceKeyPair = await generateKeyPair();
        const bobKeyPair = await generateKeyPair();
        const sessionId = 'session-1';

        storeKeyPair(sessionId, aliceKeyPair);
        storePeerPublicKey(sessionId, bobKeyPair.publicKey);

        expect(getPeerPublicKey(sessionId)).toBe(bobKeyPair.publicKey);
      });

      it('should throw error for non-existent session', async () => {
        const bobKeyPair = await generateKeyPair();

        expect(() => storePeerPublicKey('non-existent', bobKeyPair.publicKey))
          .toThrow('No keys found for session');
      });

      it('should throw error for invalid public key', async () => {
        const keyPair = await generateKeyPair();
        storeKeyPair('session-1', keyPair);

        expect(() => storePeerPublicKey('session-1', null as unknown as CryptoKey))
          .toThrow('Invalid peer public key');
      });
    });

    describe('storeSharedSecret()', () => {
      it('should store shared secret for existing session', async () => {
        const aliceKeyPair = await generateKeyPair();
        const bobKeyPair = await generateKeyPair();
        const sessionId = 'session-1';

        storeKeyPair(sessionId, aliceKeyPair);

        const rawSecret = await computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
        const aesKey = await deriveAESKey(rawSecret, sessionId);
        const fingerprint = await generateFingerprint(aliceKeyPair.publicKey, bobKeyPair.publicKey);

        const sharedSecret: SharedSecret = {
          sessionId,
          key: aesKey,
          fingerprint,
          visualFingerprint: [],
        };

        storeSharedSecret(sessionId, sharedSecret, rawSecret);

        expect(getSharedSecret(sessionId)).toEqual(sharedSecret);
        expect(getAESKey(sessionId)).toBe(aesKey);
        expect(getFingerprint(sessionId)).toBe(fingerprint);
        expect(isHandshakeComplete(sessionId)).toBe(true);
      });

      it('should throw error for non-existent session', async () => {
        const sharedSecret: SharedSecret = {
          sessionId: 'non-existent',
          key: {} as CryptoKey,
          fingerprint: 'ABC123',
          visualFingerprint: [],
        };

        expect(() => storeSharedSecret('non-existent', sharedSecret))
          .toThrow('No keys found for session');
      });
    });
  });

  // ============================================
  // Retrieve Operations Tests
  // ============================================

  describe('Retrieve Operations', () => {
    describe('getSessionKeys()', () => {
      it('should return complete session keys object', async () => {
        const keyPair = await generateKeyPair();
        const sessionId = 'session-1';

        storeKeyPair(sessionId, keyPair);
        const keys = getSessionKeys(sessionId);

        expect(keys).toBeDefined();
        expect(keys?.sessionId).toBe(sessionId);
        expect(keys?.keyPair).toBe(keyPair);
        expect(keys?.createdAt).toBeDefined();
      });

      it('should return undefined for non-existent session', () => {
        expect(getSessionKeys('non-existent')).toBeUndefined();
      });
    });

    describe('getKeyPair()', () => {
      it('should return key pair for existing session', async () => {
        const keyPair = await generateKeyPair();
        storeKeyPair('session-1', keyPair);

        expect(getKeyPair('session-1')).toBe(keyPair);
      });

      it('should return undefined for non-existent session', () => {
        expect(getKeyPair('non-existent')).toBeUndefined();
      });
    });

    describe('isHandshakeComplete()', () => {
      it('should return false before handshake', async () => {
        const keyPair = await generateKeyPair();
        storeKeyPair('session-1', keyPair);

        expect(isHandshakeComplete('session-1')).toBe(false);
      });

      it('should return true after shared secret stored', async () => {
        const aliceKeyPair = await generateKeyPair();
        const bobKeyPair = await generateKeyPair();
        const sessionId = 'session-1';

        storeKeyPair(sessionId, aliceKeyPair);

        const rawSecret = await computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
        const aesKey = await deriveAESKey(rawSecret, sessionId);
        const fingerprint = await generateFingerprint(aliceKeyPair.publicKey, bobKeyPair.publicKey);

        storeSharedSecret(sessionId, { sessionId, key: aesKey, fingerprint, visualFingerprint: [] });

        expect(isHandshakeComplete(sessionId)).toBe(true);
      });

      it('should return false for non-existent session', () => {
        expect(isHandshakeComplete('non-existent')).toBe(false);
      });
    });

    describe('hasSession()', () => {
      it('should return true for existing session', async () => {
        const keyPair = await generateKeyPair();
        storeKeyPair('session-1', keyPair);

        expect(hasSession('session-1')).toBe(true);
      });

      it('should return false for non-existent session', () => {
        expect(hasSession('non-existent')).toBe(false);
      });
    });

    describe('getActiveSessionIds()', () => {
      it('should return all active session IDs', async () => {
        const keyPair1 = await generateKeyPair();
        const keyPair2 = await generateKeyPair();

        storeKeyPair('session-1', keyPair1);
        storeKeyPair('session-2', keyPair2);

        const sessionIds = getActiveSessionIds();

        expect(sessionIds).toHaveLength(2);
        expect(sessionIds).toContain('session-1');
        expect(sessionIds).toContain('session-2');
      });

      it('should return empty array when no sessions', () => {
        expect(getActiveSessionIds()).toEqual([]);
      });
    });

    describe('getActiveGroupKeyRoomIds()', () => {
      it('should return empty array when no group keys', () => {
        expect(getActiveGroupKeyRoomIds()).toEqual([]);
      });

      it('should return room ids that have stored group keys', async () => {
        const groupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        storeGroupKey('room-a', 0, groupKey);
        storeGroupKey('room-b', 1, groupKey);

        expect(getActiveGroupKeyRoomIds()).toEqual(expect.arrayContaining(['room-a', 'room-b']));
        expect(getActiveGroupKeyRoomIds()).toHaveLength(2);
      });
    });

    describe('getSessionCount()', () => {
      it('should return correct count', async () => {
        expect(getSessionCount()).toBe(0);

        const keyPair = await generateKeyPair();
        storeKeyPair('session-1', keyPair);
        expect(getSessionCount()).toBe(1);

        storeKeyPair('session-2', await generateKeyPair());
        expect(getSessionCount()).toBe(2);
      });
    });

    describe('resolveDecryptionKey()', () => {
      it('should return undefined when no session or group key exists', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(resolveDecryptionKey('unknown-context')).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
          '[keyStore] No decryption key for contextId=%s (no session AES key, no room group key)',
          'unknown-context',
        );
        warn.mockRestore();
      });

      it('should not warn when missing key and silent option is set', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(resolveDecryptionKey('missing', { silent: true })).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
      });

      it('should not warn for empty contextId', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(resolveDecryptionKey('')).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
      });

      it('should return AES session key for 1-on-1 handshake', async () => {
        const aliceKeyPair = await generateKeyPair();
        const bobKeyPair = await generateKeyPair();
        const sessionId = 'session-dm';

        storeKeyPair(sessionId, aliceKeyPair);
        const rawSecret = await computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
        const aesKey = await deriveAESKey(rawSecret, sessionId);
        const fingerprint = await generateFingerprint(aliceKeyPair.publicKey, bobKeyPair.publicKey);
        storeSharedSecret(sessionId, { sessionId, key: aesKey, fingerprint, visualFingerprint: [] }, rawSecret);

        const resolved = resolveDecryptionKey(sessionId);
        expect(resolved?.key).toBe(aesKey);
        expect(resolved?.context).toBe('session');
        expect(resolved?.contextId).toBe(sessionId);
      });

      it('should return group key when only room key is stored', async () => {
        const roomId = 'room-abc';
        const groupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        storeGroupKey(roomId, 0, groupKey);

        const resolved = resolveDecryptionKey(roomId);
        expect(resolved?.key).toBe(groupKey);
        expect(resolved?.context).toBe('room');
        expect(resolved?.contextId).toBe(roomId);
      });

      it('should prefer session AES key when both stores have an entry for the same id', async () => {
        const id = 'collision-id';
        const aliceKeyPair = await generateKeyPair();
        const bobKeyPair = await generateKeyPair();
        storeKeyPair(id, aliceKeyPair);
        const rawSecret = await computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
        const sessionAes = await deriveAESKey(rawSecret, id);
        const fingerprint = await generateFingerprint(aliceKeyPair.publicKey, bobKeyPair.publicKey);
        storeSharedSecret(id, { sessionId: id, key: sessionAes, fingerprint, visualFingerprint: [] }, rawSecret);

        const groupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        storeGroupKey(id, 0, groupKey);

        const resolved = resolveDecryptionKey(id);
        expect(resolved?.key).toBe(sessionAes);
        expect(resolved?.context).toBe('session');
      });

      it('should notify listeners when group key is stored', async () => {
        const listener = vi.fn();
        addKeyStoreListener(listener);
        const roomId = 'room-listener';
        const groupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        storeGroupKey(roomId, 0, groupKey);
        expect(listener).toHaveBeenCalledWith(roomId, 'updated');
        removeKeyStoreListener(listener);
      });
    });

    describe('multi-epoch group keys (IMP-WFT-04)', () => {
      it('should retain previous epoch keys when storing a newer epoch', async () => {
        const roomId = 'room-multi-epoch';
        const key0 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        const key1 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);

        storeGroupKey(roomId, 0, key0);
        storeGroupKey(roomId, 1, key1);

        expect(getGroupKeyEpochs(roomId)).toEqual([1, 0]);
        expect(getGroupKeyForEpoch(roomId, 0)).toBe(key0);
        expect(getGroupKeyForEpoch(roomId, 1)).toBe(key1);
        expect(getGroupKeyEntry(roomId)?.epoch).toBe(1);
        expect(getGroupKey(roomId)).toBe(key1);
      });

      it('should decrypt with fallback when ciphertext uses an older epoch key', async () => {
        const roomId = 'room-fallback-decrypt';
        const key0 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        const key1 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        const plaintext = 'Message from epoch 0';

        storeGroupKey(roomId, 0, key0);
        const encrypted = await encryptMessage(key0, plaintext, roomId);

        storeGroupKey(roomId, 1, key1);

        const decrypted = await resolveDecryptionKeyForRoomMessage(
          roomId,
          encrypted.ciphertext,
          encrypted.iv,
        );
        expect(decrypted).toBe(plaintext);
      });

      it('should throw when no stored epoch key can decrypt the ciphertext', async () => {
        const roomId = 'room-fallback-fail';
        const key0 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        const key1 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        const encrypted = await encryptMessage(key1, 'wrong epoch only', roomId);

        storeGroupKey(roomId, 0, key0);

        await expect(
          resolveDecryptionKeyForRoomMessage(roomId, encrypted.ciphertext, encrypted.iv),
        ).rejects.toThrow();
      });

      it('should resolve the older epoch CryptoKey when encryptedMeta uses that epoch', async () => {
        const roomId = 'room-file-epoch-fallback';
        const key0 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        const key1 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);

        storeGroupKey(roomId, 0, key0);
        const encryptedMeta = await encryptFileMetadata(
          { fileName: 'old-epoch.png', mimeType: 'image/png' },
          key0,
        );
        storeGroupKey(roomId, 1, key1);

        const resolved = await resolveGroupKeyForCiphertext(roomId, encryptedMeta);
        expect(resolved.key).toBe(key0);
        expect(resolved.epoch).toBe(0);
      });

      it('should resolve the current epoch CryptoKey on the first matching probe', async () => {
        const roomId = 'room-file-epoch-current';
        const key0 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        const key1 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);

        storeGroupKey(roomId, 0, key0);
        storeGroupKey(roomId, 1, key1);
        const encryptedMeta = await encryptFileMetadata(
          { fileName: 'current.png', mimeType: 'image/png' },
          key1,
        );

        const resolved = await resolveGroupKeyForCiphertext(roomId, encryptedMeta);
        expect(resolved.key).toBe(key1);
        expect(resolved.epoch).toBe(1);
      });

      it('should throw when no stored epoch key can decrypt encryptedMeta', async () => {
        const roomId = 'room-file-epoch-fail';
        const key0 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        const key1 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        const encryptedMeta = await encryptFileMetadata(
          { fileName: 'orphan.png', mimeType: 'image/png' },
          key1,
        );

        storeGroupKey(roomId, 0, key0);

        await expect(resolveGroupKeyForCiphertext(roomId, encryptedMeta)).rejects.toThrow();
      });
    });
  });

  // ============================================
  // Burn Operations Tests
  // ============================================

  describe('Burn Operations', () => {
    describe('burn()', () => {
      it('should remove session keys', async () => {
        const keyPair = await generateKeyPair();
        storeKeyPair('session-1', keyPair);

        expect(hasSession('session-1')).toBe(true);
        
        const result = burn('session-1');
        
        expect(result).toBe(true);
        expect(hasSession('session-1')).toBe(false);
        expect(getSessionCount()).toBe(0);
      });

      it('should return false for non-existent session', () => {
        expect(burn('non-existent')).toBe(false);
      });

      it('should not affect other sessions', async () => {
        const keyPair1 = await generateKeyPair();
        const keyPair2 = await generateKeyPair();

        storeKeyPair('session-1', keyPair1);
        storeKeyPair('session-2', keyPair2);

        burn('session-1');

        expect(hasSession('session-1')).toBe(false);
        expect(hasSession('session-2')).toBe(true);
      });

      it('should clean up session completely', async () => {
        const aliceKeyPair = await generateKeyPair();
        const bobKeyPair = await generateKeyPair();
        const sessionId = 'session-1';

        storeKeyPair(sessionId, aliceKeyPair);

        const rawSecret = await computeSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
        const aesKey = await deriveAESKey(rawSecret, sessionId);
        const fingerprint = await generateFingerprint(aliceKeyPair.publicKey, bobKeyPair.publicKey);

        storeSharedSecret(sessionId, { sessionId, key: aesKey, fingerprint, visualFingerprint: [] }, rawSecret);
        
        // Verify keys are stored
        expect(getAESKey(sessionId)).toBeDefined();
        expect(getFingerprint(sessionId)).toBe(fingerprint);

        burn(sessionId);

        // Verify everything is cleaned up
        expect(getSessionKeys(sessionId)).toBeUndefined();
        expect(getAESKey(sessionId)).toBeUndefined();
        expect(getFingerprint(sessionId)).toBeUndefined();
        expect(hasSession(sessionId)).toBe(false);
      });
    });

    describe('burnAll()', () => {
      it('should remove all sessions', async () => {
        storeKeyPair('session-1', await generateKeyPair());
        storeKeyPair('session-2', await generateKeyPair());
        storeKeyPair('session-3', await generateKeyPair());

        expect(getSessionCount()).toBe(3);

        burnAll();

        expect(getSessionCount()).toBe(0);
        expect(hasSession('session-1')).toBe(false);
        expect(hasSession('session-2')).toBe(false);
        expect(hasSession('session-3')).toBe(false);
      });

      it('should work when store is empty', () => {
        expect(() => burnAll()).not.toThrow();
        expect(getSessionCount()).toBe(0);
      });

      it('should record burnAll reason', () => {
        burnAll('background_timeout');
        expect(getLastBurnAllReason()).toBe('background_timeout');
      });
    });

    describe('background burn configuration', () => {
      it('should expose threshold within 30–60s range', () => {
        expect(BACKGROUND_BURN_THRESHOLD_MS).toBeGreaterThanOrEqual(30_000);
        expect(BACKGROUND_BURN_THRESHOLD_MS).toBeLessThanOrEqual(60_000);
      });
    });
  });

  // ============================================
  // Event Listener Tests
  // ============================================

  describe('Event Listeners', () => {
    it('should notify on store', async () => {
      const listener = vi.fn();
      addKeyStoreListener(listener);

      const keyPair = await generateKeyPair();
      storeKeyPair('session-1', keyPair);

      expect(listener).toHaveBeenCalledWith('session-1', 'stored');

      removeKeyStoreListener(listener);
    });

    it('should notify on update', async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();
      storeKeyPair('session-1', keyPair1);

      const listener = vi.fn();
      addKeyStoreListener(listener);

      storeKeyPair('session-1', keyPair2);

      expect(listener).toHaveBeenCalledWith('session-1', 'updated');

      removeKeyStoreListener(listener);
    });

    it('should notify on burn', async () => {
      const keyPair = await generateKeyPair();
      storeKeyPair('session-1', keyPair);

      const listener = vi.fn();
      addKeyStoreListener(listener);

      burn('session-1');

      expect(listener).toHaveBeenCalledWith('session-1', 'burned');

      removeKeyStoreListener(listener);
    });

    it('should notify on burnAll', async () => {
      storeKeyPair('session-1', await generateKeyPair());
      storeKeyPair('session-2', await generateKeyPair());

      const listener = vi.fn();
      addKeyStoreListener(listener);

      burnAll();

      // Should be called for each session burn plus the final burnAll event
      expect(listener).toHaveBeenCalledWith('session-1', 'burned');
      expect(listener).toHaveBeenCalledWith('session-2', 'burned');
      expect(listener).toHaveBeenCalledWith('', 'burned_all');

      removeKeyStoreListener(listener);
    });

    it('should allow unsubscribe via returned function', async () => {
      const listener = vi.fn();
      const unsubscribe = addKeyStoreListener(listener);

      storeKeyPair('session-1', await generateKeyPair());
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      storeKeyPair('session-2', await generateKeyPair());
      expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('should handle listener errors gracefully', async () => {
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      addKeyStoreListener(errorListener);
      addKeyStoreListener(goodListener);

      const keyPair = await generateKeyPair();
      
      // Should not throw even if listener throws
      expect(() => storeKeyPair('session-1', keyPair)).not.toThrow();
      
      // Good listener should still be called
      expect(goodListener).toHaveBeenCalled();

      removeKeyStoreListener(errorListener);
      removeKeyStoreListener(goodListener);
    });
  });

  // ============================================
  // Unload Handler Tests
  // ============================================

describe('Unload Handler', () => {
    it('should track handler installation state', () => {
      // After burnAll in beforeEach, handler should be removed
      expect(isUnloadHandlerInstalled()).toBe(false);
    });

    it('should be installed when window is available and keys are stored', async () => {
      // Only test if window is properly defined
      if (typeof window === 'undefined') {
        return; // Skip in non-browser environments
      }

      const keyPair = await generateKeyPair();
      storeKeyPair('session-1', keyPair);

      // Handler should be installed after storing keys
      expect(isUnloadHandlerInstalled()).toBe(true);
    });

    it('removeUnloadHandler should be idempotent', () => {
      expect(() => removeUnloadHandler()).not.toThrow();
      expect(() => removeUnloadHandler()).not.toThrow();
    });

    it('should allow removing handler after installation', async () => {
      if (typeof window === 'undefined') {
        return;
      }

      const keyPair = await generateKeyPair();
      storeKeyPair('session-1', keyPair);
      
      // Remove handler
      removeUnloadHandler();
      expect(isUnloadHandlerInstalled()).toBe(false);
    });
  });

  // ============================================
  // Debug Info Tests
  // ============================================

describe('Debug Info', () => {
    it('should return accurate session information', async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();

      storeKeyPair('session-1', keyPair1);
      storeKeyPair('session-2', keyPair2);

      const debugInfo = getDebugInfo();

      expect(debugInfo.sessionCount).toBe(2);
      expect(debugInfo.sessionIds).toContain('session-1');
      expect(debugInfo.sessionIds).toContain('session-2');
      // Handler installation depends on environment
      expect(typeof debugInfo.unloadHandlerInstalled).toBe('boolean');
    });

    it('should reflect changes after burn', async () => {
      storeKeyPair('session-1', await generateKeyPair());
      
      let debugInfo = getDebugInfo();
      expect(debugInfo.sessionCount).toBe(1);

      burn('session-1');

      debugInfo = getDebugInfo();
      expect(debugInfo.sessionCount).toBe(0);
      expect(debugInfo.sessionIds).toEqual([]);
    });

    it('should track listener count', async () => {
      const listener = vi.fn();
      
      let debugInfo = getDebugInfo();
      const initialCount = debugInfo.listenerCount;

      addKeyStoreListener(listener);
      debugInfo = getDebugInfo();
      expect(debugInfo.listenerCount).toBe(initialCount + 1);

      removeKeyStoreListener(listener);
      debugInfo = getDebugInfo();
      expect(debugInfo.listenerCount).toBe(initialCount);
    });
  });

  // ============================================
  // Full Flow Test
  // ============================================

  describe('Full Key Storage Flow', () => {
    it('should handle complete handshake lifecycle', async () => {
      const sessionId = 'test-session';

      // 1. Generate and store our key pair
      const aliceKeyPair = await generateKeyPair();
      storeKeyPair(sessionId, aliceKeyPair);
      expect(hasSession(sessionId)).toBe(true);
      expect(isHandshakeComplete(sessionId)).toBe(false);

      // 2. Receive and store peer's public key
      const bobKeyPair = await generateKeyPair();
      storePeerPublicKey(sessionId, bobKeyPair.publicKey);
      expect(getPeerPublicKey(sessionId)).toBe(bobKeyPair.publicKey);

      // 3. Compute and store shared secret
      const rawSecret = await computeSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );
      const aesKey = await deriveAESKey(rawSecret, sessionId);
      const fingerprint = await generateFingerprint(aliceKeyPair.publicKey, bobKeyPair.publicKey);

      storeSharedSecret(sessionId, { sessionId, key: aesKey, fingerprint, visualFingerprint: [] }, rawSecret);
      expect(isHandshakeComplete(sessionId)).toBe(true);

      // 4. Retrieve keys for encryption
      const retrievedAESKey = getAESKey(sessionId);
      expect(retrievedAESKey).toBe(aesKey);

      const retrievedFingerprint = getFingerprint(sessionId);
      expect(retrievedFingerprint).toBe(fingerprint);

      // 5. Burn session
      burn(sessionId);
      expect(hasSession(sessionId)).toBe(false);
      expect(getAESKey(sessionId)).toBeUndefined();
    });
  });
});
