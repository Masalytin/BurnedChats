// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { useRoomModeration } from '../useRoomModeration';
import type { TopicMultiplexer } from '../useSetRoomName';

const ROOM_TOPIC = '/topic/room/room-a';

function createMultiplexer(): TopicMultiplexer & {
  handlers: Map<string, Set<(message: IMessage) => void>>;
  rawUnsubscribe: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, Set<(message: IMessage) => void>>();
  const rawUnsubscribe = vi.fn();

  return {
    handlers,
    rawUnsubscribe,
    subscribe(destination, callback) {
      let set = handlers.get(destination);
      if (!set) {
        set = new Set();
        handlers.set(destination, set);
      }
      set.add(callback);
      return null;
    },
    unsubscribe(destination, callback) {
      handlers.get(destination)?.delete(callback);
    },
  };
}

describe('useRoomModeration topic subscription', () => {
  const publish = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses topicMultiplexer on manage view and does not raw-unsubscribe the room topic', () => {
    const topicMultiplexer = createMultiplexer();

    const { unmount } = renderHook(() =>
      useRoomModeration({
        isConnected: true,
        roomId: 'room-a',
        ownsTopicSubscription: true,
        topicMultiplexer,
        publish,
      }),
    );

    expect(topicMultiplexer.handlers.get(ROOM_TOPIC)?.size).toBe(1);
    expect(topicMultiplexer.rawUnsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(topicMultiplexer.handlers.get(ROOM_TOPIC)?.size ?? 0).toBe(0);
    expect(topicMultiplexer.rawUnsubscribe).not.toHaveBeenCalled();
  });

  it('applies ROOM_MODERATION from the multiplexed room topic', () => {
    const topicMultiplexer = createMultiplexer();

    const { result } = renderHook(() =>
      useRoomModeration({
        isConnected: true,
        roomId: 'room-a',
        ownsTopicSubscription: true,
        topicMultiplexer,
        publish,
      }),
    );

    const handler = [...topicMultiplexer.handlers.get(ROOM_TOPIC)!][0];

    act(() => {
      handler({
        body: JSON.stringify({
          eventType: 'ROOM_MODERATION',
          roomId: 'room-a',
          mutedAdded: 'user-b',
        }),
      } as IMessage);
    });

    expect(result.current.mutedIds).toEqual(['user-b']);
  });
});
