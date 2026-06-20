import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { derivePasswordProof } from '../crypto/kdf';
import { encryptRoomName, generateGroupKey } from '../crypto/groupKey';
import { storeGroupKey, storeKeyPair } from '../crypto/keyStore';
import { generateKeyPair, exportPublicKey } from '../crypto/ecdh';
import type { Room } from '../types/index';

const CREATE_ROOM_DESTINATION = '/app/room.create';
const SET_ROOM_NAME_DESTINATION = '/app/room.setName';
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
  /**
   * Called after ROOM_CREATED and local group key / owner keypair storage.
   * @param inviteUrl Telegram deep-link from server, or null if missing.
   */
  onCreated?: (room: Room, inviteUrl: string | null) => void;
  onRoomNameSet?: (roomId: string, nameEncrypted: string, nameIv: string) => void;
  onError?: (error: CreateRoomErrorCode) => void;
}

interface UseCreateRoomReturn {
  result: CreateRoomResult;
  /** When joinMode is BY_REQUEST, password may be null (room without password). */
  createRoom: (
    password: string | null,
    joinMode: RoomJoinMode,
    roomName?: string,
  ) => Promise<void>;
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
  onRoomNameSet,
  onError,
}: UseCreateRoomOptions): UseCreateRoomReturn {
  const [result, setResult] = useState<CreateRoomResult>(initialResult);
  const isSubscribedRef = useRef(false);
  const onCreatedRef = useRef(onCreated);
  const onRoomNameSetRef = useRef(onRoomNameSet);
  const onErrorRef = useRef(onError);
  const publishRef = useRef(publish);

  useEffect(() => {
    onCreatedRef.current = onCreated;
    onRoomNameSetRef.current = onRoomNameSet;
    onErrorRef.current = onError;
    publishRef.current = publish;
  });

  const handleRoomCreated = useCallback((message: IMessage) => {
    const handleAsync = async () => {
      const data: ServerRoomCreatedEvent = JSON.parse(message.body);

      if (!data.success || !data.roomId) {
        const errorCode = (data.error ?? 'INTERNAL_ERROR') as CreateRoomErrorCode;
        setResult({ status: 'error', roomId: null, inviteUrl: null, error: errorCode });
        onErrorRef.current?.(errorCode);
        return;
      }

      // Generate group key for the room (owner is the first and only member at this point).
      // epoch=0 is the initial key; it will be incremented on rekey after member leaves.
      const groupKey = await generateGroupKey();
      storeGroupKey(data.roomId, 0, groupKey);

      // Optional display name: backend CREATE_ROOM lacks nameIv — set via SET_ROOM_NAME (IMP-ROOM-06).
      const pendingName = pendingRoomNameRef.current?.trim();
      if (pendingName) {
        try {
          const encryptedName = await encryptRoomName(pendingName, groupKey, data.roomId);
          publishRef.current(SET_ROOM_NAME_DESTINATION, {
            roomId: data.roomId,
            nameEncrypted: encryptedName.nameEncrypted,
            nameIv: encryptedName.nameIv,
          });
          onRoomNameSetRef.current?.(data.roomId, encryptedName.nameEncrypted, encryptedName.nameIv);
        } catch {
          setResult({ status: 'error', roomId: null, inviteUrl: null, error: 'CRYPTO_ERROR' });
          onErrorRef.current?.('CRYPTO_ERROR');
          return;
        }
      }
      pendingRoomNameRef.current = null;

      // Move the pending room keypair from the temp key to the canonical room-join:{roomId} key
      if (pendingRoomKeypairRef.current) {
        const { roomKeyId } = pendingRoomKeypairRef.current;
        const { getSessionKeys, burn } = await import('../crypto/keyStore');
        const existing = getSessionKeys(roomKeyId);
        if (existing) {
          storeKeyPair(`room-join:${data.roomId}`, existing.keyPair);
          burn(roomKeyId);
        }
        pendingRoomKeypairRef.current = null;
      }

      setResult({ status: 'created', roomId: data.roomId, inviteUrl: data.inviteUrl ?? null, error: null });
      onCreatedRef.current?.({ id: data.roomId } as Room, data.inviteUrl ?? null);
    };

    handleAsync().catch(() => {
      setResult({ status: 'error', roomId: null, inviteUrl: null, error: 'CRYPTO_ERROR' });
      onErrorRef.current?.('CRYPTO_ERROR');
    });
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

  // Ref to store the room keypair between createRoom() call and ROOM_CREATED response
  const pendingRoomKeypairRef = useRef<{ roomKeyId: string } | null>(null);
  /** Plaintext room name held until ROOM_CREATED (never logged). */
  const pendingRoomNameRef = useRef<string | null>(null);

  const createRoom = useCallback(
    async (password: string | null, joinMode: RoomJoinMode, roomName?: string) => {
      if (!isConnected) {
        setResult({ status: 'error', roomId: null, inviteUrl: null, error: 'CONNECTION_ERROR' });
        onErrorRef.current?.('CONNECTION_ERROR');
        return;
      }

      setResult({ status: 'creating', roomId: null, inviteUrl: null, error: null });
      pendingRoomNameRef.current = roomName?.trim() || null;

      const hasPassword = password != null && password.length > 0;

      try {
        let salt: string | null = null;
        let proof: string | null = null;
        if (hasPassword) {
          const derived = await derivePasswordProof(password);
          salt = derived.salt;
          proof = derived.proof;
        }

        const ownerKeyPair = await generateKeyPair();

        // Store keypair under a temp key; moved to room-join:{roomId} in handleRoomCreated
        const tempKeyId = `room-join-pending-${Date.now()}`;
        storeKeyPair(tempKeyId, ownerKeyPair);
        pendingRoomKeypairRef.current = { roomKeyId: tempKeyId };

        const ownerPublicKey = await exportPublicKey(ownerKeyPair.publicKey);

        const payload: Record<string, unknown> = {
          joinMode,
          ownerPublicKey,
        };
        if (salt != null && proof != null) {
          payload.salt = salt;
          payload.passwordProof = proof;
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
    pendingRoomNameRef.current = null;
    setResult(initialResult);
  }, []);

  return {
    result,
    createRoom,
    reset,
    isCreating: result.status === 'creating',
  };
}
