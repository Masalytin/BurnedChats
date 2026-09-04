// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { useRoomMessageTtl } from '../useRoomMessageTtl';
import type { TopicMultiplexer } from '../useSetRoomName';

const ROOM_ID = 'room-ttl-hydrate';

function createMultiplexer(): TopicMultiplexer {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
}

describe('useRoomMessageTtl snapshot hydrate (IMP-DISAPPEAR-04)', () => {
  const publish = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderTtl(initialTtlSeconds = 0, roomId: string | null = ROOM_ID) {
    return renderHook(
      (props: { initialTtlSeconds: number; roomId: string | null }) =>
        useRoomMessageTtl({
          isConnected: true,
          roomId: props.roomId,
          topicMultiplexer: createMultiplexer(),
          publish,
          initialTtlSeconds: props.initialTtlSeconds,
        }),
      { initialProps: { initialTtlSeconds, roomId } },
    );
  }

  it('hydrates from RoomInfo so remount is not 0 when TTL is set', () => {
    const first = renderTtl(300);
    expect(first.result.current.messageTtlSeconds).toBe(300);
    first.unmount();

    const remount = renderTtl(300);
    expect(remount.result.current.messageTtlSeconds).toBe(300);
    expect(remount.result.current.messageTtlSeconds).not.toBe(0);
  });

  it('applies a late GET_MY_ROOMS snapshot before any ROOM_MESSAGE_TTL_UPDATED event', () => {
    const { result, rerender } = renderTtl(0);
    expect(result.current.messageTtlSeconds).toBe(0);

    rerender({ initialTtlSeconds: 3600, roomId: ROOM_ID });
    expect(result.current.messageTtlSeconds).toBe(3600);
  });

  it('does not clobber a live ROOM_MESSAGE_TTL_UPDATED with a later stale snapshot', () => {
    const topicMultiplexer: TopicMultiplexer & {
      handler?: (message: IMessage) => void;
    } = {
      subscribe: vi.fn((_dest, callback) => {
        topicMultiplexer.handler = callback;
        return {};
      }),
      unsubscribe: vi.fn(),
    };

    const { result, rerender } = renderHook(
      (props: { initialTtlSeconds: number }) =>
        useRoomMessageTtl({
          isConnected: true,
          roomId: ROOM_ID,
          topicMultiplexer,
          publish,
          initialTtlSeconds: props.initialTtlSeconds,
        }),
      { initialProps: { initialTtlSeconds: 0 } },
    );

    act(() => {
      topicMultiplexer.handler!({
        body: JSON.stringify({
          eventType: 'ROOM_MESSAGE_TTL_UPDATED',
          roomId: ROOM_ID,
          messageTtlSeconds: 300,
        }),
      } as IMessage);
    });
    expect(result.current.messageTtlSeconds).toBe(300);

    rerender({ initialTtlSeconds: 0 });
    expect(result.current.messageTtlSeconds).toBe(300);
  });
});
