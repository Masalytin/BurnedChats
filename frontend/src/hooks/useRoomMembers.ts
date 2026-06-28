import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { RoomMember, RoomMemberRole } from '../types';

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
  removeMember: (internalId: string) => void;
  updateMemberRole: (internalId: string, role: RoomMemberRole) => void;
  applyOwnershipTransfer: (newOwnerInternalId: string, previousOwnerInternalId: string) => void;
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

  const pendingRoomIdRef = useRef<string | null>(null);

  const fetchMembers = useCallback((roomId: string) => {
    if (!isConnected) return;
    pendingRoomIdRef.current = roomId;
    setIsLoading(true);
    setError(null);
    publishRef.current(GET_ROOM_MEMBERS_DESTINATION, { roomId });
  }, [isConnected]);

  const removeMember = useCallback((internalId: string) => {
    setMembers(prev => prev.filter(member => member.internalId !== internalId));
  }, []);

  const updateMemberRole = useCallback((internalId: string, role: RoomMemberRole) => {
    setMembers(prev => prev.map(member =>
      member.internalId === internalId ? { ...member, role } : member,
    ));
  }, []);

  const applyOwnershipTransfer = useCallback(
    (newOwnerInternalId: string, previousOwnerInternalId: string) => {
      setMembers(prev => prev.map(member => {
        if (member.internalId === newOwnerInternalId) {
          return { ...member, role: 'owner' };
        }
        if (member.internalId === previousOwnerInternalId) {
          return { ...member, role: 'admin' };
        }
        return member;
      }));
    },
    [],
  );

  useEffect(() => {
    const handleMessage = (message: IMessage) => {
      try {
        const event: ServerRoomMembersEvent = JSON.parse(message.body);
        const requestedRoomId = pendingRoomIdRef.current;

        if (
          requestedRoomId
          && event.roomId
          && event.roomId !== requestedRoomId
        ) {
          return;
        }

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

  return {
    members,
    isLoading,
    error,
    fetchMembers,
    removeMember,
    updateMemberRole,
    applyOwnershipTransfer,
  };
}
