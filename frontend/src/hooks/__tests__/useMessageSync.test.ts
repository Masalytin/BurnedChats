// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessageSync } from '../useMessageSync';

describe('useMessageSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes initial sync once when triggerSyncIfReady runs with canSync', () => {
    const doPublishInitialSync = vi.fn();
    const canSync = vi.fn(() => true);

    const { result } = renderHook(() =>
      useMessageSync({
        scopeId: 'scope-1',
        isConnected: true,
        isReconnection: false,
        canSync,
        doPublishInitialSync,
      }),
    );

    act(() => {
      result.current.triggerSyncIfReady('subscription');
    });

    expect(doPublishInitialSync).toHaveBeenCalledTimes(1);
    expect(result.current.isSyncing).toBe(true);
  });

  it('does not double-sync when triggerSyncIfReady is called twice in one connect', () => {
    const doPublishInitialSync = vi.fn();
    const canSync = vi.fn(() => true);

    const { result } = renderHook(() =>
      useMessageSync({
        scopeId: 'scope-1',
        isConnected: true,
        isReconnection: false,
        canSync,
        doPublishInitialSync,
      }),
    );

    act(() => {
      result.current.triggerSyncIfReady('subscription');
      result.current.triggerSyncIfReady('subscription');
    });

    expect(doPublishInitialSync).toHaveBeenCalledTimes(1);
  });

  it('auto-sync on reconnection uses doPublishReconnectSync when set', () => {
    const doPublishInitialSync = vi.fn();
    const doPublishReconnectSync = vi.fn();
    const canSync = vi.fn(() => true);

    const { result, rerender } = renderHook(
      (props: { isConnected: boolean; isReconnection: boolean }) =>
        useMessageSync({
          scopeId: 'scope-1',
          isConnected: props.isConnected,
          isReconnection: props.isReconnection,
          canSync,
          doPublishInitialSync,
          doPublishReconnectSync,
        }),
      { initialProps: { isConnected: true, isReconnection: false } },
    );

    act(() => {
      result.current.triggerSyncIfReady('subscription');
    });
    expect(doPublishInitialSync).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ isConnected: false, isReconnection: false });
    });
    act(() => {
      rerender({ isConnected: true, isReconnection: true });
    });

    act(() => {
      result.current.runReconnectIfNeeded();
    });

    expect(doPublishReconnectSync).toHaveBeenCalledTimes(1);
    expect(doPublishInitialSync).toHaveBeenCalledTimes(1);
  });

  it('resets and allows a new initial sync when scopeId changes', () => {
    const doPublishInitialSync = vi.fn();
    const canSync = vi.fn(() => true);

    const { result, rerender } = renderHook(
      (props: { scopeId: string }) =>
        useMessageSync({
          scopeId: props.scopeId,
          isConnected: true,
          isReconnection: false,
          canSync,
          doPublishInitialSync,
        }),
      { initialProps: { scopeId: 'a' } },
    );

    act(() => {
      result.current.triggerSyncIfReady('subscription');
    });
    expect(doPublishInitialSync).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ scopeId: 'b' });
    });
    act(() => {
      result.current.triggerSyncIfReady('subscription');
    });

    expect(doPublishInitialSync).toHaveBeenCalledTimes(2);
  });

  it('resets sync flag on disconnect and allows sync after connect again', () => {
    const doPublishInitialSync = vi.fn();
    const canSync = vi.fn(() => true);

    const { result, rerender } = renderHook(
      (props: { isConnected: boolean }) =>
        useMessageSync({
          scopeId: 'scope-1',
          isConnected: props.isConnected,
          isReconnection: false,
          canSync,
          doPublishInitialSync,
        }),
      { initialProps: { isConnected: true } },
    );

    act(() => {
      result.current.triggerSyncIfReady('subscription');
    });
    expect(doPublishInitialSync).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ isConnected: false });
    });
    act(() => {
      rerender({ isConnected: true });
    });
    act(() => {
      result.current.triggerSyncIfReady('subscription');
    });

    expect(doPublishInitialSync).toHaveBeenCalledTimes(2);
  });

  it('exposes resetSyncFlag to allow tests / manual re-sync of the ref', () => {
    const doPublishInitialSync = vi.fn();
    const canSync = vi.fn(() => true);

    const { result } = renderHook(() =>
      useMessageSync({
        scopeId: 'scope-1',
        isConnected: true,
        isReconnection: false,
        canSync,
        doPublishInitialSync,
      }),
    );

    act(() => {
      result.current.triggerSyncIfReady('subscription');
    });
    act(() => {
      result.current.resetSyncFlag();
    });
    act(() => {
      result.current.triggerSyncIfReady('subscription');
    });

    expect(doPublishInitialSync).toHaveBeenCalledTimes(2);
  });
});
