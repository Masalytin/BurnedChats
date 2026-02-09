import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { SearchResult, SearchErrorCode, UserInfo } from '../types';

/** Destination for sending search requests */
const SEARCH_DESTINATION = '/app/search';

/** Destination for receiving search results */
const SEARCH_RESULT_DESTINATION = '/user/queue/search-result';

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
  user?: {
    id: number;
    username?: string;
    displayName: string;
    photoUrl?: string;
    online: boolean;
    premium: boolean;
  };
  error?: string;
}

/**
 * Hook for user search functionality via STOMP WebSocket.
 * 
 * Handles:
 * - Subscribing to search result events
 * - Sending search requests
 * - Managing search state
 * - Optional input debouncing
 * 
 * @example
 * ```tsx
 * function SearchComponent() {
 *   const { isConnected, subscribe, unsubscribe, publish } = useWebSocket({ autoConnect: true });
 *   
 *   const { 
 *     query, 
 *     setQuery, 
 *     result, 
 *     search, 
 *     clearSearch,
 *     isSearching 
 *   } = useSearch({
 *     isConnected,
 *     subscribe,
 *     unsubscribe,
 *     publish,
 *     onUserFound: (user) => console.log('Found:', user),
 *   });
 * 
 *   return (
 *     <div>
 *       <input 
 *         value={query}
 *         onChange={(e) => setQuery(e.target.value)}
 *         placeholder="Search by @username"
 *       />
 *       <button onClick={() => search()} disabled={isSearching}>
 *         Search
 *       </button>
 *       {result.status === 'found' && <UserCard user={result.user} />}
 *       {result.status === 'not_found' && <p>User not found</p>}
 *       {result.error && <p>Error: {result.error}</p>}
 *     </div>
 *   );
 * }
 * ```
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
  const lastQueryRef = useRef('');
  /** Ignore any search response after the first one for the current request (avoids race where a late "not_found" overwrites "found") */
  const searchResponseAppliedRef = useRef(false);

  /**
   * Handle incoming search result from server.
   * Only applies the first response for the current request; ignores late/duplicate responses.
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
          if (prev.status !== 'searching') return prev;
          return { status: 'error', user: null, error: errorCode };
        });
        onSearchError?.(errorCode);
        return;
      }

      if (data.found && data.user) {
        const raw = data.user;
        const user: UserInfo = {
          id: Number(raw.id),
          username: raw.username ?? undefined,
          displayName: raw.displayName ?? `User ${raw.id}`,
          photoUrl: raw.photoUrl ?? undefined,
          online: Boolean(raw.online),
          premium: Boolean(raw.premium),
        };
        setResult((prev) => {
          if (prev.status !== 'searching') return prev;
          return { status: 'found', user, error: null };
        });
        onUserFound?.(user);
      } else {
        setResult((prev) => {
          if (prev.status !== 'searching') return prev;
          return { status: 'not_found', user: null, error: null };
        });
      }
    } catch (error) {
      console.error('[useSearch] Failed to parse search result:', error);
      setResult((prev) => {
        if (prev.status !== 'searching') return prev;
        return { status: 'error', user: null, error: 'CONNECTION_ERROR' };
      });
    }
  }, [onUserFound, onSearchError]);

  /**
   * Subscribe to search results when connected
   */
  useEffect(() => {
    if (isConnected && !isSubscribedRef.current) {
      subscribe(SEARCH_RESULT_DESTINATION, handleSearchResult);
      isSubscribedRef.current = true;
      console.log('[useSearch] Subscribed to search results');
    }

    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(SEARCH_RESULT_DESTINATION);
        isSubscribedRef.current = false;
        console.log('[useSearch] Unsubscribed from search results');
      }
    };
  }, [isConnected, subscribe, unsubscribe, handleSearchResult]);

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
      onSearchError?.('CONNECTION_ERROR');
      return;
    }

    // Avoid duplicate searches (same query already in progress)
    if (queryToSearch === lastQueryRef.current && result.status === 'searching') {
      return;
    }

    lastQueryRef.current = queryToSearch;
    searchResponseAppliedRef.current = false;
    setResult({
      status: 'searching',
      user: null,
      error: null,
    });

    publish(SEARCH_DESTINATION, { query: String(queryToSearch) });
    if (import.meta.env.DEV) {
      console.log('[useSearch] Search request sent:', JSON.stringify(queryToSearch));
    }
  }, [query, isConnected, publish, result.status, onSearchError]);

  /**
   * Set query with optional debouncing
   */
  const setQuery = useCallback((newQuery: string) => {
    setQueryState(newQuery);

    // Clear previous debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // If query is empty, clear results immediately
    if (!newQuery.trim()) {
      setResult(initialResult);
      return;
    }

    // Debounced search if enabled
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
    lastQueryRef.current = '';
    searchResponseAppliedRef.current = false;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // Cleanup debounce timer on unmount
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
