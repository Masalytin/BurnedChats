import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { SearchResult, SearchErrorCode, UserInfo, WireUserResponse } from '../types';
import { mapWireUser } from '../types';

/** Destination for sending search requests */
const SEARCH_DESTINATION = '/app/search';

/** Destination for receiving search results */
const SEARCH_RESULT_DESTINATION = '/user/queue/search-result';

/** Destination for STOMP handler errors (rate-limit, validation, etc.) */
const STOMP_ERRORS_DESTINATION = '/user/queue/errors';

/** Debounce delay for search input (ms) */
const SEARCH_DEBOUNCE_MS = 300;

interface UseSearchOptions {
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Subscribe to a STOMP destination */
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  /** Unsubscribe from a STOMP destination */
  unsubscribe: (destination: string) => void;
  /** Publish message to STOMP destination */
  publish: (destination: string, body: unknown) => void;
  /** Debounce search input */
  debounce?: boolean;
  /** Callback when user is found */
  onUserFound?: (user: UserInfo) => void;
  /** Callback when search fails */
  onSearchError?: (error: SearchErrorCode) => void;
}

interface UseSearchReturn {
  /** Current search query */
  query: string;
  /** Set search query */
  setQuery: (query: string) => void;
  /** Current search result */
  result: SearchResult;
  /** Execute search manually */
  search: (query?: string) => void;
  /** Clear search state */
  clearSearch: () => void;
  /** Whether search is in progress */
  isSearching: boolean;
}

/**
 * Initial search result state
 */
const initialResult: SearchResult = {
  status: 'idle',
  user: null,
  error: null,
};

/**
 * Parse server search result event
 */
interface ServerSearchResult {
  found: boolean;
  user?: WireUserResponse;
  error?: string;
}

interface StompErrorEvent {
  error?: string;
  message?: string;
}

function mapStompErrorCode(raw?: string): SearchErrorCode {
  switch (raw) {
    case 'RATE_LIMIT_EXCEEDED':
      return 'RATE_LIMITED';
    case 'SELF_SEARCH':
    case 'INVALID_QUERY':
      return raw;
    default:
      return 'CONNECTION_ERROR';
  }
}

/**
 * Hook for user search functionality via STOMP WebSocket.
 */
