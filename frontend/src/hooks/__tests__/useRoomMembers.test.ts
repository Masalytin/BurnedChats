// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { useRoomMembers } from '../useRoomMembers';
import type { RoomMember } from '../../types';

const ROOM_MEMBERS_DESTINATION = '/user/queue/room-members';

function makeMember(internalId: string): RoomMember {
  return {
    internalId,
    displayName: `User ${internalId}`,
    role: 'member',
  };
}

describe('useRoomMembers', () => {
  let messageHandler: ((message: IMessage) => void) | null = null;
  const publish = vi.fn();
  const subscribe = vi.fn((_destination: string, callback: (message: IMessage) => void) => {
    messageHandler = callback;
    return callback;
  });
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    messageHandler = null;
  });

  const renderMembersHook = () =>
    renderHook(() =>
      useRoomMembers({
        isConnected: true,
        subscribe,
        unsubscribe,
        publish,
      }),
    );

  it('ignores stale responses when event.roomId does not match pending request', () => {
    const { result } = renderMembersHook();

    act(() => {
      result.current.fetchMembers('room-a');
    });

    act(() => {
      messageHandler?.({
        body: JSON.stringify({
          success: true,
          roomId: 'room-b',
          members: [makeMember('other')],
        }),
      } as IMessage);
    });

    expect(result.current.members).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('applies response when event.roomId matches pending request', () => {
    const { result } = renderMembersHook();
    const members = [makeMember('alice')];

    act(() => {
      result.current.fetchMembers('room-a');
    });

    act(() => {
      messageHandler?.({
        body: JSON.stringify({
          success: true,
          roomId: 'room-a',
          members,
        }),
      } as IMessage);
    });

    expect(result.current.members).toEqual(members);
    expect(result.current.isLoading).toBe(false);
  });

  it('removeMember optimistically drops a member from local state', () => {
    const { result } = renderMembersHook();
    const members = [makeMember('alice'), makeMember('bob')];

    act(() => {
      result.current.fetchMembers('room-a');
    });

    act(() => {
      messageHandler?.({
        body: JSON.stringify({
          success: true,
          roomId: 'room-a',
          members,
        }),
      } as IMessage);
    });

    act(() => {
      result.current.removeMember('alice');
    });

    expect(result.current.members).toEqual([makeMember('bob')]);
  });

  it('subscribes to room-members queue on mount', () => {
    renderMembersHook();
    expect(subscribe).toHaveBeenCalledWith(ROOM_MEMBERS_DESTINATION, expect.any(Function));
  });
});
