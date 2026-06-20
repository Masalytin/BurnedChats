import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';

const MUTE_MEMBER_DESTINATION = '/app/room.mute';
const UNMUTE_MEMBER_DESTINATION = '/app/room.unmute';
const SET_READ_ONLY_DESTINATION = '/app/room.setReadOnly';

export interface RoomModerationState {
  readOnly: boolean;
  mutedIds: string[];
}

export interface RoomModerationEvent {
  eventType: 'ROOM_MODERATION';
  roomId: string;
  readOnly?: boolean;
  mutedAdded?: string | null;
  mutedRemoved?: string | null;
}

interface UseRoomModerationOptions {
  isConnected: boolean;
  roomId: string | null;
  /** When true, this hook owns `/topic/room/{roomId}` (e.g. manage view without chat mounted). */
  ownsTopicSubscription: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

interface UseRoomModerationReturn extends RoomModerationState {
  mute: (roomId: string, targetInternalId: string) => void;
  unmute: (roomId: string, targetInternalId: string) => void;
  setReadOnly: (roomId: string, readOnly: boolean) => void;
  handleModerationEvent: (event: RoomModerationEvent) => void;
  isMuted: (internalId: string) => boolean;
}

const EMPTY_STATE: RoomModerationState = { readOnly: false, mutedIds: [] };

function applyModerationEvent(
  prev: RoomModerationState,
  event: RoomModerationEvent,
): RoomModerationState {
  let { readOnly, mutedIds } = prev;
  if (typeof event.readOnly === 'boolean') {
    readOnly = event.readOnly;
  }
  if (event.mutedAdded) {
    mutedIds = mutedIds.includes(event.mutedAdded)
      ? mutedIds
      : [...mutedIds, event.mutedAdded];
  }
  if (event.mutedRemoved) {
    mutedIds = mutedIds.filter(id => id !== event.mutedRemoved);
  }
  return { readOnly, mutedIds };
}

function getRoomTopic(roomId: string): string {
  return `/topic/room/${roomId}`;
}

/**
 * Hook for room mute / read-only moderation (IMP-ROOM-12).
 *
 * Publishes owner actions via STOMP; state updates from `ROOM_MODERATION` on
 * `/topic/room/{roomId}`. When the chat view is mounted, topic events are
 * forwarded from {@link useRoomMessages} via {@link handleModerationEvent}.
 */
export function useRoomModeration({
  isConnected,
  roomId,
  ownsTopicSubscription,
  subscribe,
  unsubscribe,
  publish,
}: UseRoomModerationOptions): UseRoomModerationReturn {
  const [state, setState] = useState<RoomModerationState>(EMPTY_STATE);

  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  useEffect(() => {
    setState(EMPTY_STATE);
  }, [roomId]);

  const handleModerationEvent = useCallback((event: RoomModerationEvent) => {
    if (!roomId || event.roomId !== roomId) return;
    if (event.eventType !== 'ROOM_MODERATION') return;
    setState(prev => applyModerationEvent(prev, event));
  }, [roomId]);

  const handleTopicMessage = useCallback((message: IMessage) => {
    try {
      const event = JSON.parse(message.body) as RoomModerationEvent;
      if (event.eventType !== 'ROOM_MODERATION') return;
      handleModerationEvent(event);
    } catch (e) {
      console.error('[useRoomModeration] Failed to parse topic event:', e);
    }
  }, [handleModerationEvent]);

  useEffect(() => {
    if (!ownsTopicSubscription || !roomId || !isConnected) return;

    const destination = getRoomTopic(roomId);
    subscribe(destination, handleTopicMessage);
    return () => unsubscribe(destination);
  }, [ownsTopicSubscription, roomId, isConnected, subscribe, unsubscribe, handleTopicMessage]);

  const mute = useCallback((targetRoomId: string, targetInternalId: string) => {
    if (!isConnected) return;
    publishRef.current(MUTE_MEMBER_DESTINATION, {
      roomId: targetRoomId,
      targetInternalId,
    });
  }, [isConnected]);

  const unmute = useCallback((targetRoomId: string, targetInternalId: string) => {
    if (!isConnected) return;
    publishRef.current(UNMUTE_MEMBER_DESTINATION, {
      roomId: targetRoomId,
      targetInternalId,
    });
  }, [isConnected]);

  const setReadOnlyMode = useCallback((targetRoomId: string, readOnly: boolean) => {
    if (!isConnected) return;
    publishRef.current(SET_READ_ONLY_DESTINATION, {
      roomId: targetRoomId,
      readOnly,
    });
  }, [isConnected]);

  const isMuted = useCallback(
    (internalId: string) => state.mutedIds.includes(internalId),
    [state.mutedIds],
  );

  return {
    readOnly: state.readOnly,
    mutedIds: state.mutedIds,
    mute,
    unmute,
    setReadOnly: setReadOnlyMode,
    handleModerationEvent,
    isMuted,
  };
}