export function useSearch({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  debounce = false,
  onUserFound,
  onSearchError,
}: UseSearchOptions): UseSearchReturn {
  const [query, setQueryState] = useState('');
  const [result, setResult] = useState<SearchResult>(initialResult);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSubscribedRef = useRef(false);
  const errorsSubscribedRef = useRef(false);
  /** Ignore duplicate/late responses for the current in-flight search. */
  const searchResponseAppliedRef = useRef(false);

  const onUserFoundRef = useRef(onUserFound);
  const onSearchErrorRef = useRef(onSearchError);
  const publishRef = useRef(publish);

  useEffect(() => {
    onUserFoundRef.current = onUserFound;
    onSearchErrorRef.current = onSearchError;
    publishRef.current = publish;
  });

  const applySearchError = useCallback((errorCode: SearchErrorCode) => {
    if (searchResponseAppliedRef.current) {
      return;
    }
    searchResponseAppliedRef.current = true;
    setResult((prev) => {
      if (prev.status !== 'searching') {
        return prev;
      }
      return { status: 'error', user: null, error: errorCode };
    });
    onSearchErrorRef.current?.(errorCode);
  }, []);

  /**
   * Handle incoming search result from server.
   * Only applies the first response for the current request.
   */
  const handleSearchResult = useCallback((message: IMessage) => {
    if (searchResponseAppliedRef.current) {
      if (import.meta.env.DEV) {
        console.log('[useSearch] Ignoring duplicate/late search response');
      }
      return;
    }
    searchResponseAppliedRef.current = true;

    try {
      const data: ServerSearchResult = JSON.parse(message.body);

      if (data.error) {
        const errorCode = data.error as SearchErrorCode;
        setResult((prev) => {
          if (prev.status !== 'searching') {
            return prev;
          }
          return { status: 'error', user: null, error: errorCode };
        });
        onSearchErrorRef.current?.(errorCode);
        return;
      }

      if (data.found && data.user) {
        const user = mapWireUser(data.user);
        setResult((prev) => {
          if (prev.status !== 'searching') {
            return prev;
          }
          return { status: 'found', user, error: null };
        });
        onUserFoundRef.current?.(user);
      } else {
        setResult((prev) => {
          if (prev.status !== 'searching') {
            return prev;
          }
          return { status: 'not_found', user: null, error: null };
        });
      }
    } catch (error) {
      console.error('[useSearch] Failed to parse search result:', error);
      setResult((prev) => {
        if (prev.status !== 'searching') {
          return prev;
        }
        return { status: 'error', user: null, error: 'CONNECTION_ERROR' };
      });
      onSearchErrorRef.current?.('CONNECTION_ERROR');
    }
  }, []);

  const handleStompError = useCallback((message: IMessage) => {
    try {
      const data: StompErrorEvent = JSON.parse(message.body);
      applySearchError(mapStompErrorCode(data.error));
    } catch (error) {
      console.error('[useSearch] Failed to parse STOMP error:', error);
      applySearchError('CONNECTION_ERROR');
    }
  }, [applySearchError]);

  const cleanupErrorsSubscription = useCallback(() => {
    if (errorsSubscribedRef.current) {
      unsubscribe(STOMP_ERRORS_DESTINATION);
      errorsSubscribedRef.current = false;
    }
  }, [unsubscribe]);

  /**
   * Register subscription immediately (even before connected).
   * The WebSocket hook stores subscriptions and applies them on connect/reconnect.
   */
  useEffect(() => {
    if (!isSubscribedRef.current) {
      subscribe(SEARCH_RESULT_DESTINATION, handleSearchResult);
      isSubscribedRef.current = true;
      console.log('[useSearch] Registered subscription for search results');
    }

    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(SEARCH_RESULT_DESTINATION);
        isSubscribedRef.current = false;
        console.log('[useSearch] Unsubscribed from search results');
      }
      cleanupErrorsSubscription();
    };
  }, [subscribe, unsubscribe, handleSearchResult, cleanupErrorsSubscription]);

  /**
   * Execute search request.
   * Always sends query as string (supports @username and numeric ID).
   */
  const search = useCallback((searchQuery?: string) => {
    const raw = searchQuery ?? query;
    const queryToSearch = typeof raw === 'string' ? raw.trim() : String(raw).trim();

    if (!queryToSearch) {
      setResult(initialResult);
      return;
    }

    if (!isConnected) {
      setResult({
        status: 'error',
        user: null,
        error: 'CONNECTION_ERROR',
      });
      onSearchErrorRef.current?.('CONNECTION_ERROR');
      return;
    }

    searchResponseAppliedRef.current = false;
    setResult({
      status: 'searching',
      user: null,
      error: null,
    });

    if (!errorsSubscribedRef.current) {
      subscribe(STOMP_ERRORS_DESTINATION, handleStompError);
      errorsSubscribedRef.current = true;
    }

    publishRef.current(SEARCH_DESTINATION, { query: String(queryToSearch) });
    if (import.meta.env.DEV) {
      console.log('[useSearch] Search request sent:', JSON.stringify(queryToSearch));
    }
  }, [query, isConnected, subscribe, handleStompError]);

  /**
   * Set query with optional debouncing
   */
  const setQuery = useCallback((newQuery: string) => {
    setQueryState(newQuery);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!newQuery.trim()) {
      setResult(initialResult);
      return;
    }

    if (debounce) {
      debounceTimerRef.current = setTimeout(() => {
        search(newQuery);
      }, SEARCH_DEBOUNCE_MS);
    }
  }, [debounce, search]);

  /**
   * Clear search state
   */
  const clearSearch = useCallback(() => {
    setQueryState('');
    setResult(initialResult);
    searchResponseAppliedRef.current = false;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    query,
    setQuery,
    result,
    search,
    clearSearch,
    isSearching: result.status === 'searching',
  };
}
