// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { useMyRooms } from '../useMyRooms';

const ROOM_LIST_DESTINATION = '/user/queue/room-list';

describe('useMyRooms RoomInfo.messageTtlSeconds (IMP-DISAPPEAR-04)', () => {
  let subscribe: ReturnType<typeof vi.fn<(destination: string, cb: (m: IMessage) => void) => unknown>>;
  let unsubscribe: ReturnType<typeof vi.fn<(destination: string) => void>>;
  let publish: ReturnType<typeof vi.fn<(destination: string, body: unknown) => void>>;
  let listHandler: ((message: IMessage) => void) | null;

  beforeEach(() => {
    listHandler = null;
    subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
      if (destination === ROOM_LIST_DESTINATION) {
        listHandler = callback;
      }
      return {};
    });
    unsubscribe = vi.fn();
    publish = vi.fn();
  });

  it('parses messageTtlSeconds from GET_MY_ROOMS / ROOM_LIST', () => {
    const { result } = renderHook(() =>
      useMyRooms({
        isConnected: false,
        subscribe,
        unsubscribe,
        publish,
      }),
    );

    expect(listHandler).toBeTypeOf('function');

    act(() => {
      listHandler!({
        body: JSON.stringify({
          success: true,
          rooms: [
            {
              roomId: 'room-off',
              role: 'owner',
              createdAt: 1,
              messageTtlSeconds: 0,
            },
            {
              roomId: 'room-on',
              role: 'member',
              createdAt: 2,
              messageTtlSeconds: 300,
            },
          ],
        }),
      } as IMessage);
    });

    expect(result.current.rooms).toEqual([
      {
        roomId: 'room-off',
        role: 'owner',
        createdAt: 1,
        nameEncrypted: undefined,
        nameIv: undefined,
        messageTtlSeconds: 0,
      },
      {
        roomId: 'room-on',
        role: 'member',
        createdAt: 2,
        nameEncrypted: undefined,
        nameIv: undefined,
        messageTtlSeconds: 300,
      },
    ]);
  });
});
