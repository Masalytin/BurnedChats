import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { clampSeconds } from '../utils/duration';
import {
  MESSAGE_TTL_CUSTOM_MAX_SECONDS,
  MESSAGE_TTL_CUSTOM_MIN_SECONDS,
  MESSAGE_TTL_PRESET_SECONDS,
  matchMessageTtlPreset,
  type MessageTtlPreset,
} from '../utils/messageTtlPresets';
import type { TopicMultiplexer } from './useSetRoomName';

export {
  MESSAGE_TTL_CUSTOM_MAX_SECONDS,
  MESSAGE_TTL_CUSTOM_MIN_SECONDS,
  MESSAGE_TTL_PRESETS,
  MESSAGE_TTL_PRESET_SECONDS,
  matchMessageTtlPreset,
  type MessageTtlPreset,
} from '../utils/messageTtlPresets';

const SET_MESSAGE_TTL_DESTINATION = '/app/room.setMessageTtl';
const ROOM_TOPIC_PREFIX = '/topic/room/';

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
  /** GET_MY_ROOMS / RoomInfo snapshot so remount is not forced to 0. */
  initialTtlSeconds?: number;
}

interface UseRoomMessageTtlReturn {
  messageTtlSeconds: number;
  /** Live setTtl only — null on hydrate / remount (IMP-DISAPPEAR-05). */
  ttlSetNotice: number | null;
  setMessageTtl: (messageTtlSeconds: number) => void;
  applyPreset: (preset: MessageTtlPreset) => void;
  applyCustomSeconds: (seconds: number) => void;
  matchPreset: (seconds: number) => MessageTtlPreset | null;
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
  initialTtlSeconds = 0,
}: UseRoomMessageTtlOptions): UseRoomMessageTtlReturn {
  const [messageTtlSeconds, setMessageTtlSeconds] = useState(initialTtlSeconds);
  const [ttlSetNotice, setTtlSetNotice] = useState<number | null>(null);
  const acceptedLiveEventRef = useRef(false);

  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  useEffect(() => {
    acceptedLiveEventRef.current = false;
    setTtlSetNotice(null);
    setMessageTtlSeconds(initialTtlSeconds);
  }, [roomId]);

  useEffect(() => {
    if (!acceptedLiveEventRef.current) {
      setMessageTtlSeconds(initialTtlSeconds);
    }
  }, [initialTtlSeconds]);

  const handleMessageTtlUpdatedEvent = useCallback((event: RoomMessageTtlUpdatedEvent) => {
    if (!roomId || event.roomId !== roomId) return;
    acceptedLiveEventRef.current = true;
    setMessageTtlSeconds(event.messageTtlSeconds);
    setTtlSetNotice(event.messageTtlSeconds);
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

  const applyCustomSeconds = useCallback((seconds: number) => {
    const clamped = clampSeconds(
      seconds,
      MESSAGE_TTL_CUSTOM_MIN_SECONDS,
      MESSAGE_TTL_CUSTOM_MAX_SECONDS,
    );
    setMessageTtl(clamped);
  }, [setMessageTtl]);

  const matchPreset = useCallback(
    (seconds: number) => matchMessageTtlPreset(seconds),
    [],
  );

  return {
    messageTtlSeconds,
    ttlSetNotice,
    setMessageTtl,
    applyPreset,
    applyCustomSeconds,
    matchPreset,
    handleMessageTtlUpdatedEvent,
  };
}
