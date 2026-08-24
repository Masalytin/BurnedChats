// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Critical-path test for {@link useWebSocket}: subscription restoration on (re)connect (IMP-AUDIT-16).
 *
 * The real `@stomp/stompjs` Client is replaced by a controllable fake so we can drive the
 * `onConnect` lifecycle deterministically — including a simulated reconnect on the same client
 * instance — and assert that stored subscriptions are re-applied.
 */

const h = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  publishMock: vi.fn(),
  deactivateMock: vi.fn(),
  state: {
    connected: false,
    config: null as null | {
      onConnect?: () => void;
      onDisconnect?: () => void;
      onWebSocketClose?: (event: unknown) => void;
    },
  },
}));

vi.mock('@stomp/stompjs', () => {
  class FakeClient {
    private readonly cfg: { onConnect?: () => void; onDisconnect?: () => void };

    constructor(config: { onConnect?: () => void; onDisconnect?: () => void }) {
      this.cfg = config;
      h.state.config = config;
    }

    get connected(): boolean {
      return h.state.connected;
    }

    activate(): void {
      h.state.connected = true;
      this.cfg.onConnect?.();
    }

    deactivate(): void {
      h.state.connected = false;
      h.deactivateMock();
    }

    subscribe(destination: string, callback: unknown): unknown {
      return h.subscribeMock(destination, callback);
    }

    publish(...args: unknown[]): void {
      h.publishMock(...args);
    }
  }

  return { Client: FakeClient };
});

vi.mock('sockjs-client', () => ({ default: vi.fn() }));
vi.mock('@twa-dev/sdk', () => ({ default: { platform: 'test', version: '7.0' } }));
vi.mock('@/components/DebugPanel', () => ({
  debugLog: vi.fn(),
  incrementMessagesSent: vi.fn(),
  incrementMessagesReceived: vi.fn(),
  logStompMessage: vi.fn(),
}));

import { useWebSocket } from '@/hooks/useWebSocket';
import { AuthType, type AuthCredentials } from '@/auth/types';

const walletCredentials = (): AuthCredentials => ({
  type: AuthType.WALLET,
  sessionToken: 'session-token',
});

describe('useWebSocket subscription restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.connected = false;
    h.state.config = null;
    h.subscribeMock.mockImplementation((destination: string) => ({
      id: destination,
      unsubscribe: vi.fn(),
    }));
  });

  it('applies stored subscriptions on first connect before reporting connected', async () => {
    const { result } = renderHook(() => useWebSocket({ getCredentials: walletCredentials }));

    // Subscribe while disconnected: callback is stored, no live STOMP subscribe yet.
    act(() => {
      result.current.subscribe('/user/queue/early', vi.fn());
    });
    expect(h.subscribeMock).not.toHaveBeenCalled();

    act(() => {
      result.current.connect();
    });

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    // The stored destination is applied to the live client on first connect.
    expect(h.subscribeMock).toHaveBeenCalledWith('/user/queue/early', expect.any(Function));
    expect(result.current.isReconnection).toBe(false);
    expect(result.current._debug.activeSubscriptions).toContain('/user/queue/early');
  });

  it('re-subscribes stored destinations and flags reconnection when the client reconnects', async () => {
    const onReconnect = vi.fn();
    const { result } = renderHook(() =>
      useWebSocket({ getCredentials: walletCredentials, onReconnect }),
    );

    act(() => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    act(() => {
      result.current.subscribe('/user/queue/messages', vi.fn());
    });
    expect(h.subscribeMock).toHaveBeenCalledWith('/user/queue/messages', expect.any(Function));

    h.subscribeMock.mockClear();

    // Simulate a transport reconnect: stompjs invokes onConnect again on the same client.
    act(() => {
      h.state.config?.onConnect?.();
    });

    expect(h.subscribeMock).toHaveBeenCalledWith('/user/queue/messages', expect.any(Function));
    expect(result.current.isReconnection).toBe(true);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('drops a destination from restoration after unsubscribe', async () => {
    const { result } = renderHook(() => useWebSocket({ getCredentials: walletCredentials }));

    act(() => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    act(() => {
      result.current.subscribe('/user/queue/temp', vi.fn());
    });
    expect(h.subscribeMock).toHaveBeenCalledWith('/user/queue/temp', expect.any(Function));

    act(() => {
      result.current.unsubscribe('/user/queue/temp');
    });

    h.subscribeMock.mockClear();
    act(() => {
      h.state.config?.onConnect?.();
    });

    // The unsubscribed destination must NOT be restored on reconnect.
    expect(h.subscribeMock).not.toHaveBeenCalledWith('/user/queue/temp', expect.any(Function));
  });
});

describe('useWebSocket reactive _debug subscription snapshot (IMP-DBGPANEL-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.connected = false;
    h.state.config = null;
    h.subscribeMock.mockImplementation((destination: string) => ({
      id: destination,
      unsubscribe: vi.fn(),
    }));
  });

  it('updates _debug.activeSubscriptions when subscribe is called while connected', async () => {
    const { result } = renderHook(() => useWebSocket({ getCredentials: walletCredentials }));

    act(() => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(result.current._debug.activeSubscriptions).not.toContain('/user/queue/status');

    act(() => {
      result.current.subscribe('/user/queue/status', vi.fn());
    });

    expect(result.current._debug.activeSubscriptions).toContain('/user/queue/status');
    expect(result.current._debug.storedSubscriptions).toContain('/user/queue/status');
  });

  it('removes dest from _debug.activeSubscriptions on unsubscribe', async () => {
    const { result } = renderHook(() => useWebSocket({ getCredentials: walletCredentials }));

    act(() => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    act(() => {
      result.current.subscribe('/user/queue/temp', vi.fn());
    });
    expect(result.current._debug.activeSubscriptions).toContain('/user/queue/temp');

    act(() => {
      result.current.unsubscribe('/user/queue/temp');
    });

    expect(result.current._debug.activeSubscriptions).not.toContain('/user/queue/temp');
    expect(result.current._debug.storedSubscriptions).not.toContain('/user/queue/temp');
  });

  it('updates _debug.storedSubscriptions when subscribe is called while disconnected', () => {
    const { result } = renderHook(() => useWebSocket({ getCredentials: walletCredentials }));

    expect(result.current._debug.storedSubscriptions).not.toContain('/user/queue/early');

    act(() => {
      result.current.subscribe('/user/queue/early', vi.fn());
    });

    expect(h.subscribeMock).not.toHaveBeenCalled();
    expect(result.current._debug.activeSubscriptions).not.toContain('/user/queue/early');
    expect(result.current._debug.storedSubscriptions).toContain('/user/queue/early');
  });
});

describe('useWebSocket reconnect exhausted CTA (IMP-OFFLINE-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.connected = false;
    h.state.config = null;
    h.subscribeMock.mockImplementation((destination: string) => ({
      id: destination,
      unsubscribe: vi.fn(),
    }));
  });

  it('flags exhausted after max closes and allows a manual connect retry', async () => {
    const { result } = renderHook(() =>
      useWebSocket({ getCredentials: walletCredentials, maxReconnectAttempts: 2 }),
    );

    act(() => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    act(() => {
      h.state.connected = false;
      h.state.config?.onWebSocketClose?.({});
      h.state.config?.onWebSocketClose?.({});
    });

    expect(result.current.reconnectExhausted).toBe(true);
    expect(result.current.reconnectAttempt).toBe(2);

    act(() => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(result.current.reconnectExhausted).toBe(false);
    expect(result.current.reconnectAttempt).toBe(0);
  });
});
