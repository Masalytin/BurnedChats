// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { applyPresenceEvent, getPresence, resetPresenceStore } from '../presence/presenceStore';
import { useRoomPresence } from './useRoomPresence';
import type { TopicMultiplexer } from './useSetRoomName';

const ROOM_ID = 'room-1';
const SNAPSHOT_DESTINATION = '/user/queue/room-presence';
const TOPIC_DESTINATION = `/topic/room/${ROOM_ID}`;

function stompMessage(body: unknown): IMessage {
  return { body: JSON.stringify(body) } as IMessage;
}

function setupHook() {
  const userQueue: Record<string, (message: IMessage) => void> = {};
  const topicQueue: Record<string, (message: IMessage) => void> = {};

  const subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
    userQueue[destination] = callback;
    return {};
  });
  const unsubscribe = vi.fn();
  const publish = vi.fn();
  const topicMultiplexer: TopicMultiplexer = {
    subscribe: vi.fn((destination: string, callback: (message: IMessage) => void) => {
      topicQueue[destination] = callback;
      return {};
    }),
    unsubscribe: vi.fn(),
  };

  const hook = renderHook(() =>
    useRoomPresence({
      isConnected: true,
      roomId: ROOM_ID,
      topicMultiplexer,
      subscribe,
      unsubscribe,
      publish,
    }),
  );

  return { ...hook, userQueue, topicQueue };
}

describe('useRoomPresence store unify (IMP-PRESENCE-05)', () => {
  beforeEach(() => {
    resetPresenceStore();
  });

  it('writes a room snapshot into presenceStore, not only a local map', () => {
    const { userQueue } = setupHook();

    act(() => {
      userQueue[SNAPSHOT_DESTINATION](
        stompMessage({
          success: true,
          roomId: ROOM_ID,
          members: [
            { internalId: 'alice', online: true, lastSeen: 1_700_000_000_000 },
            { internalId: 'bob', online: false, lastSeen: 1_699_000_000_000 },
          ],
        }),
      );
    });

    expect(getPresence('alice')).toEqual({
      online: true,
      lastSeen: 1_700_000_000_000,
    });
    expect(getPresence('bob')).toEqual({
      online: false,
      lastSeen: 1_699_000_000_000,
    });
  });

  it('applies a room topic event into the same store', () => {
    const { result, userQueue, topicQueue } = setupHook();
    const seenAt = Date.now();

    act(() => {
      userQueue[SNAPSHOT_DESTINATION](
        stompMessage({
          success: true,
          roomId: ROOM_ID,
          members: [{ internalId: 'alice', online: false, lastSeen: seenAt - 1_000 }],
        }),
      );
    });

    act(() => {
      topicQueue[TOPIC_DESTINATION](
        stompMessage({
          roomId: ROOM_ID,
          internalId: 'alice',
          online: true,
          lastSeen: seenAt,
        }),
      );
    });

    expect(getPresence('alice')?.online).toBe(true);
    expect(getPresence('alice')?.lastSeen).toBe(seenAt);
    expect(result.current.presence.get('alice')?.online).toBe(true);
    expect(result.current.onlineCount).toBe(1);
  });

  it('converges room onlineCount when a global PresenceEvent marks a member offline', () => {
    const { result, userQueue } = setupHook();

    act(() => {
      userQueue[SNAPSHOT_DESTINATION](
        stompMessage({
          success: true,
          roomId: ROOM_ID,
          members: [{ internalId: 'alice', online: true, lastSeen: Date.now() }],
        }),
      );
    });

    expect(result.current.onlineCount).toBe(1);

    act(() => {
      applyPresenceEvent('alice', false, Date.now());
    });

    expect(getPresence('alice')?.online).toBe(false);
    expect(result.current.presence.get('alice')?.online).toBe(false);
    expect(result.current.onlineCount).toBe(0);
  });
});
