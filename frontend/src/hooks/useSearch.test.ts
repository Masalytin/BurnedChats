// @vitest-environment happy-dom
/**
 * Unit tests for useSearch STOMP subscription timing and response handling.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { useSearch } from './useSearch';

const SEARCH_RESULT_DESTINATION = '/user/queue/search-result';
const SEARCH_DESTINATION = '/app/search';
const STOMP_ERRORS_DESTINATION = '/user/queue/errors';

function stompMessage(body: unknown): IMessage {
  return { body: JSON.stringify(body) } as IMessage;
}

describe('useSearch', () => {
  let subscribe: ReturnType<typeof vi.fn<(destination: string, callback: (message: IMessage) => void) => unknown>>;
  let unsubscribe: ReturnType<typeof vi.fn<(destination: string) => void>>;
  let publish: ReturnType<typeof vi.fn<(destination: string, body: unknown) => void>>;
  let searchResultHandlers: Array<(message: IMessage) => void>;
  let errorHandlers: Array<(message: IMessage) => void>;

  beforeEach(() => {
    searchResultHandlers = [];
    errorHandlers = [];
    subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
      if (destination === SEARCH_RESULT_DESTINATION) {
        searchResultHandlers.push(callback);
      }
      if (destination === STOMP_ERRORS_DESTINATION) {
        errorHandlers.push(callback);
      }
      return {};
    });
    unsubscribe = vi.fn((_destination: string) => {});
    publish = vi.fn((_destination: string, _body: unknown) => {});
  });

  function renderUseSearch(isConnected = false) {
    return renderHook(
      ({ connected }) =>
        useSearch({
          isConnected: connected,
          subscribe,
          unsubscribe,
          publish,
        }),
      { initialProps: { connected: isConnected } },
    );
  }

  it('registers search-result subscription before WebSocket is connected', () => {
    renderUseSearch(false);

    expect(subscribe).toHaveBeenCalledWith(
      SEARCH_RESULT_DESTINATION,
      expect.any(Function),
    );
    expect(subscribe).not.toHaveBeenCalledWith(
      STOMP_ERRORS_DESTINATION,
      expect.any(Function),
    );
  });

  it('applies found result for the active search request', () => {
    const { result } = renderUseSearch(true);

    act(() => {
      result.current.search('@testuser');
    });

    expect(publish).toHaveBeenCalledWith(SEARCH_DESTINATION, { query: '@testuser' });
    expect(result.current.isSearching).toBe(true);

    act(() => {
      searchResultHandlers[0](
        stompMessage({
          found: true,
          user: {
            internalId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            id: 42,
            username: 'testuser',
            displayName: 'Test User',
            online: true,
            premium: false,
          },
        }),
      );
    });

    expect(result.current.result.status).toBe('found');
    expect(result.current.result.user?.username).toBe('testuser');
    expect(result.current.isSearching).toBe(false);
  });

  it('allows retrying the same query after a lost response', () => {
    const { result } = renderUseSearch(true);

    act(() => {
      result.current.search('@testuser');
    });
    expect(publish).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.search('@testuser');
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(result.current.isSearching).toBe(true);
  });

  it('maps RATE_LIMITED from /user/queue/errors', () => {
    const onSearchError = vi.fn();
    const { result } = renderHook(() =>
      useSearch({
        isConnected: true,
        subscribe,
        unsubscribe,
        publish,
        onSearchError,
      }),
    );

    act(() => {
      result.current.search('@testuser');
    });

    act(() => {
      errorHandlers[0](stompMessage({ error: 'RATE_LIMIT_EXCEEDED' }));
    });

    expect(result.current.result.status).toBe('error');
    expect(result.current.result.error).toBe('RATE_LIMITED');
    expect(onSearchError).toHaveBeenCalledWith('RATE_LIMITED');
  });
});
