import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { decryptRoomName, encryptRoomName, generateGroupKey, wrapGroupKey } from '../crypto/groupKey';
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

/** Why rekey ended in error — for UI (IMP-RKR-02). */
export type RekeyErrorReason =
  | 'no-local-key'
  | 'pubkeys-failed'
  | 'parse-failed'
  | 'rekey-failed'
  | null;

/** Active rekey mode — bootstrap (owner recovery) vs normal (member left). */
export type RekeyMode = 'bootstrap' | 'normal' | null;

export interface RekeyOptions {
  /** Owner recovery without local group key — explicit user intent only (IMP-RKR-01). */
  bootstrap?: boolean;
}

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
  /** Owner's internalId — excluded from bundle wrapping (owner updates key directly). */
  myId: string | null;
  /** Current encrypted name fields for the room being rekeyed (from myRooms). */
  getRoomNameCipher?: (roomId: string) => {
    nameEncrypted?: string | null;
    nameIv?: string | null;
  } | undefined;
  onRekeyCompleted?: (roomId: string, newEpoch: number) => void;
  onRekeyReceived?: (roomId: string, newEpoch: number) => void;
  onRekeyNameUpdated?: (roomId: string, nameEncrypted: string, nameIv: string) => void;
}

export interface UseRekeyRoomReturn {
  status: RekeyStatus;
  /** Last error reason when status === 'error'. */
  errorReason: RekeyErrorReason;
  /** Mode of the in-flight or last completed rekey. */
  rekeyMode: RekeyMode;
  /**
   * Initiate a rekey for the given room (owner only).
   * Fetches member public keys, generates a new group key,
   * wraps it for each remaining member, and sends REKEY to the server.
   *
   * @param options.bootstrap — allow rekey without local group key (owner recovery).
   */
  rekeyRoom: (roomId: string, options?: RekeyOptions) => void;
  reset: () => void;
}

/**
 * Hook for the room owner to rotate the group key after a member leaves (P2-3.2.2)
 * or to bootstrap a new epoch after local key loss (IMP-RKR-01).
 *
 * Flow:
 * 1. `rekeyRoom(roomId)` sends `GET_MEMBER_PUBKEYS` to the server.
 * 2. On response: generates a new AES-256-GCM group key.
 * 3. Immediately stores it locally (owner's own keyStore update).
 * 4. Wraps the new key for each OTHER member using ECIES-like scheme.
 * 5. Sends `REKEY { roomId, newEpoch, bundles }` to the server.
 * 6. Server stores bundles, relays KEY_BUNDLE to each member, broadcasts ROOM_REKEY.
 *
 * Bootstrap (`{ bootstrap: true }`): when owner has no local key, uses
 * `newEpoch = (serverCurrentEpoch ?? -1) + 1` from the pubkeys response.
 *
 * Also subscribes to `ROOM_REKEY` events for non-owner members — they receive
 * `ROOM_REKEY` as a signal to wait for their new KEY_BUNDLE.
 *
 * Reference: docs/specs/GROUP_KEY_PROTOCOL.md
 */
