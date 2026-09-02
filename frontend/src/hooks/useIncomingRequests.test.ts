// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { useIncomingRequests } from './useIncomingRequests';

const INCOMING_REQUEST_DESTINATION = '/user/queue/incoming-request';
const SESSION_ACCEPTED_DESTINATION = '/user/queue/session-accepted';
const SESSION_REJECTED_DESTINATION = '/user/queue/session-rejected';
const REQUEST_EXPIRED_DESTINATION = '/user/queue/request-expired';

function stompMessage(body: unknown): IMessage {
  return { body: JSON.stringify(body) } as IMessage;
}

const PEER = {
  internalId: 'peer-1',
  displayName: 'Alice',
  online: false,
  premium: false,
};

describe('useIncomingRequests', () => {
  let subscribe: ReturnType<typeof vi.fn<(destination: string, callback: (message: IMessage) => void) => unknown>>;
  let unsubscribe: ReturnType<typeof vi.fn<(destination: string) => void>>;
  let publish: ReturnType<typeof vi.fn<(destination: string, body: unknown) => void>>;
  let handlers: Record<string, (message: IMessage) => void>;

  beforeEach(() => {
    handlers = {};
    subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
      handlers[destination] = callback;
      return {};
    });
    unsubscribe = vi.fn((_destination: string) => {});
    publish = vi.fn((_destination: string, _body: unknown) => {});
  });

  function renderRequests(options?: {
    onOurRequestAccepted?: (sessionId: string, peer: typeof PEER) => void;
    onOurRequestRejected?: (sessionId: string) => void;
    onRequestExpired?: (sessionId: string) => void;
  }) {
    return renderHook(() =>
      useIncomingRequests({
        isConnected: true,
        subscribe,
        unsubscribe,
        publish,
        ...options,
      }),
    );
  }

  it('keeps sender.online as fromOnline seed for PresenceStore', () => {
    const { result } = renderRequests();

    act(() => {
      handlers[INCOMING_REQUEST_DESTINATION](
        stompMessage({
          sessionId: 'sess-pending',
          sender: PEER,
          fromInternalId: 'peer-1',
          hasSecretQuestion: false,
          createdAt: '2026-08-31T18:00:00Z',
          expiresAt: '2026-08-31T18:05:00Z',
        }),
      );
    });

    expect(result.current.requests[0]?.fromOnline).toBe(false);
  });

  it('subscribes to request-expired together with accept/reject queues', () => {
    renderRequests();

    expect(subscribe).toHaveBeenCalledWith(REQUEST_EXPIRED_DESTINATION, expect.any(Function));
    expect(subscribe).toHaveBeenCalledWith(SESSION_ACCEPTED_DESTINATION, expect.any(Function));
    expect(subscribe).toHaveBeenCalledWith(SESSION_REJECTED_DESTINATION, expect.any(Function));
  });

  it('E5 accept as initiator fires onOurRequestAccepted by sessionId without a live pending action', () => {
    const onOurRequestAccepted = vi.fn();
    renderRequests({ onOurRequestAccepted });

    act(() => {
      handlers[SESSION_ACCEPTED_DESTINATION](
        stompMessage({
          success: true,
          sessionId: 'sess-pending',
          peer: PEER,
        }),
      );
    });

    expect(onOurRequestAccepted).toHaveBeenCalledWith(
      'sess-pending',
      expect.objectContaining({ internalId: 'peer-1', displayName: 'Alice' }),
    );
  });

  it('E6 reject as initiator fires onOurRequestRejected by sessionId', () => {
    const onOurRequestRejected = vi.fn();
    renderRequests({ onOurRequestRejected });

    act(() => {
      handlers[SESSION_REJECTED_DESTINATION](
        stompMessage({
          sessionId: 'sess-pending',
          rejectedAt: '2026-08-31T18:00:00Z',
        }),
      );
    });

    expect(onOurRequestRejected).toHaveBeenCalledWith('sess-pending');
  });

  it('E14 request-expired toasts via callback, drops the inbox card, and does not require pendingSession', () => {
    const onRequestExpired = vi.fn();
    const { result } = renderRequests({ onRequestExpired });

    act(() => {
      handlers[INCOMING_REQUEST_DESTINATION](
        stompMessage({
          sessionId: 'sess-pending',
          sender: PEER,
          fromInternalId: 'peer-1',
          hasSecretQuestion: false,
          createdAt: '2026-08-31T18:00:00Z',
          expiresAt: '2026-08-31T18:05:00Z',
        }),
      );
    });

    expect(result.current.requests).toHaveLength(1);

    act(() => {
      handlers[REQUEST_EXPIRED_DESTINATION](
        stompMessage({
          sessionId: 'sess-pending',
          reason: 'TIMEOUT',
          timestamp: '2026-08-31T18:05:00Z',
        }),
      );
    });

    expect(onRequestExpired).toHaveBeenCalledWith('sess-pending');
    expect(result.current.requests).toHaveLength(0);
  });
});
