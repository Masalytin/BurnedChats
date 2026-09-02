// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { getPresence, resetPresenceStore } from '../presence/presenceStore';
import { PRESENCE_DESTINATION, usePresenceSubscription } from './usePresenceSubscription';

describe('usePresenceSubscription', () => {
  beforeEach(() => {
    resetPresenceStore();
  });

  it('applies /user/queue/presence events into the store', () => {
    const handlers: Record<string, (message: IMessage) => void> = {};
    const subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
      handlers[destination] = callback;
    });
    const unsubscribe = vi.fn();

    renderHook(() => usePresenceSubscription({ subscribe, unsubscribe }));

    expect(subscribe).toHaveBeenCalledWith(PRESENCE_DESTINATION, expect.any(Function));

    act(() => {
      handlers[PRESENCE_DESTINATION]({
        body: JSON.stringify({ internalId: 'peer-1', online: true, lastSeen: 1_700_000_000_000 }),
      } as IMessage);
    });

    expect(getPresence('peer-1')).toEqual({
      online: true,
      lastSeen: 1_700_000_000_000,
    });
  });
});
