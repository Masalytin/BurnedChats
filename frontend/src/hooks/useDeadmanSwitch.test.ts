// @vitest-environment happy-dom
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import type { IMessage } from '@stomp/stompjs';
import i18n from '@/i18n';
import {
  DEADMAN_PERIOD_DAYS,
  useDeadmanSwitch,
  type SetDeadmanRequest,
} from './useDeadmanSwitch';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

describe('useDeadmanSwitch', () => {
  let subscribe: ReturnType<
    typeof vi.fn<(destination: string, callback: (message: IMessage) => void) => unknown>
  >;
  let unsubscribe: ReturnType<typeof vi.fn<(destination: string) => void>>;
  let publish: ReturnType<typeof vi.fn<(destination: string, body: unknown) => void>>;
  let updatedHandlers: Array<(message: IMessage) => void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');

    updatedHandlers = [];
    subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
      if (destination === '/user/queue/deadman-updated') {
        updatedHandlers.push(callback);
      }
      return {};
    });
    unsubscribe = vi.fn();
    publish = vi.fn();
  });

  function renderUseDeadmanSwitch(initialConnected = true) {
    return renderHook(
      ({ isConnected }: { isConnected: boolean }) =>
        useDeadmanSwitch({
          isConnected,
          subscribe,
          unsubscribe,
          publish,
        }),
      { wrapper, initialProps: { isConnected: initialConnected } },
    );
  }

  function emitDeadmanUpdated(body: Record<string, unknown>) {
    act(() => {
      updatedHandlers[0]?.({
        body: JSON.stringify(body),
      } as IMessage);
    });
  }

  it('subscribes to deadman-updated while connected', () => {
    renderUseDeadmanSwitch();
    expect(subscribe).toHaveBeenCalledWith(
      '/user/queue/deadman-updated',
      expect.any(Function),
    );
  });

  it('publishes setDeadman when enabling the switch', () => {
    const { result } = renderUseDeadmanSwitch();
    const request: SetDeadmanRequest = {
      enabled: true,
      periodDays: 30,
      wipeIdentity: false,
    };

    act(() => {
      result.current.setDeadman(request);
    });

    expect(publish).toHaveBeenCalledWith('/app/user.setDeadman', request);
  });

  it('updates local state from deadman-updated ack', async () => {
    const { result } = renderUseDeadmanSwitch();

    emitDeadmanUpdated({
      enabled: true,
      periodDays: 7,
      wipeIdentity: true,
      expiresAt: 1_700_000_000_000,
    });

    await waitFor(() => {
      expect(result.current.deadman).toEqual({
        enabled: true,
        periodDays: 7,
        wipeIdentity: true,
        expiresAt: 1_700_000_000_000,
      });
    });
  });

  it('clears enabled state when server confirms disable', async () => {
    const { result } = renderUseDeadmanSwitch();

    emitDeadmanUpdated({
      enabled: true,
      periodDays: 30,
      wipeIdentity: false,
      expiresAt: 1_700_000_000_000,
    });

    act(() => {
      result.current.setDeadman({ enabled: false, periodDays: 30, wipeIdentity: false });
    });

    emitDeadmanUpdated({
      enabled: false,
      periodDays: null,
      wipeIdentity: false,
      expiresAt: null,
    });

    await waitFor(() => {
      expect(result.current.deadman).toEqual({
        enabled: false,
        periodDays: null,
        wipeIdentity: false,
        expiresAt: null,
      });
    });
    expect(publish).toHaveBeenCalledWith('/app/user.setDeadman', {
      enabled: false,
      periodDays: 30,
      wipeIdentity: false,
    });
  });

  it('does not publish when disconnected', () => {
    const { result } = renderUseDeadmanSwitch(false);

    act(() => {
      result.current.setDeadman({ enabled: true, periodDays: 90, wipeIdentity: false });
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it('re-syncs enabled settings on reconnect to refresh expiresAt', async () => {
    const { result, rerender } = renderUseDeadmanSwitch();

    emitDeadmanUpdated({
      enabled: true,
      periodDays: 30,
      wipeIdentity: false,
      expiresAt: 1_700_000_000_000,
    });

    await waitFor(() => {
      expect(result.current.deadman?.enabled).toBe(true);
    });

    publish.mockClear();

    act(() => {
      rerender({ isConnected: false });
    });

    act(() => {
      rerender({ isConnected: true });
    });

    await waitFor(() => {
      expect(publish).toHaveBeenCalledWith('/app/user.setDeadman', {
        enabled: true,
        periodDays: 30,
        wipeIdentity: false,
      });
    });
  });

  it('exports period presets matching backend validation', () => {
    expect(DEADMAN_PERIOD_DAYS).toEqual([7, 30, 90]);
  });
});