export function useRekeyRoom({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  myId,
  getRoomNameCipher,
  onRekeyCompleted,
  onRekeyReceived,
  onRekeyNameUpdated,
}: UseRekeyRoomOptions): UseRekeyRoomReturn {
  const [status, setStatus] = useState<RekeyStatus>('idle');
  const [errorReason, setErrorReason] = useState<RekeyErrorReason>(null);
  const [rekeyMode, setRekeyMode] = useState<RekeyMode>(null);

  // The roomId for which we're currently waiting on pubkeys
  const pendingRoomIdRef = useRef<string | null>(null);
  const pendingBootstrapRef = useRef(false);
  const onRekeyCompletedRef = useRef(onRekeyCompleted);
  const onRekeyReceivedRef = useRef(onRekeyReceived);
  const onRekeyNameUpdatedRef = useRef(onRekeyNameUpdated);
  const getRoomNameCipherRef = useRef(getRoomNameCipher);

  useEffect(() => {
    onRekeyCompletedRef.current = onRekeyCompleted;
    onRekeyReceivedRef.current = onRekeyReceived;
    onRekeyNameUpdatedRef.current = onRekeyNameUpdated;
    getRoomNameCipherRef.current = getRoomNameCipher;
  });

  const failRekey = useCallback((reason: RekeyErrorReason) => {
    pendingRoomIdRef.current = null;
    pendingBootstrapRef.current = false;
    setErrorReason(reason);
    setStatus('error');
  }, []);

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
        failRekey('parse-failed');
        return;
      }

      if (!data.success || !data.publicKeys) {
        console.error('[useRekeyRoom] GET_MEMBER_PUBKEYS failed:', data.error);
        failRekey('pubkeys-failed');
        return;
      }

      const roomId = pendingRoomIdRef.current ?? data.roomId;
      if (!roomId) {
        failRekey('pubkeys-failed');
        return;
      }

      const isBootstrap = pendingBootstrapRef.current;
      const currentEntry = getGroupKeyEntry(roomId);

      if (!currentEntry && !isBootstrap) {
        console.error(
          '[useRekeyRoom] Cannot rekey room %s: no local group key (owner must recover key or accept lost history)',
          roomId,
        );
        failRekey('no-local-key');
        return;
      }

      setRekeyMode(currentEntry ? 'normal' : 'bootstrap');
      setStatus('rekeying');
      setErrorReason(null);

      try {
        const newGroupKey = await generateGroupKey();
        const serverEpoch = data.currentEpoch ?? -1;
        const newEpoch = currentEntry ? currentEntry.epoch + 1 : serverEpoch + 1;

        // Update owner's key immediately (no wrapping needed for self)
        storeGroupKey(roomId, newEpoch, newGroupKey);

        // Wrap for each other member (skip self)
        const bundlePromises = Object.entries(data.publicKeys)
          .filter(([memberInternalId]) => memberInternalId !== myId)
          .map(async ([memberInternalId, publicKeyBase64]) => {
            const peerPubKey = await importPublicKey(publicKeyBase64);
            const bundle = await wrapGroupKey(newGroupKey, peerPubKey, memberInternalId, roomId, newEpoch);
            return {
              recipientInternalId: memberInternalId,
              ephemeralPublicKey: bundle.ephemeralPublicKey,
              encryptedKey: bundle.encryptedKey,
              iv: bundle.iv,
            };
          });

        const bundles = await Promise.all(bundlePromises);

        let namePayload: { nameEncrypted?: string; nameIv?: string } = {};
        // Re-encrypt room name only when we still hold the previous group key
        if (currentEntry) {
          const cipher = getRoomNameCipherRef.current?.(roomId);
          if (cipher?.nameEncrypted && cipher?.nameIv) {
            try {
              const plaintext = await decryptRoomName(
                cipher.nameEncrypted,
                cipher.nameIv,
                currentEntry.key,
                roomId,
              );
              namePayload = await encryptRoomName(plaintext, newGroupKey, roomId);
            } catch (err) {
              console.error('[useRekeyRoom] Failed to re-encrypt room name for room', roomId, err);
            }
          }
        }

        pendingRoomIdRef.current = null;
        pendingBootstrapRef.current = false;

        if (bundles.length === 0) {
          // No other members — rekey is trivially complete
          if (namePayload.nameEncrypted && namePayload.nameIv) {
            onRekeyNameUpdatedRef.current?.(roomId, namePayload.nameEncrypted, namePayload.nameIv);
          }
          setStatus('done');
          onRekeyCompletedRef.current?.(roomId, newEpoch);
          return;
        }

        publish(REKEY_DESTINATION, {
          roomId,
          newEpoch,
          bundles,
          ...namePayload,
        });

        if (namePayload.nameEncrypted && namePayload.nameIv) {
          onRekeyNameUpdatedRef.current?.(roomId, namePayload.nameEncrypted, namePayload.nameIv);
        }

        setStatus('done');
        onRekeyCompletedRef.current?.(roomId, newEpoch);
      } catch (err) {
        console.error('[useRekeyRoom] Rekey failed for room', roomId, err);
        failRekey('rekey-failed');
      }
    };

    handleAsync();
  }, [publish, myId, failRekey]);

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
    (roomId: string, options?: RekeyOptions) => {
      if (!isConnected) return;
      pendingRoomIdRef.current = roomId;
      pendingBootstrapRef.current = options?.bootstrap === true;
      setErrorReason(null);
      setRekeyMode(options?.bootstrap ? 'bootstrap' : 'normal');
      setStatus('fetching-keys');
      publish(GET_MEMBER_PUBKEYS_DESTINATION, { roomId });
    },
    [isConnected, publish]
  );

  const reset = useCallback(() => {
    pendingRoomIdRef.current = null;
    pendingBootstrapRef.current = false;
    setErrorReason(null);
    setRekeyMode(null);
    setStatus('idle');
  }, []);

  return { status, errorReason, rekeyMode, rekeyRoom, reset };
}
