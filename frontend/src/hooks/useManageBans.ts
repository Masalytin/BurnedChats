import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';

const BAN_MEMBER_DESTINATION = '/app/room.ban';
const UNBAN_MEMBER_DESTINATION = '/app/room.unban';
const GET_ROOM_BANS_DESTINATION = '/app/room.getBans';
const ROOM_BANS_DESTINATION = '/user/queue/room-bans';

interface RoomBanListEvent {
  success: boolean;
  roomId?: string;
  bans?: string[];
  error?: string;
}

interface UseManageBansOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

interface UseManageBansReturn {
  bans: string[];
  isLoading: boolean;
  error: string | null;
  refresh: (roomId: string) => void;
  unban: (roomId: string, targetInternalId: string) => void;
  ban: (roomId: string, targetInternalId: string) => void;
}

/**
 * Hook for owner ban list management (IMP-ROOM-10).
 *
 * Sends `/app/room.getBans` and listens on `/user/queue/room-bans`.
 * Ban uses `/app/room.ban` (ack on `/user/queue/room-kick-result` via useKickMember).
 * Unban is fire-and-forget via `/app/room.unban`.
 */
export function useManageBans({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
}: UseManageBansOptions): UseManageBansReturn {
  const [bans, setBans] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  const pendingRoomIdRef = useRef<string | null>(null);

  const refresh = useCallback((roomId: string) => {
    if (!isConnected) return;
    pendingRoomIdRef.current = roomId;
    setIsLoading(true);
    setError(null);
    publishRef.current(GET_ROOM_BANS_DESTINATION, { roomId });
  }, [isConnected]);

  const ban = useCallback((roomId: string, targetInternalId: string) => {
    if (!isConnected) return;
    publishRef.current(BAN_MEMBER_DESTINATION, { roomId, targetInternalId });
  }, [isConnected]);

  const unban = useCallback((roomId: string, targetInternalId: string) => {
    if (!isConnected) return;
    publishRef.current(UNBAN_MEMBER_DESTINATION, { roomId, targetInternalId });
    setBans(prev => prev.filter(id => id !== targetInternalId));
    refresh(roomId);
  }, [isConnected, refresh]);

  useEffect(() => {
    const handleMessage = (message: IMessage) => {
      try {
        const event: RoomBanListEvent = JSON.parse(message.body);
        if (event.success && event.bans) {
          setBans(event.bans);
          setError(null);
        } else {
          setError(event.error ?? 'UNKNOWN_ERROR');
        }
      } catch (e) {
        console.error('[useManageBans] Failed to parse room-bans event:', e);
        setError('PARSE_ERROR');
      } finally {
        setIsLoading(false);
      }
    };

    subscribe(ROOM_BANS_DESTINATION, handleMessage);
    return () => unsubscribe(ROOM_BANS_DESTINATION);
  }, [subscribe, unsubscribe]);

  return { bans, isLoading, error, refresh, unban, ban };
}
