import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { generateGroupKey, wrapGroupKey } from '../crypto/groupKey';
import { storeGroupKey, getGroupKeyEntry } from '../crypto/keyStore';
import { importPublicKey } from '../crypto/ecdh';

// ============================================
// STOMP destinations
// ============================================

/** Owner → server: request member ECDH public keys for rekey preparation. */
const GET_MEMBER_PUBKEYS_DESTINATION = '/app/room.getMemberPubkeys';
/** Server → owner: member public keys response. */
const MEMBER_PUBKEYS_DESTINATION = '/user/queue/member-pubkeys';
/** Owner → server: send all new encrypted key bundles (rekey). */
const REKEY_DESTINATION = '/app/room.rekey';
/** Server → member: rekey notification broadcast. */
const ROOM_REKEY_DESTINATION = '/user/queue/room-rekey';

// ============================================
// Types
// ============================================

export type RekeyStatus =
  | 'idle'
  | 'fetching-keys'   // waiting for GET_MEMBER_PUBKEYS response
  | 'rekeying'        // encrypting and sending bundles
  | 'done'
  | 'error';

interface ServerMemberPublicKeysEvent {
  success: boolean;
  roomId: string;
  publicKeys?: Record<string, string>;
  currentEpoch?: number | null;
  error?: string;
}

interface ServerRoomRekeyEvent {
  roomId: string;
  newEpoch: number;
}

interface UseRekeyRoomOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
  myTgId: number | null;
  onRekeyCompleted?: (roomId: string, newEpoch: number) => void;
  onRekeyReceived?: (roomId: string, newEpoch: number) => void;
}

export interface UseRekeyRoomReturn {
  status: RekeyStatus;
  /**
   * Initiate a rekey for the given room (owner only).
   * Fetches member public keys, generates a new group key,
   * wraps it for each remaining member, and sends REKEY to the server.
   *
   * @param roomId    room to rekey
   * @param myTgId    owner's Telegram ID (excluded from bundle wrapping — owner updates key directly)
   */
  rekeyRoom: (roomId: string) => void;
  reset: () => void;
}

/**
 * Hook for the room owner to rotate the group key after a member leaves (P2-3.2.2).
 *
 * Flow:
 * 1. `rekeyRoom(roomId)` sends `GET_MEMBER_PUBKEYS` to the server.
 * 2. On response: generates a new AES-256-GCM group key.
 * 3. Immediately stores it locally (owner's own keyStore update).
 * 4. Wraps the new key for each OTHER member using ECIES-like scheme.
 * 5. Sends `REKEY { roomId, newEpoch, bundles }` to the server.
 * 6. Server stores bundles, relays KEY_BUNDLE to each member, broadcasts ROOM_REKEY.
 *
 * Also subscribes to `ROOM_REKEY` events for non-owner members — they receive
 * `ROOM_REKEY` as a signal to wait for their new KEY_BUNDLE.
 *
 * Reference: docs/phases/phase-2-rooms/GROUP_KEY_PROTOCOL.md
 */
