import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { wrapGroupKey } from '../crypto/groupKey';
import { getGroupKeyEntry } from '../crypto/keyStore';
import { importPublicKey } from '../crypto/ecdh';
import type { RoomJoinRequest } from '../types';

// ============================================
// STOMP destinations
// ============================================

/** Server → owner: incoming join request notification. */
const JOIN_REQUESTS_DESTINATION = '/user/queue/room-join-requests';
/** Owner → server: accept a pending join request. */
const ACCEPT_JOIN_DESTINATION = '/app/room.acceptJoin';
/** Owner → server: reject a pending join request. */
const REJECT_JOIN_DESTINATION = '/app/room.rejectJoin';
/** Owner → server: send encrypted group-key bundle to new member. */
const SEND_KEY_BUNDLE_DESTINATION = '/app/room.sendKeyBundle';

// ============================================
// Types
// ============================================

interface ServerJoinRequestEvent {
  roomId: string;
  senderTgId: number;
  senderUsername: string | null;
  senderFirstName: string;
  requestedAt: number;
  senderPublicKey?: string | null;
}

/** In-memory map of senderTgId → senderPublicKey, keyed as "{roomId}:{senderTgId}". */
const pendingPublicKeys = new Map<string, string>();

interface UseRoomJoinRequestsOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
  onNewRequest?: (request: RoomJoinRequest) => void;
}

export interface UseRoomJoinRequestsReturn {
  /** All pending join requests received since connecting. */
  requests: RoomJoinRequest[];
  /** Accept a join request — sends ACCEPT_ROOM_JOIN to server. */
  acceptRequest: (roomId: string, senderTgId: number) => void;
  /** Reject a join request — sends REJECT_ROOM_JOIN to server. */
  rejectRequest: (roomId: string, senderTgId: number) => void;
  /** Remove a request from the local list (e.g. after accepting/rejecting). */
  removeRequest: (roomId: string, senderTgId: number) => void;
  /** Total count of pending requests. */
  pendingCount: number;
}

/**
 * Hook for the room owner's join-request management flow.
 *
 * - Subscribes to `/user/queue/room-join-requests` and accumulates incoming requests.
 * - Exposes `acceptRequest` / `rejectRequest` which send STOMP messages to the backend.
 * - The backend sends `JoinApprovedEvent` or `JoinRejectedEvent` to the requester
 *   after the owner's decision.
 */
export function useRoomJoinRequests({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onNewRequest,
}: UseRoomJoinRequestsOptions): UseRoomJoinRequestsReturn {
  const [requests, setRequests] = useState<RoomJoinRequest[]>([]);
  const isSubscribedRef = useRef(false);
  const onNewRequestRef = useRef(onNewRequest);
  useEffect(() => {
    onNewRequestRef.current = onNewRequest;
  });

  // ----------------------------------------
  // Incoming join request handler
  // ----------------------------------------

  const handleJoinRequest = useCallback((message: IMessage) => {
    try {
      const data: ServerJoinRequestEvent = JSON.parse(message.body);
      const request: RoomJoinRequest = {
        roomId: data.roomId,
        senderTgId: data.senderTgId,
        senderUsername: data.senderUsername ?? null,
        senderFirstName: data.senderFirstName,
        requestedAt: data.requestedAt,
      };

      // Store sender's public key so we can wrap the group key when accepting
      if (data.senderPublicKey) {
        pendingPublicKeys.set(`${data.roomId}:${data.senderTgId}`, data.senderPublicKey);
      }

      setRequests(prev => {
        // Deduplicate: replace existing request from same sender in same room
        const filtered = prev.filter(
          r => !(r.roomId === request.roomId && r.senderTgId === request.senderTgId)
        );
        return [...filtered, request];
      });
      onNewRequestRef.current?.(request);
    } catch {
      console.error('[useRoomJoinRequests] Failed to parse join request event');
    }
  }, []);

  // ----------------------------------------
  // Subscription lifecycle
  // ----------------------------------------

  useEffect(() => {
    if (!isSubscribedRef.current) {
      subscribe(JOIN_REQUESTS_DESTINATION, handleJoinRequest);
      isSubscribedRef.current = true;
    }
    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(JOIN_REQUESTS_DESTINATION);
        isSubscribedRef.current = false;
      }
    };
  }, [subscribe, unsubscribe, handleJoinRequest]);

  // ----------------------------------------
  // Public actions
  // ----------------------------------------

  const acceptRequest = useCallback(
    (roomId: string, senderTgId: number) => {
      if (!isConnected) return;

      // Send ACCEPT_ROOM_JOIN to the server
      publish(ACCEPT_JOIN_DESTINATION, { roomId, senderTgId });

      // Wrap the current group key for the new member and send KEY_BUNDLE
      const sendBundle = async () => {
        const groupKeyEntry = getGroupKeyEntry(roomId);
        if (!groupKeyEntry) {
          console.warn('[useRoomJoinRequests] No group key for room', roomId);
          return;
        }

        const senderPublicKeyBase64 = pendingPublicKeys.get(`${roomId}:${senderTgId}`);
        if (!senderPublicKeyBase64) {
          console.warn('[useRoomJoinRequests] No public key for sender', senderTgId);
          return;
        }

        try {
          const senderPubKey = await importPublicKey(senderPublicKeyBase64);
          const bundle = await wrapGroupKey(
            groupKeyEntry.key,
            senderPubKey,
            String(senderTgId),
            roomId,
            groupKeyEntry.epoch
          );

          publish(SEND_KEY_BUNDLE_DESTINATION, {
            roomId: bundle.roomId,
            recipientTgId: senderTgId,
            epoch: bundle.epoch,
            ephemeralPublicKey: bundle.ephemeralPublicKey,
            encryptedKey: bundle.encryptedKey,
            iv: bundle.iv,
          });

          // Clean up the stored public key
          pendingPublicKeys.delete(`${roomId}:${senderTgId}`);
        } catch (err) {
          console.error('[useRoomJoinRequests] Failed to send key bundle:', err);
        }
      };

      sendBundle();
    },
    [isConnected, publish]
  );

  const rejectRequest = useCallback(
    (roomId: string, senderTgId: number) => {
      if (!isConnected) return;
      publish(REJECT_JOIN_DESTINATION, { roomId, senderTgId });
    },
    [isConnected, publish]
  );

  const removeRequest = useCallback((roomId: string, senderTgId: number) => {
    pendingPublicKeys.delete(`${roomId}:${senderTgId}`);
    setRequests(prev =>
      prev.filter(r => !(r.roomId === roomId && r.senderTgId === senderTgId))
    );
  }, []);

  return {
    requests,
    acceptRequest,
    rejectRequest,
    removeRequest,
    pendingCount: requests.length,
  };
}
