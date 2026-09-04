// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { useDmMessageTtl } from '../useDmMessageTtl';

const SET_DESTINATION = '/app/session.setMessageTtl';
const EVENT_DESTINATION = '/user/queue/session-message-ttl-updated';

describe('useDmMessageTtl', () => {
  let subscribe: ReturnType<typeof vi.fn<(destination: string, cb: (m: IMessage) => void) => unknown>>;
  let unsubscribe: ReturnType<typeof vi.fn<(destination: string) => void>>;
  let publish: ReturnType<typeof vi.fn<(destination: string, body: unknown) => void>>;
  let eventHandler: ((message: IMessage) => void) | null;

  beforeEach(() => {
    eventHandler = null;
    subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
      if (destination === EVENT_DESTINATION) {
        eventHandler = callback;
      }
      return {};
    });
    unsubscribe = vi.fn();
    publish = vi.fn();
  });

  function renderTtl(initialTtlSeconds = 0, sessionId = 'sess-1') {
    return renderHook(
      (props: { initialTtlSeconds: number; sessionId: string }) =>
        useDmMessageTtl({
          sessionId: props.sessionId,
          isConnected: true,
          subscribe,
          unsubscribe,
          publish,
          initialTtlSeconds: props.initialTtlSeconds,
        }),
      { initialProps: { initialTtlSeconds, sessionId } },
    );
  }

  it('hydrates from session snapshot so remount is not 0 when TTL is set', () => {
    const first = renderTtl(300);
    expect(first.result.current.messageTtlSeconds).toBe(300);
    first.unmount();

    const remount = renderTtl(300);
    expect(remount.result.current.messageTtlSeconds).toBe(300);
    expect(remount.result.current.messageTtlSeconds).not.toBe(0);
  });

  it('ignores a later event with an older updatedAt', () => {
    const { result } = renderTtl(0);
    expect(eventHandler).toBeTypeOf('function');

    act(() => {
      eventHandler!({
        body: JSON.stringify({
          eventType: 'SESSION_MESSAGE_TTL_UPDATED',
          success: true,
          sessionId: 'sess-1',
          messageTtlSeconds: 3600,
          updatedAt: '2026-09-04T12:00:10.000Z',
        }),
      } as IMessage);
    });
    expect(result.current.messageTtlSeconds).toBe(3600);

    act(() => {
      eventHandler!({
        body: JSON.stringify({
          eventType: 'SESSION_MESSAGE_TTL_UPDATED',
          success: true,
          sessionId: 'sess-1',
          messageTtlSeconds: 300,
          updatedAt: '2026-09-04T12:00:05.000Z',
        }),
      } as IMessage);
    });
    expect(result.current.messageTtlSeconds).toBe(3600);
  });

  it('publishes setTtl including 0 = off', () => {
    const { result } = renderTtl(300);

    act(() => {
      result.current.setMessageTtl(0);
    });
    expect(publish).toHaveBeenCalledWith(SET_DESTINATION, {
      sessionId: 'sess-1',
      messageTtlSeconds: 0,
    });

    act(() => {
      result.current.applyPreset('5m');
    });
    expect(publish).toHaveBeenCalledWith(SET_DESTINATION, {
      sessionId: 'sess-1',
      messageTtlSeconds: 300,
    });

    act(() => {
      result.current.applyCustomSeconds(45);
    });
    expect(publish).toHaveBeenCalledWith(SET_DESTINATION, {
      sessionId: 'sess-1',
      messageTtlSeconds: 45,
    });
  });

  it('sets ttlSetNotice only on a live SESSION_MESSAGE_TTL_UPDATED, not on snapshot hydrate', () => {
    const { result, rerender, unmount } = renderTtl(0);
    expect(result.current.ttlSetNotice).toBeNull();

    rerender({ initialTtlSeconds: 300, sessionId: 'sess-1' });
    expect(result.current.messageTtlSeconds).toBe(300);
    expect(result.current.ttlSetNotice).toBeNull();

    act(() => {
      eventHandler!({
        body: JSON.stringify({
          eventType: 'SESSION_MESSAGE_TTL_UPDATED',
          success: true,
          sessionId: 'sess-1',
          messageTtlSeconds: 300,
          updatedAt: '2026-09-04T12:00:20.000Z',
        }),
      } as IMessage);
    });
    expect(result.current.ttlSetNotice).toBe(300);

    unmount();
    const remount = renderTtl(300);
    expect(remount.result.current.messageTtlSeconds).toBe(300);
    expect(remount.result.current.ttlSetNotice).toBeNull();
  });
});
