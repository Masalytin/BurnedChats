import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { TFunction } from 'i18next';
import type { TopicMultiplexer } from './useSetRoomName';

const GET_ROOM_PRESENCE_DESTINATION = '/app/room.getPresence';
const ROOM_PRESENCE_DESTINATION = '/user/queue/room-presence';
const ROOM_TOPIC_PREFIX = '/topic/room/';

export interface MemberPresence {
  online: boolean;
  lastSeen?: number;
}

interface PresenceSnapshotEvent {
  success: boolean;
  roomId?: string;
  members?: Array<{
    internalId: string;
    online: boolean;
    lastSeen?: number;
  }>;
  error?: string;
}

interface PresenceLiveEvent {
  roomId: string;
  internalId: string;
  online: boolean;
  lastSeen?: number;
}

interface UseRoomPresenceOptions {
  isConnected: boolean;
  roomId: string | null;
  topicMultiplexer: TopicMultiplexer;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

interface UseRoomPresenceReturn {
  presence: Map<string, MemberPresence>;
  onlineCount: number;
  fetchPresence: (roomId: string) => void;
}

function applyMemberEntry(
  prev: Map<string, MemberPresence>,
  internalId: string,
  online: boolean,
  lastSeen?: number,
): Map<string, MemberPresence> {
  const next = new Map(prev);
  const existing = prev.get(internalId);
  next.set(internalId, {
    online,
    lastSeen: lastSeen ?? existing?.lastSeen,
  });
  return next;
}

function applySnapshotMembers(
  members: NonNullable<PresenceSnapshotEvent['members']>,
): Map<string, MemberPresence> {
  const map = new Map<string, MemberPresence>();
  for (const member of members) {
    map.set(member.internalId, {
      online: member.online,
      lastSeen: member.lastSeen,
    });
  }
  return map;
}

function parseLivePresenceEvent(message: IMessage): PresenceLiveEvent | null {
  try {
    const data = JSON.parse(message.body) as Record<string, unknown>;
    if (typeof data.eventType === 'string') {
      return null;
    }
    if (typeof data.roomId !== 'string' || typeof data.internalId !== 'string') {
      return null;
    }
    if (typeof data.online !== 'boolean') {
      return null;
    }
    return {
      roomId: data.roomId,
      internalId: data.internalId,
      online: data.online,
      lastSeen: typeof data.lastSeen === 'number' ? data.lastSeen : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Localized relative-time fragment for presence last-seen labels.
 */
export function formatPresenceRelativeTime(epochMs: number, t: TFunction): string {
  const diff = Math.max(0, Date.now() - epochMs);
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) {
    return t('room.manage.relativeJustNow');
  }
  if (minutes < 60) {
    return t('room.manage.relativeMinutes', { count: minutes });
  }
  if (hours < 24) {
    return t('room.manage.relativeHours', { count: hours });
  }
  return t('room.manage.relativeDays', { count: days });
}

/**
 * Room member presence: GET snapshot + live updates on the room topic.
 */
export function useRoomPresence({
  isConnected,
  roomId,
  topicMultiplexer,
  subscribe,
  unsubscribe,
  publish,
}: UseRoomPresenceOptions): UseRoomPresenceReturn {
  const [presence, setPresence] = useState<Map<string, MemberPresence>>(() => new Map());

  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  const roomIdRef = useRef(roomId);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  useEffect(() => {
    setPresence(new Map());
  }, [roomId]);

  const fetchPresence = useCallback((targetRoomId: string) => {
    if (!isConnected) return;
    publishRef.current(GET_ROOM_PRESENCE_DESTINATION, { roomId: targetRoomId });
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected || !roomId) return;
    fetchPresence(roomId);
  }, [isConnected, roomId, fetchPresence]);

  useEffect(() => {
    const handleSnapshot = (message: IMessage) => {
      try {
        const event: PresenceSnapshotEvent = JSON.parse(message.body);
        if (!event.success || !event.members) {
          if (!event.success && event.error) {
            console.warn('[useRoomPresence] Snapshot error:', event.error);
          }
          return;
        }
        if (roomIdRef.current && event.roomId && event.roomId !== roomIdRef.current) {
          return;
        }
        setPresence(applySnapshotMembers(event.members));
      } catch (e) {
        console.error('[useRoomPresence] Failed to parse room-presence snapshot:', e);
      }
    };

    subscribe(ROOM_PRESENCE_DESTINATION, handleSnapshot);
    return () => unsubscribe(ROOM_PRESENCE_DESTINATION);
  }, [subscribe, unsubscribe]);

  const handleLiveEvent = useCallback((event: PresenceLiveEvent) => {
    if (!roomIdRef.current || event.roomId !== roomIdRef.current) return;
    setPresence(prev => applyMemberEntry(
      prev,
      event.internalId,
      event.online,
      event.lastSeen,
    ));
  }, []);

  useEffect(() => {
    if (!isConnected || !roomId) return;

    const destination = `${ROOM_TOPIC_PREFIX}${roomId}`;
    const handler = (message: IMessage) => {
      const event = parseLivePresenceEvent(message);
      if (event) {
        handleLiveEvent(event);
      }
    };

    topicMultiplexer.subscribe(destination, handler);
    return () => topicMultiplexer.unsubscribe(destination, handler);
  }, [isConnected, roomId, topicMultiplexer, handleLiveEvent]);

  const onlineCount = [...presence.values()].filter(entry => entry.online).length;

  return {
    presence,
    onlineCount,
    fetchPresence,
  };
}
