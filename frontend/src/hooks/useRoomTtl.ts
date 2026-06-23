import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { clampSeconds } from '../utils/duration';
import type { TopicMultiplexer } from './useSetRoomName';

const SET_ROOM_TTL_DESTINATION = '/app/room.setTtl';
const ROOM_TOPIC_PREFIX = '/topic/room/';

export const ROOM_TTL_PRESETS = ['1h', '24h', '7d', '30d', 'none'] as const;
export type RoomTtlPreset = (typeof ROOM_TTL_PRESETS)[number];

export const ROOM_TTL_PRESET_SECONDS: Record<Exclude<RoomTtlPreset, 'none'>, number> = {
  '1h': 3600,
  '24h': 86400,
  '7d': 604800,
  '30d': 30 * 24 * 3600,
};

/** Tolerance when matching server `autoBurnAt` back to a preset chip (seconds). */
const PRESET_MATCH_TOLERANCE_SEC = 120;

/** UX soft-cap bounds for custom room TTL input (IMP-RCV-02). */
export const ROOM_TTL_CUSTOM_MIN_SECONDS = 5 * 60;
export const ROOM_TTL_CUSTOM_MAX_SECONDS = 30 * 24 * 3600;

export interface RoomTtlUpdatedEvent {
  eventType: 'ROOM_TTL_UPDATED';
  roomId: string;
  autoBurnAt: number | null;
}

export interface SetRoomTtlOptions {
  ttlSeconds?: number;
  autoBurnAt?: number;
}

interface UseRoomTtlOptions {
  isConnected: boolean;
  roomId: string | null;
  topicMultiplexer: TopicMultiplexer;
  publish: (destination: string, body: unknown) => void;
}

interface UseRoomTtlReturn {
  autoBurnAt: number | null;
  setTtl: (options: SetRoomTtlOptions) => void;
  applyPreset: (preset: RoomTtlPreset) => void;
  applyCustomSeconds: (seconds: number) => void;
  matchPreset: (value: number | null) => RoomTtlPreset | null;
  handleTtlUpdatedEvent: (event: RoomTtlUpdatedEvent) => void;
}

function parseRoomTtlUpdated(message: IMessage): RoomTtlUpdatedEvent | null {
  try {
    const data = JSON.parse(message.body) as Partial<RoomTtlUpdatedEvent>;
    if (data.eventType === 'ROOM_TTL_UPDATED' && typeof data.roomId === 'string') {
      return {
        eventType: 'ROOM_TTL_UPDATED',
        roomId: data.roomId,
        autoBurnAt: typeof data.autoBurnAt === 'number' ? data.autoBurnAt : null,
      };
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
}

/**
 * Match an absolute auto-burn instant to the closest preset, if any.
 */
export function matchRoomTtlPreset(autoBurnAt: number | null): RoomTtlPreset | null {
  if (autoBurnAt == null) {
    return 'none';
  }
  const remainingSec = Math.max(0, Math.floor((autoBurnAt - Date.now()) / 1000));
  for (const [preset, seconds] of Object.entries(ROOM_TTL_PRESET_SECONDS) as [
    Exclude<RoomTtlPreset, 'none'>,
    number,
  ][]) {
    if (Math.abs(remainingSec - seconds) <= PRESET_MATCH_TOLERANCE_SEC) {
      return preset;
    }
  }
  return null;
}

/**
 * Hook for owner-managed room lifetime / auto-burn (IMP-ROOM-17).
 *
 * Publishes `/app/room.setTtl`; listens on `/topic/room/{roomId}` for
 * `ROOM_TTL_UPDATED` via the shared topic multiplexer.
 */
export function useRoomTtl({
  isConnected,
  roomId,
  topicMultiplexer,
  publish,
}: UseRoomTtlOptions): UseRoomTtlReturn {
  const [autoBurnAt, setAutoBurnAt] = useState<number | null>(null);

  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  useEffect(() => {
    setAutoBurnAt(null);
  }, [roomId]);

  const handleTtlUpdatedEvent = useCallback((event: RoomTtlUpdatedEvent) => {
    if (!roomId || event.roomId !== roomId) return;
    setAutoBurnAt(event.autoBurnAt ?? null);
  }, [roomId]);

  useEffect(() => {
    if (!isConnected || !roomId) return;

    const destination = `${ROOM_TOPIC_PREFIX}${roomId}`;
    const handler = (message: IMessage) => {
      const event = parseRoomTtlUpdated(message);
      if (event) {
        handleTtlUpdatedEvent(event);
      }
    };

    topicMultiplexer.subscribe(destination, handler);
    return () => topicMultiplexer.unsubscribe(destination, handler);
  }, [isConnected, roomId, topicMultiplexer, handleTtlUpdatedEvent]);

  const setTtl = useCallback((options: SetRoomTtlOptions) => {
    if (!isConnected || !roomId) return;
    publishRef.current(SET_ROOM_TTL_DESTINATION, { roomId, ...options });
  }, [isConnected, roomId]);

  const applyPreset = useCallback((preset: RoomTtlPreset) => {
    if (preset === 'none') {
      // IMP-ROOM-16 backend requires ttlSeconds or autoBurnAt — no clear-auto-burn yet.
      return;
    }
    setTtl({ ttlSeconds: ROOM_TTL_PRESET_SECONDS[preset] });
  }, [setTtl]);

  const applyCustomSeconds = useCallback((seconds: number) => {
    const clamped = clampSeconds(
      seconds,
      ROOM_TTL_CUSTOM_MIN_SECONDS,
      ROOM_TTL_CUSTOM_MAX_SECONDS,
    );
    setTtl({ ttlSeconds: clamped });
  }, [setTtl]);

  const matchPreset = useCallback(
    (value: number | null) => matchRoomTtlPreset(value),
    [],
  );

  return {
    autoBurnAt,
    setTtl,
    applyPreset,
    applyCustomSeconds,
    matchPreset,
    handleTtlUpdatedEvent,
  };
}
