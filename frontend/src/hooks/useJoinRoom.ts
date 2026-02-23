import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { derivePasswordProof } from '../crypto/kdf';
import type { RoomJoinMode } from '../types';

// ============================================
// STOMP destinations
// ============================================

const GET_INVITE_INFO_DESTINATION = '/app/room.getInviteInfo';
const REQUEST_JOIN_DESTINATION = '/app/room.requestJoin';
const INVITE_INFO_DESTINATION = '/user/queue/room-invite-info';
const JOIN_RESULT_DESTINATION = '/user/queue/room-join-result';

// ============================================
// Types
// ============================================

export type JoinRoomStatus =
  | 'idle'
  | 'loading-info'  // fetching invite info (salt + joinMode)
  | 'ready'         // invite info loaded, waiting for user to submit password
  | 'submitting'    // password proof sent, waiting for server response
  | 'pending'       // BY_REQUEST: request submitted, waiting for owner decision
  | 'approved'      // user was added to the room
  | 'rejected'      // owner rejected the request
  | 'error';

export type JoinRoomErrorCode =
  | 'INVALID_TOKEN'
  | 'ROOM_NOT_FOUND'
  | 'WRONG_PASSWORD'
  | 'ALREADY_MEMBER'
  | 'REQUEST_PENDING'
  | 'INTERNAL_ERROR'
  | 'CONNECTION_ERROR'
  | 'CRYPTO_ERROR';

export interface JoinRoomResult {
  status: JoinRoomStatus;
  joinMode: RoomJoinMode | null;
  roomId: string | null;
  error: JoinRoomErrorCode | null;
}

// ============================================
// Server event shapes
// ============================================

interface ServerInviteInfoEvent {
  success: boolean;
  salt?: string;
  joinMode?: string;
  error?: string;
}

interface ServerJoinApprovedEvent {
  success: boolean;
  roomId?: string;
  error?: string;
}

interface ServerJoinRejectedEvent {
  roomId: string;
}

// ============================================
// Hook options / return
// ============================================

interface UseJoinRoomOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
  onApproved?: (roomId: string) => void;
  onRejected?: (roomId: string) => void;
  onError?: (error: JoinRoomErrorCode) => void;
}

export interface UseJoinRoomReturn {
  result: JoinRoomResult;
  /** Step 1: fetch invite info (salt + joinMode) for this token. */
  loadInviteInfo: (token: string) => void;
  /** Step 2: submit password after invite info has loaded. */
  submitJoin: (token: string, password: string) => Promise<void>;
  reset: () => void;
}

const initialResult: JoinRoomResult = {
  status: 'idle',
  joinMode: null,
  roomId: null,
  error: null,
};

/**
 * Hook for the full room-join flow:
 *
 * 1. `loadInviteInfo(token)` — fetch KDF salt + joinMode from the server.
 * 2. `submitJoin(token, password)` — derive PBKDF2 proof and send REQUEST_JOIN_ROOM.
 * 3. Handle `JoinApprovedEvent` (immediate join or owner accept) or `JoinRejectedEvent`.
 *
 * The password never leaves the device — only the PBKDF2-derived proof is sent.
 */
