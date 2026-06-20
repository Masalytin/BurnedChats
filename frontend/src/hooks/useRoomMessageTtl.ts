import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { TopicMultiplexer } from './useSetRoomName';

const SET_MESSAGE_TTL_DESTINATION = '/app/room.setMessageTtl';
const ROOM_TOPIC_PREFIX = '/topic/room/';

export const MESSAGE_TTL_PRESETS = ['off', '5m', '1h', '24h'] as const;
export type MessageTtlPreset = (typeof MESSAGE_TTL_PRESETS)[number];

export const MESSAGE_TTL_PRESET_SECONDS: Record<MessageTtlPreset, number> = {
  off: 0,
  '5m': 300,
  '1h': 3600,
  '24h': 86400,
};

export interface RoomMessageTtlUpdatedEvent {
  eventType: 'ROOM_MESSAGE_TTL_UPDATED';
  roomId: string;
  messageTtlSeconds: number;
}

interface UseRoomMessageTtlOptions {
  isConnected: boolean;
  roomId: string | null;
  topicMultiplexer: TopicMultiplexer;
  publish: (destination: string, body: unknown) => void;
}

interface UseRoomMessageTtlReturn {
  messageTtlSeconds: number;
  setMessageTtl: (messageTtlSeconds: number) => void;
  applyPreset: (preset: MessageTtlPreset) => void;
  matchPreset: (seconds: number) => MessageTtlPreset;
  handleMessageTtlUpdatedEvent: (event: RoomMessageTtlUpdatedEvent) => void;
}

function parseRoomMessageTtlUpdated(message: IMessage): RoomMessageTtlUpdatedEvent | null {
  try {
    const data = JSON.parse(message.body) as Partial<RoomMessageTtlUpdatedEvent>;
    if (
      data.eventType === 'ROOM_MESSAGE_TTL_UPDATED'
      && typeof data.roomId === 'string'
      && typeof data.messageTtlSeconds === 'number'
    ) {
      return {
        eventType: 'ROOM_MESSAGE_TTL_UPDATED',
        roomId: data.roomId,
        messageTtlSeconds: data.messageTtlSeconds,
      };
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
}

/** Map server seconds back to a preset chip, defaulting to off when disabled. */
export function matchMessageTtlPreset(messageTtlSeconds: number): MessageTtlPreset {
  for (const preset of MESSAGE_TTL_PRESETS) {
    if (MESSAGE_TTL_PRESET_SECONDS[preset] === messageTtlSeconds) {
      return preset;
    }
  }
  return messageTtlSeconds <= 0 ? 'off' : 'off';
}

/**
 * Hook for owner-managed per-message auto-destruction TTL (IMP-ROOM-19).
 *
 * Publishes `/app/room.setMessageTtl`; listens on `/topic/room/{roomId}` for
 * `ROOM_MESSAGE_TTL_UPDATED` via the shared topic multiplexer.
 */
export function useRoomMessageTtl({
  isConnected,
  roomId,
  topicMultiplexer,
  publish,
}: UseRoomMessageTtlOptions): UseRoomMessageTtlReturn {
  const [messageTtlSeconds, setMessageTtlSeconds] = useState(0);

  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  useEffect(() => {
    setMessageTtlSeconds(0);
  }, [roomId]);

  const handleMessageTtlUpdatedEvent = useCallback((event: RoomMessageTtlUpdatedEvent) => {
    if (!roomId || event.roomId !== roomId) return;
    setMessageTtlSeconds(event.messageTtlSeconds);
  }, [roomId]);

  useEffect(() => {
    if (!isConnected || !roomId) return;

    const destination = `${ROOM_TOPIC_PREFIX}${roomId}`;
    const handler = (message: IMessage) => {
      const event = parseRoomMessageTtlUpdated(message);
      if (event) {
        handleMessageTtlUpdatedEvent(event);
      }
    };

    topicMultiplexer.subscribe(destination, handler);
    return () => topicMultiplexer.unsubscribe(destination, handler);
  }, [isConnected, roomId, topicMultiplexer, handleMessageTtlUpdatedEvent]);

  const setMessageTtl = useCallback((seconds: number) => {
    if (!isConnected || !roomId) return;
    publishRef.current(SET_MESSAGE_TTL_DESTINATION, { roomId, messageTtlSeconds: seconds });
  }, [isConnected, roomId]);

  const applyPreset = useCallback((preset: MessageTtlPreset) => {
    setMessageTtl(MESSAGE_TTL_PRESET_SECONDS[preset]);
  }, [setMessageTtl]);

  const matchPreset = useCallback(
    (seconds: number) => matchMessageTtlPreset(seconds),
    [],
  );

  return {
    messageTtlSeconds,
    setMessageTtl,
    applyPreset,
    matchPreset,
    handleMessageTtlUpdatedEvent,
  };
}
