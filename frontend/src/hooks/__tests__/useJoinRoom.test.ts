// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { useJoinRoom } from '../useJoinRoom';

const INVITE_INFO_DESTINATION = '/user/queue/room-invite-info';

describe('useJoinRoom', () => {
  let inviteInfoHandler: ((message: IMessage) => void) | null = null;
  const publish = vi.fn();
  const subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
    if (destination === INVITE_INFO_DESTINATION) {
      inviteInfoHandler = callback;
    }
    return callback;
  });
  const unsubscribe = vi.fn();
  const onApproved = vi.fn();
  const onAlreadyMember = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    inviteInfoHandler = null;
  });

  const renderJoinHook = () =>
    renderHook(() =>
      useJoinRoom({
        isConnected: true,
        subscribe,
        unsubscribe,
        publish,
        onApproved,
        onAlreadyMember,
        onError,
      }),
    );

  it('redirects via onAlreadyMember when invite info reports ALREADY_MEMBER with roomId', () => {
    const { result } = renderJoinHook();

    act(() => {
      result.current.loadInviteInfo('a'.repeat(32));
    });

    expect(result.current.result.status).toBe('loading-info');

    act(() => {
      inviteInfoHandler?.({
        body: JSON.stringify({
          success: false,
          error: 'ALREADY_MEMBER',
          roomId: 'room-already-1',
        }),
      } as IMessage);
    });

    expect(result.current.result.status).toBe('approved');
    expect(result.current.result.roomId).toBe('room-already-1');
    expect(result.current.result.error).toBeNull();
    expect(onAlreadyMember).toHaveBeenCalledWith('room-already-1');
    expect(onError).not.toHaveBeenCalled();
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('keeps ready state for non-member invite info success', () => {
    const { result } = renderJoinHook();

    act(() => {
      result.current.loadInviteInfo('b'.repeat(32));
    });

    act(() => {
      inviteInfoHandler?.({
        body: JSON.stringify({
          success: true,
          salt: '',
          joinMode: 'BY_REQUEST',
          hasPassword: false,
        }),
      } as IMessage);
    });

    expect(result.current.result.status).toBe('ready');
    expect(result.current.result.joinMode).toBe('BY_REQUEST');
    expect(result.current.result.hasPassword).toBe(false);
    expect(onAlreadyMember).not.toHaveBeenCalled();
  });
});
