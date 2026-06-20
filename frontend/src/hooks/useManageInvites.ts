import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';

const GET_INVITES_DESTINATION = '/app/room.getInvites';
const REVOKE_INVITE_DESTINATION = '/app/room.revokeInvite';
const ROOM_INVITES_DESTINATION = '/user/queue/room-invites';

export interface RoomInvite {
  token: string;
  url: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number | null;
  usedCount: number;
}

interface ServerRoomInvitesEvent {
  success: boolean;
  roomId?: string;
  invites?: RoomInvite[];
  error?: string;
}

interface UseManageInvitesOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

interface UseManageInvitesReturn {
  invites: RoomInvite[];
  isLoading: boolean;
  error: string | null;
  refresh: (roomId: string) => void;
  revoke: (roomId: string, token: string) => void;
}

/**
 * Hook for listing and revoking room invite links (owner only).
 *
 * Sends GET_INVITES to /app/room.getInvites and listens on
 * /user/queue/room-invites. Revoke is fire-and-forget via /app/room.revokeInvite.
 */
export function useManageInvites({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
}: UseManageInvitesOptions): UseManageInvitesReturn {
  const [invites, setInvites] = useState<RoomInvite[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publishRef = useRef(publish);
  const pendingRoomIdRef = useRef<string | null>(null);

  useEffect(() => {
    publishRef.current = publish;
  }, [publish]);

  const refresh = useCallback((roomId: string) => {
    if (!isConnected) return;
    pendingRoomIdRef.current = roomId;
    setIsLoading(true);
    setError(null);
    publishRef.current(GET_INVITES_DESTINATION, { roomId });
  }, [isConnected]);

  const revoke = useCallback((roomId: string, token: string) => {
    if (!isConnected) return;
    publishRef.current(REVOKE_INVITE_DESTINATION, { roomId, token });
    setInvites(prev => prev.filter(inv => inv.token !== token));
    refresh(roomId);
  }, [isConnected, refresh]);

  useEffect(() => {
    const handleMessage = (message: IMessage) => {
      try {
        const event: ServerRoomInvitesEvent = JSON.parse(message.body);
        const expectedRoomId = pendingRoomIdRef.current;
        if (expectedRoomId && event.roomId && event.roomId !== expectedRoomId) {
          return;
        }
        if (event.success && event.invites) {
          setInvites(event.invites);
          setError(null);
        } else {
          setError(event.error ?? 'UNKNOWN_ERROR');
        }
      } catch (e) {
        console.error('[useManageInvites] Failed to parse room-invites event:', e);
        setError('PARSE_ERROR');
      } finally {
        setIsLoading(false);
      }
    };

    subscribe(ROOM_INVITES_DESTINATION, handleMessage);
    return () => unsubscribe(ROOM_INVITES_DESTINATION);
  }, [subscribe, unsubscribe]);

  return { invites, isLoading, error, refresh, revoke };
}
