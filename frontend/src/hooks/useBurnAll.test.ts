// @vitest-environment happy-dom
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import type { IMessage } from '@stomp/stompjs';
import i18n from '@/i18n';
import { useBurnAll } from './useBurnAll';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

describe('useBurnAll', () => {
  let subscribe: ReturnType<typeof vi.fn<(destination: string, callback: (message: IMessage) => void) => unknown>>;
  let unsubscribe: ReturnType<typeof vi.fn<(destination: string) => void>>;
  let publish: ReturnType<typeof vi.fn<(destination: string, body: unknown) => void>>;
  let completeHandlers: Array<(message: IMessage) => void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');

    completeHandlers = [];
    subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
      if (destination === '/user/queue/burn-all-complete') {
        completeHandlers.push(callback);
      }
      return {};
    });
    unsubscribe = vi.fn();
    publish = vi.fn();
  });

  function renderUseBurnAll(onComplete?: () => void) {
    return renderHook(
      () =>
        useBurnAll({
          isConnected: true,
          subscribe,
          unsubscribe,
          publish,
          onComplete,
        }),
      { wrapper },
    );
  }

  it('publishes burn-all request with wipeIdentity flag', () => {
    const { result } = renderUseBurnAll();

    act(() => {
      result.current.requestBurnAll({ wipeIdentity: true });
    });

    expect(publish).toHaveBeenCalledWith('/app/user.burnAll', { wipeIdentity: true });
    expect(result.current.burnAllState).toBe('burning');
  });

  it('sets error when not connected', () => {
    const { result } = renderHook(
      () =>
        useBurnAll({
          isConnected: false,
          subscribe,
          unsubscribe,
          publish,
        }),
      { wrapper },
    );

    act(() => {
      result.current.requestBurnAll({ wipeIdentity: false });
    });

    expect(publish).not.toHaveBeenCalled();
    expect(result.current.burnAllState).toBe('error');
    expect(result.current.error).toBe('NOT_CONNECTED');
  });

  it('transitions to done on burn-all-complete ack', async () => {
    const onComplete = vi.fn();
    const { result } = renderUseBurnAll(onComplete);

    act(() => {
      result.current.requestBurnAll({ wipeIdentity: false });
    });

    act(() => {
      completeHandlers[0]?.({
        body: JSON.stringify({
          wipeIdentity: false,
          burnedSessions: 2,
          burnedRooms: 1,
          leftRooms: 0,
          timestamp: 1_700_000_000_000,
        }),
      } as IMessage);
    });

    await waitFor(() => {
      expect(result.current.burnAllState).toBe('done');
    });
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ wipeIdentity: false, burnedSessions: 2 }),
    );
  });

  it('subscribes to burn-all-complete while connected', () => {
    renderUseBurnAll();
    expect(subscribe).toHaveBeenCalledWith(
      '/user/queue/burn-all-complete',
      expect.any(Function),
    );
  });
});