export function useRekeyRoom({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  myTgId,
  onRekeyCompleted,
  onRekeyReceived,
}: UseRekeyRoomOptions): UseRekeyRoomReturn {
  const [status, setStatus] = useState<RekeyStatus>('idle');

  // The roomId for which we're currently waiting on pubkeys
  const pendingRoomIdRef = useRef<string | null>(null);
  const onRekeyCompletedRef = useRef(onRekeyCompleted);
  const onRekeyReceivedRef = useRef(onRekeyReceived);

  useEffect(() => {
    onRekeyCompletedRef.current = onRekeyCompleted;
    onRekeyReceivedRef.current = onRekeyReceived;
  });

  // ----------------------------------------
  // Member public keys response handler
  // ----------------------------------------

  const handleMemberPubkeys = useCallback((message: IMessage) => {
    const handleAsync = async () => {
      let data: ServerMemberPublicKeysEvent;
      try {
        data = JSON.parse(message.body) as ServerMemberPublicKeysEvent;
      } catch {
        console.error('[useRekeyRoom] Failed to parse MEMBER_PUBKEYS message');
        setStatus('error');
        return;
      }

      if (!data.success || !data.publicKeys) {
        console.error('[useRekeyRoom] GET_MEMBER_PUBKEYS failed:', data.error);
        setStatus('error');
        return;
      }

      const roomId = pendingRoomIdRef.current ?? data.roomId;
      if (!roomId) {
        setStatus('error');
        return;
      }

      const currentEntry = getGroupKeyEntry(roomId);

      setStatus('rekeying');

      try {
        const newGroupKey = await generateGroupKey();
        let newEpoch: number;
        if (currentEntry) {
          newEpoch = currentEntry.epoch + 1;
        } else {
          // Owner lost in-memory key (app restart) — bootstrap from server epoch
          const serverEpoch = data.currentEpoch ?? 0;
          newEpoch = serverEpoch + 1;
          console.info('[useRekeyRoom] No local key — bootstrapping from server epoch %d → %d',
            serverEpoch, newEpoch);
        }

        // Update owner's key immediately (no wrapping needed for self)
        storeGroupKey(roomId, newEpoch, newGroupKey);

        // Wrap for each other member (skip self)
        const myTgIdStr = myTgId !== null ? String(myTgId) : null;
        const bundlePromises = Object.entries(data.publicKeys)
          .filter(([tgId]) => tgId !== myTgIdStr)
          .map(async ([tgId, publicKeyBase64]) => {
            const peerPubKey = await importPublicKey(publicKeyBase64);
            const bundle = await wrapGroupKey(newGroupKey, peerPubKey, tgId, roomId, newEpoch);
            return {
              recipientTgId: Number(tgId),
              ephemeralPublicKey: bundle.ephemeralPublicKey,
              encryptedKey: bundle.encryptedKey,
              iv: bundle.iv,
            };
          });

        const bundles = await Promise.all(bundlePromises);

        if (bundles.length === 0) {
          // No other members — rekey is trivially complete
          setStatus('done');
          onRekeyCompletedRef.current?.(roomId, newEpoch);
          return;
        }

        publish(REKEY_DESTINATION, {
          roomId,
          newEpoch,
          bundles,
        });

        pendingRoomIdRef.current = null;
        setStatus('done');
        onRekeyCompletedRef.current?.(roomId, newEpoch);
      } catch (err) {
        console.error('[useRekeyRoom] Rekey failed for room', roomId, err);
        setStatus('error');
      }
    };

    handleAsync();
  }, [publish, myTgId]);

  // ----------------------------------------
  // ROOM_REKEY broadcast handler (non-owner members)
  // ----------------------------------------

  const handleRoomRekey = useCallback((message: IMessage) => {
    try {
      const data: ServerRoomRekeyEvent = JSON.parse(message.body);
      // Members receive this to know that a new key epoch is coming via KEY_BUNDLE.
      // The actual key update is handled by useKeyBundle.
      console.info('[useRekeyRoom] ROOM_REKEY received: roomId=%s newEpoch=%d',
        data.roomId, data.newEpoch);
      onRekeyReceivedRef.current?.(data.roomId, data.newEpoch);
    } catch {
      console.error('[useRekeyRoom] Failed to parse ROOM_REKEY message');
    }
  }, []);

  // ----------------------------------------
  // Subscriptions
  // ----------------------------------------

  const isSubscribedRef = useRef(false);

  useEffect(() => {
    if (isConnected && !isSubscribedRef.current) {
      subscribe(MEMBER_PUBKEYS_DESTINATION, handleMemberPubkeys);
      subscribe(ROOM_REKEY_DESTINATION, handleRoomRekey);
      isSubscribedRef.current = true;
    }
    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(MEMBER_PUBKEYS_DESTINATION);
        unsubscribe(ROOM_REKEY_DESTINATION);
        isSubscribedRef.current = false;
      }
    };
  }, [isConnected, subscribe, unsubscribe, handleMemberPubkeys, handleRoomRekey]);

  // ----------------------------------------
  // Public actions
  // ----------------------------------------

  const rekeyRoom = useCallback(
    (roomId: string) => {
      if (!isConnected) return;
      pendingRoomIdRef.current = roomId;
      setStatus('fetching-keys');
      publish(GET_MEMBER_PUBKEYS_DESTINATION, { roomId });
    },
    [isConnected, publish]
  );

  const reset = useCallback(() => {
    pendingRoomIdRef.current = null;
    setStatus('idle');
  }, []);

  return { status, rekeyRoom, reset };
}
