// @vitest-environment happy-dom
import { createElement, useCallback, useState, type ReactNode } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
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

  it('does not resubscribe when only onComplete identity changes', () => {
    const { rerender } = renderHook(
      ({ onComplete }: { onComplete: () => void }) =>
        useBurnAll({
          isConnected: true,
          subscribe,
          unsubscribe,
          publish,
          onComplete,
        }),
      { wrapper, initialProps: { onComplete: () => undefined } },
    );

    expect(subscribe).toHaveBeenCalledTimes(1);

    rerender({ onComplete: () => undefined });

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('does not loop when subscribe triggers a parent setState', () => {
    let renders = 0;

    function Parent() {
      renders += 1;
      const [, setTick] = useState(0);
      const subscribeWithState = useCallback(
        (destination: string, callback: (message: IMessage) => void) => {
          if (destination === '/user/queue/burn-all-complete') {
            completeHandlers.push(callback);
          }
          setTick((tick) => tick + 1);
          return {};
        },
        [],
      );
      const unsubscribeStable = useCallback(() => {}, []);
      const publishStable = useCallback(() => {}, []);

      useBurnAll({
        isConnected: true,
        subscribe: subscribeWithState,
        unsubscribe: unsubscribeStable,
        publish: publishStable,
        onComplete: () => undefined,
      });

      return null;
    }

    render(createElement(Parent));
    expect(renders).toBeLessThan(5);
  });

  it('still delivers complete ack after parent re-renders with a new onComplete', async () => {
    const firstOnComplete = vi.fn();
    const secondOnComplete = vi.fn();
    const { result, rerender } = renderHook(
      ({ onComplete }: { onComplete: (event: unknown) => void }) =>
        useBurnAll({
          isConnected: true,
          subscribe,
          unsubscribe,
          publish,
          onComplete,
        }),
      { wrapper, initialProps: { onComplete: firstOnComplete } },
    );

    rerender({ onComplete: secondOnComplete });

    act(() => {
      result.current.requestBurnAll({ wipeIdentity: false });
    });

    const latestHandler = completeHandlers.at(-1);
    act(() => {
      latestHandler?.({
        body: JSON.stringify({
          wipeIdentity: false,
          burnedSessions: 1,
          burnedRooms: 0,
          leftRooms: 0,
          timestamp: 1_700_000_000_000,
        }),
      } as IMessage);
    });

    await waitFor(() => {
      expect(result.current.burnAllState).toBe('done');
    });
    expect(secondOnComplete).toHaveBeenCalledTimes(1);
    expect(firstOnComplete).not.toHaveBeenCalled();
  });
});
