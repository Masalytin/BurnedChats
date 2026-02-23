import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { derivePasswordProof } from '../crypto/kdf';
import type { Room } from '../types/index';

const CREATE_ROOM_DESTINATION = '/app/room.create';
const ROOM_CREATED_DESTINATION = '/user/queue/room-created';

export type RoomJoinMode = 'BY_PASSWORD' | 'BY_REQUEST';

export type CreateRoomErrorCode =
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'CONNECTION_ERROR'
  | 'CRYPTO_ERROR';

export type CreateRoomStatus = 'idle' | 'creating' | 'created' | 'error';

export interface CreateRoomResult {
  status: CreateRoomStatus;
  roomId: string | null;
  /** Telegram deep-link invite URL returned by the server at room creation. */
  inviteUrl: string | null;
  error: CreateRoomErrorCode | null;
}

interface ServerRoomCreatedEvent {
  success: boolean;
  roomId?: string;
  inviteUrl?: string;
  error?: string;
}

interface UseCreateRoomOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
  onCreated?: (room: Room) => void;
  onError?: (error: CreateRoomErrorCode) => void;
}

interface UseCreateRoomReturn {
  result: CreateRoomResult;
  createRoom: (password: string, joinMode: RoomJoinMode, nameEncrypted?: string) => Promise<void>;
  reset: () => void;
  isCreating: boolean;
}

const initialResult: CreateRoomResult = {
  status: 'idle',
  roomId: null,
  inviteUrl: null,
  error: null,
};

/**
 * Hook for creating a room via STOMP WebSocket.
 *
 * Handles:
 * - Client-side KDF (PBKDF2) before sending — password never leaves the device
 * - Sending CREATE_ROOM payload
 * - Subscribing to ROOM_CREATED response
 */
export function useCreateRoom({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onCreated,
  onError,
}: UseCreateRoomOptions): UseCreateRoomReturn {
  const [result, setResult] = useState<CreateRoomResult>(initialResult);
  const isSubscribedRef = useRef(false);
  const onCreatedRef = useRef(onCreated);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onCreatedRef.current = onCreated;
    onErrorRef.current = onError;
  });

  const handleRoomCreated = useCallback((message: IMessage) => {
    try {
      const data: ServerRoomCreatedEvent = JSON.parse(message.body);

      if (!data.success || !data.roomId) {
        const errorCode = (data.error ?? 'INTERNAL_ERROR') as CreateRoomErrorCode;
        setResult({ status: 'error', roomId: null, inviteUrl: null, error: errorCode });
        onErrorRef.current?.(errorCode);
        return;
      }

      setResult({ status: 'created', roomId: data.roomId, inviteUrl: data.inviteUrl ?? null, error: null });
      onCreatedRef.current?.({ id: data.roomId } as Room);
    } catch {
      setResult({ status: 'error', roomId: null, inviteUrl: null, error: 'CONNECTION_ERROR' });
      onErrorRef.current?.('CONNECTION_ERROR');
    }
  }, []);

  useEffect(() => {
    if (!isSubscribedRef.current) {
      subscribe(ROOM_CREATED_DESTINATION, handleRoomCreated);
      isSubscribedRef.current = true;
    }
    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(ROOM_CREATED_DESTINATION);
        isSubscribedRef.current = false;
      }
    };
  }, [subscribe, unsubscribe, handleRoomCreated]);

  const createRoom = useCallback(
    async (password: string, joinMode: RoomJoinMode, nameEncrypted?: string) => {
      if (!isConnected) {
        setResult({ status: 'error', roomId: null, inviteUrl: null, error: 'CONNECTION_ERROR' });
        onErrorRef.current?.('CONNECTION_ERROR');
        return;
      }

      setResult({ status: 'creating', roomId: null, inviteUrl: null, error: null });

      try {
        const { salt, proof } = await derivePasswordProof(password);

        const payload: Record<string, unknown> = {
          salt,
          passwordProof: proof,
          joinMode,
        };
        if (nameEncrypted) {
          payload.nameEncrypted = nameEncrypted;
        }

        publish(CREATE_ROOM_DESTINATION, payload);
      } catch {
        setResult({ status: 'error', roomId: null, inviteUrl: null, error: 'CRYPTO_ERROR' });
        onErrorRef.current?.('CRYPTO_ERROR');
      }
    },
    [isConnected, publish]
  );

  const reset = useCallback(() => {
    setResult(initialResult);
  }, []);

  return {
    result,
    createRoom,
    reset,
    isCreating: result.status === 'creating',
  };
}
