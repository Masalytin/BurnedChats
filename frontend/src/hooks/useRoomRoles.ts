import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { TopicMultiplexer } from './useSetRoomName';
import type { RoomListEntry, RoomMemberRole, RoomRole } from '../types';

const SET_ROLE_DESTINATION = '/app/room.setRole';
const TRANSFER_OWNERSHIP_DESTINATION = '/app/room.transferOwnership';
const ROOM_TOPIC_PREFIX = '/topic/room/';

export interface RoomRoleUpdatedEvent {
  eventType: 'ROOM_ROLE_UPDATED';
  roomId: string;
  targetInternalId: string;
  role: 'admin' | 'member';
}

export interface RoomOwnershipTransferredEvent {
  eventType: 'ROOM_OWNERSHIP_TRANSFERRED';
  roomId: string;
  newOwnerInternalId: string;
  previousOwnerInternalId: string;
}

interface UseRoomRolesOptions {
  isConnected: boolean;
  roomId: string | null;
  myInternalId: string | null;
  myRooms: RoomListEntry[];
  topicMultiplexer: TopicMultiplexer;
  publish: (destination: string, body: unknown) => void;
  updateRoomRole: (roomId: string, role: RoomRole) => void;
  onMemberRoleUpdated?: (targetInternalId: string, role: RoomMemberRole) => void;
  onOwnershipTransferred?: (
    newOwnerInternalId: string,
    previousOwnerInternalId: string,
  ) => void;
}

interface UseRoomRolesReturn {
  myRole: RoomRole | null;
  setRole: (targetInternalId: string, role: 'admin' | 'member') => void;
  transferOwnership: (newOwnerInternalId: string) => void;
}

function parseTopicEvent(message: IMessage): RoomRoleUpdatedEvent | RoomOwnershipTransferredEvent | null {
  try {
    const data = JSON.parse(message.body) as Record<string, unknown>;
    if (
      data.eventType === 'ROOM_ROLE_UPDATED'
      && typeof data.roomId === 'string'
      && typeof data.targetInternalId === 'string'
      && (data.role === 'admin' || data.role === 'member')
    ) {
      return data as unknown as RoomRoleUpdatedEvent;
    }
    if (
      data.eventType === 'ROOM_OWNERSHIP_TRANSFERRED'
      && typeof data.roomId === 'string'
      && typeof data.newOwnerInternalId === 'string'
      && typeof data.previousOwnerInternalId === 'string'
    ) {
      return data as unknown as RoomOwnershipTransferredEvent;
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
}

/**
 * Hook for room role management (IMP-ROOM-15).
 *
 * Publishes setRole / transferOwnership; listens on `/topic/room/{roomId}` for
 * ROOM_ROLE_UPDATED and ROOM_OWNERSHIP_TRANSFERRED to keep myRooms and member rows in sync.
 */
export function useRoomRoles({
  isConnected,
  roomId,
  myInternalId,
  myRooms,
  topicMultiplexer,
  publish,
  updateRoomRole,
  onMemberRoleUpdated,
  onOwnershipTransferred,
}: UseRoomRolesOptions): UseRoomRolesReturn {
  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  const updateRoomRoleRef = useRef(updateRoomRole);
  useEffect(() => { updateRoomRoleRef.current = updateRoomRole; }, [updateRoomRole]);

  const onMemberRoleUpdatedRef = useRef(onMemberRoleUpdated);
  useEffect(() => { onMemberRoleUpdatedRef.current = onMemberRoleUpdated; }, [onMemberRoleUpdated]);

  const onOwnershipTransferredRef = useRef(onOwnershipTransferred);
  useEffect(() => { onOwnershipTransferredRef.current = onOwnershipTransferred; }, [onOwnershipTransferred]);

  const myInternalIdRef = useRef(myInternalId);
  useEffect(() => { myInternalIdRef.current = myInternalId; }, [myInternalId]);

  const myRole = useMemo((): RoomRole | null => {
    if (!roomId) return null;
    return myRooms.find(r => r.roomId === roomId)?.role ?? null;
  }, [roomId, myRooms]);

  useEffect(() => {
    if (!isConnected || !roomId) return;

    const destination = `${ROOM_TOPIC_PREFIX}${roomId}`;
    const handler = (message: IMessage) => {
      const event = parseTopicEvent(message);
      if (!event || event.roomId !== roomId) return;

      if (event.eventType === 'ROOM_ROLE_UPDATED') {
        onMemberRoleUpdatedRef.current?.(event.targetInternalId, event.role);
        if (event.targetInternalId === myInternalIdRef.current) {
          updateRoomRoleRef.current(roomId, event.role);
        }
        return;
      }

      if (event.eventType === 'ROOM_OWNERSHIP_TRANSFERRED') {
        onOwnershipTransferredRef.current?.(
          event.newOwnerInternalId,
          event.previousOwnerInternalId,
        );
        const selfId = myInternalIdRef.current;
        if (selfId === event.newOwnerInternalId) {
          updateRoomRoleRef.current(roomId, 'owner');
        } else if (selfId === event.previousOwnerInternalId) {
          updateRoomRoleRef.current(roomId, 'admin');
        }
      }
    };

    topicMultiplexer.subscribe(destination, handler);
    return () => topicMultiplexer.unsubscribe(destination, handler);
  }, [isConnected, roomId, topicMultiplexer]);

  const setRole = useCallback((targetInternalId: string, role: 'admin' | 'member') => {
    if (!isConnected || !roomId) return;
    publishRef.current(SET_ROLE_DESTINATION, { roomId, targetInternalId, role });
  }, [isConnected, roomId]);

  const transferOwnership = useCallback((newOwnerInternalId: string) => {
    if (!isConnected || !roomId) return;
    publishRef.current(TRANSFER_OWNERSHIP_DESTINATION, { roomId, newOwnerInternalId });
  }, [isConnected, roomId]);

  return { myRole, setRole, transferOwnership };
}
