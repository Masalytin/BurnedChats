import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { RoomMember } from '../types';

const GET_ROOM_MEMBERS_DESTINATION = '/app/room.getMembers';
const ROOM_MEMBERS_DESTINATION = '/user/queue/room-members';

interface ServerRoomMembersEvent {
  success: boolean;
  roomId?: string;
  members?: RoomMember[];
  error?: string;
}

interface UseRoomMembersOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

interface UseRoomMembersReturn {
  members: RoomMember[];
  isLoading: boolean;
  error: string | null;
  fetchMembers: (roomId: string) => void;
}

/**
 * Hook for fetching enriched room members.
 *
 * Sends GET_ROOM_MEMBERS to /app/room.getMembers and listens on
 * /user/queue/room-members for the response.
 */
export function useRoomMembers({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
}: UseRoomMembersOptions): UseRoomMembersReturn {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  const fetchMembers = useCallback((roomId: string) => {
    if (!isConnected) return;
    setIsLoading(true);
    setError(null);
    publishRef.current(GET_ROOM_MEMBERS_DESTINATION, { roomId });
  }, [isConnected]);

  useEffect(() => {
    const handleMessage = (message: IMessage) => {
      try {
        const event: ServerRoomMembersEvent = JSON.parse(message.body);
        if (event.success && event.members) {
          setMembers(event.members);
        } else {
          setError(event.error ?? 'UNKNOWN_ERROR');
        }
      } catch (e) {
        console.error('[useRoomMembers] Failed to parse room-members event:', e);
        setError('PARSE_ERROR');
      } finally {
        setIsLoading(false);
      }
    };

    subscribe(ROOM_MEMBERS_DESTINATION, handleMessage);
    return () => unsubscribe(ROOM_MEMBERS_DESTINATION);
  }, [subscribe, unsubscribe]);

  return { members, isLoading, error, fetchMembers };
}
