// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { createRoomTopicMultiplexer } from '../useSetRoomName';
import { useRoomRoles } from '../useRoomRoles';
import type { RoomListEntry } from '../../types';

const ROOM_ID = 'room-a';
const ROOM_TOPIC = `/topic/room/${ROOM_ID}`;

describe('useRoomRoles', () => {
  let topicMessageHandler: ((message: IMessage) => void) | null = null;
  const rawSubscribe = vi.fn((_destination: string, callback: (message: IMessage) => void) => {
    topicMessageHandler = callback;
    return callback;
  });
  const rawUnsubscribe = vi.fn();
  const publish = vi.fn();
  const updateRoomRole = vi.fn();
  const onMemberRoleUpdated = vi.fn();

  const topicMultiplexer = createRoomTopicMultiplexer(rawSubscribe, rawUnsubscribe);

  const myRooms: RoomListEntry[] = [
    { roomId: ROOM_ID, role: 'owner', createdAt: 0 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    topicMessageHandler = null;
  });

  const renderRolesHook = () =>
    renderHook(() =>
      useRoomRoles({
        isConnected: true,
        roomId: ROOM_ID,
        myInternalId: 'owner-id',
        myRooms,
        topicMultiplexer,
        publish,
        updateRoomRole,
        onMemberRoleUpdated,
      }),
    );

  it('calls onMemberRoleUpdated when ROOM_ROLE_UPDATED arrives on the room topic', () => {
    renderRolesHook();
    expect(rawSubscribe).toHaveBeenCalledWith(ROOM_TOPIC, expect.any(Function));

    act(() => {
      topicMessageHandler?.({
        body: JSON.stringify({
          eventType: 'ROOM_ROLE_UPDATED',
          roomId: ROOM_ID,
          targetInternalId: 'member-b',
          role: 'admin',
        }),
      } as IMessage);
    });

    expect(onMemberRoleUpdated).toHaveBeenCalledWith('member-b', 'admin');
  });
});
