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
  senderInternalId?: string;
  /** @deprecated Prefer senderInternalId. */
  senderTgId?: number | null;
  senderUsername: string | null;
  senderDisplayName?: string;
  /** @deprecated Prefer senderDisplayName. */
  senderFirstName?: string;
  requestedAt: number;
  senderPublicKey?: string | null;
  /** True when the server auto-approved a BY_PASSWORD join — owner must send KEY_BUNDLE immediately. */
  autoApproved?: boolean;
}

/** In-memory map of senderInternalId → senderPublicKey, keyed as "{roomId}:{senderInternalId}". */
const pendingPublicKeys = new Map<string, string>();

function resolveSenderInternalId(data: ServerJoinRequestEvent): string | null {
  const fromInternal = data.senderInternalId?.trim();
  if (fromInternal) {
    return fromInternal;
  }
  if (data.senderTgId != null) {
    return String(data.senderTgId);
  }
  return null;
}

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
  acceptRequest: (roomId: string, senderInternalId: string) => void;
  /** Reject a join request — sends REJECT_ROOM_JOIN to server. */
  rejectRequest: (roomId: string, senderInternalId: string) => void;
  /** Remove a request from the local list (e.g. after accepting/rejecting). */
  removeRequest: (roomId: string, senderInternalId: string) => void;
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
  const publishRef = useRef(publish);
  useEffect(() => {
    onNewRequestRef.current = onNewRequest;
    publishRef.current = publish;
  });

  // ----------------------------------------
  // Incoming join request handler
  // ----------------------------------------

  const handleJoinRequest = useCallback((message: IMessage) => {
    try {
      const data: ServerJoinRequestEvent = JSON.parse(message.body);
      const senderInternalId = resolveSenderInternalId(data);
      if (!senderInternalId) {
        console.warn('[useRoomJoinRequests] Join request missing senderInternalId');
        return;
      }

      // Store sender's public key so we can wrap the group key when accepting
      if (data.senderPublicKey) {
        pendingPublicKeys.set(`${data.roomId}:${senderInternalId}`, data.senderPublicKey);
      }

      if (data.autoApproved) {
        // BY_PASSWORD: participant already joined — skip the UI dialog and immediately
        // wrap + deliver the KEY_BUNDLE so the participant can decrypt messages.
        const sendBundleAuto = async () => {
          const groupKeyEntry = getGroupKeyEntry(data.roomId);
          if (!groupKeyEntry) {
            console.warn('[useRoomJoinRequests] autoApproved: no group key for room', data.roomId);
            return;
          }
          const senderPublicKeyBase64 = pendingPublicKeys.get(`${data.roomId}:${senderInternalId}`);
          if (!senderPublicKeyBase64) {
            console.warn('[useRoomJoinRequests] autoApproved: no public key for sender', senderInternalId);
            return;
          }
          try {
            const senderPubKey = await importPublicKey(senderPublicKeyBase64);
            const bundle = await wrapGroupKey(
              groupKeyEntry.key,
              senderPubKey,
              senderInternalId,
              data.roomId,
              groupKeyEntry.epoch,
            );
            publishRef.current(SEND_KEY_BUNDLE_DESTINATION, {
              roomId: bundle.roomId,
              recipientInternalId: senderInternalId,
              epoch: bundle.epoch,
              ephemeralPublicKey: bundle.ephemeralPublicKey,
              encryptedKey: bundle.encryptedKey,
              iv: bundle.iv,
            });
            pendingPublicKeys.delete(`${data.roomId}:${senderInternalId}`);
            console.info('[useRoomJoinRequests] KEY_BUNDLE sent to auto-approved member', senderInternalId);
          } catch (err) {
            console.error('[useRoomJoinRequests] Failed to send KEY_BUNDLE for auto-approved member:', err);
          }
        };
        sendBundleAuto();
        return;
      }

      const request: RoomJoinRequest = {
        roomId: data.roomId,
        senderInternalId,
        senderUsername: data.senderUsername ?? null,
        senderFirstName: data.senderDisplayName ?? data.senderFirstName ?? 'Unknown',
        requestedAt: data.requestedAt,
      };

      setRequests(prev => {
        // Deduplicate: replace existing request from same sender in same room
        const filtered = prev.filter(
          r => !(r.roomId === request.roomId && r.senderInternalId === request.senderInternalId)
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
    (roomId: string, senderInternalId: string) => {
      if (!isConnected) return;

      // Send ACCEPT_ROOM_JOIN to the server
      publish(ACCEPT_JOIN_DESTINATION, { roomId, senderInternalId });

      // Wrap the current group key for the new member and send KEY_BUNDLE
      const sendBundle = async () => {
        const groupKeyEntry = getGroupKeyEntry(roomId);
        if (!groupKeyEntry) {
          console.warn('[useRoomJoinRequests] No group key for room', roomId);
          return;
        }

        const senderPublicKeyBase64 = pendingPublicKeys.get(`${roomId}:${senderInternalId}`);
        if (!senderPublicKeyBase64) {
          console.warn('[useRoomJoinRequests] No public key for sender', senderInternalId);
          return;
        }

        try {
          const senderPubKey = await importPublicKey(senderPublicKeyBase64);
          const bundle = await wrapGroupKey(
            groupKeyEntry.key,
            senderPubKey,
            senderInternalId,
            roomId,
            groupKeyEntry.epoch
          );

          publish(SEND_KEY_BUNDLE_DESTINATION, {
            roomId: bundle.roomId,
            recipientInternalId: senderInternalId,
            epoch: bundle.epoch,
            ephemeralPublicKey: bundle.ephemeralPublicKey,
            encryptedKey: bundle.encryptedKey,
            iv: bundle.iv,
          });

          // Clean up the stored public key
          pendingPublicKeys.delete(`${roomId}:${senderInternalId}`);
        } catch (err) {
          console.error('[useRoomJoinRequests] Failed to send key bundle:', err);
        }
      };

      sendBundle();
    },
    [isConnected, publish]
  );

  const rejectRequest = useCallback(
    (roomId: string, senderInternalId: string) => {
      if (!isConnected) return;
      publish(REJECT_JOIN_DESTINATION, { roomId, senderInternalId });
    },
    [isConnected, publish]
  );

  const removeRequest = useCallback((roomId: string, senderInternalId: string) => {
    pendingPublicKeys.delete(`${roomId}:${senderInternalId}`);
    setRequests(prev =>
      prev.filter(r => !(r.roomId === roomId && r.senderInternalId === senderInternalId))
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