export function useJoinRoom({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onApproved,
  onRejected,
  onError,
}: UseJoinRoomOptions): UseJoinRoomReturn {
  const [result, setResult] = useState<JoinRoomResult>(initialResult);

  // Pending salt while invite info is loading
  const pendingSaltRef = useRef<string | null>(null);

  // Stable refs for callbacks — avoids re-subscribing on every render
  const onApprovedRef = useRef(onApproved);
  const onRejectedRef = useRef(onRejected);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onApprovedRef.current = onApproved;
    onRejectedRef.current = onRejected;
    onErrorRef.current = onError;
  });

  // ----------------------------------------
  // Invite info response handler
  // ----------------------------------------

  const handleInviteInfo = useCallback((message: IMessage) => {
    try {
      const data: ServerInviteInfoEvent = JSON.parse(message.body);
      if (data.success && data.salt && data.joinMode) {
        pendingSaltRef.current = data.salt;
        setResult(prev => ({
          ...prev,
          status: 'ready',
          joinMode: data.joinMode as RoomJoinMode,
          error: null,
        }));
      } else {
        const code = (data.error ?? 'INTERNAL_ERROR') as JoinRoomErrorCode;
        setResult({ status: 'error', joinMode: null, roomId: null, error: code });
        onErrorRef.current?.(code);
      }
    } catch {
      setResult({ status: 'error', joinMode: null, roomId: null, error: 'CONNECTION_ERROR' });
      onErrorRef.current?.('CONNECTION_ERROR');
    }
  }, []);

  // ----------------------------------------
  // Join result response handler
  // ----------------------------------------

  const handleJoinResult = useCallback((message: IMessage) => {
    try {
      const data = JSON.parse(message.body);

      // JoinRejectedEvent — has `roomId` but no `success` field
      if ('roomId' in data && !('success' in data)) {
        const rejected = data as ServerJoinRejectedEvent;
        setResult(prev => ({ ...prev, status: 'rejected', roomId: rejected.roomId }));
        onRejectedRef.current?.(rejected.roomId);
        return;
      }

      const approved = data as ServerJoinApprovedEvent;
      if (approved.success && approved.roomId) {
        setResult(prev => ({ ...prev, status: 'approved', roomId: approved.roomId ?? null, error: null }));
        onApprovedRef.current?.(approved.roomId);
      } else {
        const code = (approved.error ?? 'INTERNAL_ERROR') as JoinRoomErrorCode;
        setResult(prev => ({ ...prev, status: 'error', error: code }));
        onErrorRef.current?.(code);
      }
    } catch {
      setResult(prev => ({ ...prev, status: 'error', error: 'CONNECTION_ERROR' }));
      onErrorRef.current?.('CONNECTION_ERROR');
    }
  }, []);

  // ----------------------------------------
  // Subscriptions
  // ----------------------------------------

  const isSubscribedRef = useRef(false);

  useEffect(() => {
    if (!isSubscribedRef.current) {
      subscribe(INVITE_INFO_DESTINATION, handleInviteInfo);
      subscribe(JOIN_RESULT_DESTINATION, handleJoinResult);
      isSubscribedRef.current = true;
    }
    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(INVITE_INFO_DESTINATION);
        unsubscribe(JOIN_RESULT_DESTINATION);
        isSubscribedRef.current = false;
      }
    };
  }, [subscribe, unsubscribe, handleInviteInfo, handleJoinResult]);

  // ----------------------------------------
  // Public actions
  // ----------------------------------------

  const loadInviteInfo = useCallback(
    (token: string) => {
      if (!isConnected) {
        setResult({ status: 'error', joinMode: null, roomId: null, error: 'CONNECTION_ERROR' });
        onErrorRef.current?.('CONNECTION_ERROR');
        return;
      }
      pendingSaltRef.current = null;
      setResult({ status: 'loading-info', joinMode: null, roomId: null, error: null });
      publish(GET_INVITE_INFO_DESTINATION, { inviteToken: token });
    },
    [isConnected, publish]
  );

  const submitJoin = useCallback(
    async (token: string, password: string) => {
      if (!isConnected) {
        setResult(prev => ({ ...prev, status: 'error', error: 'CONNECTION_ERROR' }));
        onErrorRef.current?.('CONNECTION_ERROR');
        return;
      }

      setResult(prev => ({ ...prev, status: 'submitting', error: null }));

      try {
        const salt = pendingSaltRef.current ?? undefined;
        const { proof } = await derivePasswordProof(password, salt);

        publish(REQUEST_JOIN_DESTINATION, {
          inviteToken: token,
          passwordProof: proof,
        });

        // Transition to 'pending' — for BY_PASSWORD this gets quickly overwritten
        // by 'approved'; for BY_REQUEST it stays until the owner decides.
        setResult(prev => ({ ...prev, status: 'pending' }));
      } catch {
        setResult(prev => ({ ...prev, status: 'error', error: 'CRYPTO_ERROR' }));
        onErrorRef.current?.('CRYPTO_ERROR');
      }
    },
    [isConnected, publish]
  );

  const reset = useCallback(() => {
    pendingSaltRef.current = null;
    setResult(initialResult);
  }, []);

  return { result, loadInviteInfo, submitJoin, reset };
}
