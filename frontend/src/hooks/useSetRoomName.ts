import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { encryptRoomName } from '../crypto/groupKey';
import { getGroupKey } from '../crypto/keyStore';

const SET_ROOM_NAME_DESTINATION = '/app/room.setName';
const ROOM_TOPIC_PREFIX = '/topic/room/';

interface RoomNameUpdatedEvent {
  eventType: 'ROOM_NAME_UPDATED';
  roomId: string;
  nameEncrypted: string;
  nameIv: string;
}

type RoomTopicHandler = (message: IMessage) => void;

export interface TopicMultiplexer {
  subscribe: (destination: string, callback: RoomTopicHandler) => unknown;
  unsubscribe: (destination: string, callback: RoomTopicHandler) => void;
}

/**
 * Multiplexes multiple handlers onto a single STOMP room topic subscription.
 * useRoomMessages and ROOM_NAME_UPDATED listeners share one `/topic/room/{id}` sub.
 */
export function createRoomTopicMultiplexer(
  rawSubscribe: (destination: string, callback: (message: IMessage) => void) => unknown,
  rawUnsubscribe: (destination: string) => void,
): TopicMultiplexer {
  const handlersByDestination = new Map<string, Set<RoomTopicHandler>>();
  const activeDestinations = new Set<string>();

  const dispatch = (destination: string, message: IMessage) => {
    const handlers = handlersByDestination.get(destination);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(message);
    }
  };

  return {
    subscribe(destination: string, callback: RoomTopicHandler) {
      if (!destination.startsWith(ROOM_TOPIC_PREFIX)) {
        return rawSubscribe(destination, callback);
      }

      let handlers = handlersByDestination.get(destination);
      if (!handlers) {
        handlers = new Set();
        handlersByDestination.set(destination, handlers);
      }
      handlers.add(callback);

      if (!activeDestinations.has(destination)) {
        activeDestinations.add(destination);
        rawSubscribe(destination, (message) => dispatch(destination, message));
      }

      return null;
    },

    unsubscribe(destination: string, callback: RoomTopicHandler) {
      if (!destination.startsWith(ROOM_TOPIC_PREFIX)) {
        rawUnsubscribe(destination);
        return;
      }

      const handlers = handlersByDestination.get(destination);
      if (!handlers) return;

      handlers.delete(callback);
      if (handlers.size === 0) {
        handlersByDestination.delete(destination);
        if (activeDestinations.has(destination)) {
          activeDestinations.delete(destination);
          rawUnsubscribe(destination);
        }
      }
    },
  };
}

function parseRoomNameUpdated(message: IMessage): RoomNameUpdatedEvent | null {
  try {
    const data = JSON.parse(message.body) as Partial<RoomNameUpdatedEvent>;
    if (
      data.eventType === 'ROOM_NAME_UPDATED'
      && typeof data.roomId === 'string'
      && typeof data.nameEncrypted === 'string'
      && typeof data.nameIv === 'string'
    ) {
      return data as RoomNameUpdatedEvent;
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
}

interface UseSetRoomNameOptions {
  isConnected: boolean;
  publish: (destination: string, body: unknown) => void;
  topicMultiplexer: TopicMultiplexer;
  roomIds: string[];
  onNameUpdated?: (roomId: string, nameEncrypted: string, nameIv: string) => void;
}

export interface UseSetRoomNameReturn {
  /** Owner-only: encrypt and publish SET_ROOM_NAME. */
  setRoomName: (roomId: string, name: string) => Promise<void>;
}

/**
 * Hook for changing a room's encrypted display name and listening for ROOM_NAME_UPDATED.
 */
export function useSetRoomName({
  isConnected,
  publish,
  topicMultiplexer,
  roomIds,
  onNameUpdated,
}: UseSetRoomNameOptions): UseSetRoomNameReturn {
  const onNameUpdatedRef = useRef(onNameUpdated);
  useEffect(() => {
    onNameUpdatedRef.current = onNameUpdated;
  });

  const setRoomName = useCallback(
    async (roomId: string, name: string) => {
      if (!isConnected) {
        throw new Error('NOT_CONNECTED');
      }
      const groupKey = getGroupKey(roomId);
      if (!groupKey) {
        throw new Error('NO_GROUP_KEY');
      }
      const encrypted = await encryptRoomName(name, groupKey, roomId);
      publish(SET_ROOM_NAME_DESTINATION, {
        roomId,
        nameEncrypted: encrypted.nameEncrypted,
        nameIv: encrypted.nameIv,
      });
      onNameUpdatedRef.current?.(roomId, encrypted.nameEncrypted, encrypted.nameIv);
    },
    [isConnected, publish],
  );

  const roomIdsKey = useMemo(() => roomIds.slice().sort().join(','), [roomIds]);

  useEffect(() => {
    if (!isConnected || roomIds.length === 0) return;

    const handlers = new Map<string, RoomTopicHandler>();

    for (const roomId of roomIds) {
      const destination = `${ROOM_TOPIC_PREFIX}${roomId}`;
      const handler: RoomTopicHandler = (message) => {
        const event = parseRoomNameUpdated(message);
        if (event && event.roomId === roomId) {
          onNameUpdatedRef.current?.(roomId, event.nameEncrypted, event.nameIv);
        }
      };
      handlers.set(destination, handler);
      topicMultiplexer.subscribe(destination, handler);
    }

    return () => {
      for (const [destination, handler] of handlers) {
        topicMultiplexer.unsubscribe(destination, handler);
      }
    };
  }, [isConnected, roomIdsKey, topicMultiplexer, roomIds]);

  return { setRoomName };
}
