import { useCallback, useEffect, useRef } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { unwrapGroupKey } from '../crypto/groupKey';
import { storeGroupKey, getSessionKeys } from '../crypto/keyStore';
import type { KeyBundle } from '../types';

// ============================================
// STOMP destinations
// ============================================

/** Server → member: encrypted group-key bundle (on join or rekey). */
const KEY_BUNDLE_DESTINATION = '/user/queue/key-bundle';

// ============================================
// Types
// ============================================

interface UseKeyBundleOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  onKeyReceived?: (roomId: string, epoch: number) => void;
  onError?: (roomId: string, error: string) => void;
}

export interface UseKeyBundleReturn {
  /** Whether the hook is subscribed to key-bundle events. */
  isSubscribed: boolean;
}

/**
 * Hook that subscribes to `/user/queue/key-bundle` and handles incoming
 * encrypted group-key bundles for room E2EE.
 *
 * On receipt of a KEY_BUNDLE event:
 * 1. Looks up the room ECDH private key from keyStore (`room-join:{roomId}`).
 * 2. Calls `unwrapGroupKey(bundle, privateKey)` to decrypt the group key.
 * 3. Stores the group key via `storeGroupKey(roomId, epoch, key)`.
 *
 * Used for both initial key delivery (P2-3.2.1) and rekey after member leave (P2-3.2.2).
 *
 * Reference: docs/phases/phase-2-rooms/GROUP_KEY_PROTOCOL.md
 */
export function useKeyBundle({
  isConnected,
  subscribe,
  unsubscribe,
  onKeyReceived,
  onError,
}: UseKeyBundleOptions): UseKeyBundleReturn {
  const isSubscribedRef = useRef(false);
  const onKeyReceivedRef = useRef(onKeyReceived);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onKeyReceivedRef.current = onKeyReceived;
    onErrorRef.current = onError;
  });

  // ----------------------------------------
  // KEY_BUNDLE handler
  // ----------------------------------------

  const handleKeyBundle = useCallback((message: IMessage) => {
    const handleAsync = async () => {
      let bundle: KeyBundle;
      try {
        bundle = JSON.parse(message.body) as KeyBundle;
      } catch {
        console.error('[useKeyBundle] Failed to parse KEY_BUNDLE message');
        return;
      }

      const { roomId, epoch } = bundle;

      // Look up our ECDH private key for this room (stored during join / room creation)
      const roomKeyId = `room-join:${roomId}`;
      const roomKeys = getSessionKeys(roomKeyId);

      if (!roomKeys?.keyPair?.privateKey) {
        console.warn('[useKeyBundle] No ECDH private key for room', roomId,
          '— cannot unwrap group key. Key bundle will be lost.');
        onErrorRef.current?.(roomId, 'NO_PRIVATE_KEY');
        return;
      }

      try {
        const groupKey = await unwrapGroupKey(bundle, roomKeys.keyPair.privateKey);
        storeGroupKey(roomId, epoch, groupKey);
        console.info('[useKeyBundle] Group key stored for room', roomId, 'epoch', epoch);
        onKeyReceivedRef.current?.(roomId, epoch);
      } catch (err) {
        console.error('[useKeyBundle] Failed to unwrap group key for room', roomId, err);
        onErrorRef.current?.(roomId, 'UNWRAP_FAILED');
      }
    };

    handleAsync();
  }, []);

  // ----------------------------------------
  // Subscription lifecycle
  // ----------------------------------------

  useEffect(() => {
    if (isConnected && !isSubscribedRef.current) {
      subscribe(KEY_BUNDLE_DESTINATION, handleKeyBundle);
      isSubscribedRef.current = true;
    }
    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(KEY_BUNDLE_DESTINATION);
        isSubscribedRef.current = false;
      }
    };
  }, [isConnected, subscribe, unsubscribe, handleKeyBundle]);

  return { isSubscribed: isSubscribedRef.current };
}
