import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { RoomListEntry } from '../types';

const GET_MY_ROOMS_DESTINATION = '/app/room.getMyRooms';
const ROOM_LIST_DESTINATION = '/user/queue/room-list';

interface ServerRoomListEvent {
  success: boolean;
  rooms?: Array<{
    roomId: string;
    role: 'owner' | 'admin' | 'member';
    createdAt: number;
    nameEncrypted?: string | null;
    nameIv?: string | null;
  }>;
  error?: string;
}

interface UseMyRoomsOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

interface UseMyRoomsReturn {
  rooms: RoomListEntry[];
  isLoading: boolean;
  fetchRooms: () => void;
  updateRoomName: (roomId: string, nameEncrypted: string, nameIv: string) => void;
  updateRoomRole: (roomId: string, role: RoomListEntry['role']) => void;
}

/**
 * Hook for fetching the list of rooms the current user participates in.
 *
 * Sends GET_MY_ROOMS on connect and exposes a manual fetchRooms() trigger.
 * The server responds via /user/queue/room-list with a ROOM_LIST event.
 */
export function useMyRooms({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
}: UseMyRoomsOptions): UseMyRoomsReturn {
  const [rooms, setRooms] = useState<RoomListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  const fetchRooms = useCallback(() => {
    if (!isConnected) return;
    setIsLoading(true);
    publishRef.current(GET_MY_ROOMS_DESTINATION, {});
  }, [isConnected]);

  const updateRoomName = useCallback((roomId: string, nameEncrypted: string, nameIv: string) => {
    setRooms(prev => prev.map(room =>
      room.roomId === roomId
        ? { ...room, nameEncrypted, nameIv }
        : room,
    ));
  }, []);

  const updateRoomRole = useCallback((roomId: string, role: RoomListEntry['role']) => {
    setRooms(prev => prev.map(room =>
      room.roomId === roomId ? { ...room, role } : room,
    ));
  }, []);

  // Subscribe to room-list response
  useEffect(() => {
    const handleMessage = (message: IMessage) => {
      try {
        const event: ServerRoomListEvent = JSON.parse(message.body);
        if (event.success && event.rooms) {
          setRooms(event.rooms.map(r => ({
            roomId: r.roomId,
            role: r.role,
            createdAt: r.createdAt,
            nameEncrypted: r.nameEncrypted,
            nameIv: r.nameIv,
          })));
        } else {
          console.warn('[useMyRooms] ROOM_LIST error:', event.error);
        }
      } catch (e) {
        console.error('[useMyRooms] Failed to parse ROOM_LIST:', e);
      } finally {
        setIsLoading(false);
      }
    };

    subscribe(ROOM_LIST_DESTINATION, handleMessage);
    return () => unsubscribe(ROOM_LIST_DESTINATION);
  }, [subscribe, unsubscribe]);

  // Auto-fetch on connect
  useEffect(() => {
    if (isConnected) {
      fetchRooms();
    }
  }, [isConnected, fetchRooms]);

  return { rooms, isLoading, fetchRooms, updateRoomName, updateRoomRole };
}
