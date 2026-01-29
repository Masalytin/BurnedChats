import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';

/** Destination for getting active sessions (4.6.1) */
const GET_ACTIVE_SESSIONS_DESTINATION = '/app/session.active.list';

/** Destination for active sessions list event (4.6.2) */
const ACTIVE_SESSIONS_DESTINATION = '/user/queue/active-sessions';

/** Destination for session resumed event (4.6.3) */
const SESSION_RESUMED_DESTINATION = '/user/queue/session-resumed';

/** Session status types */
export type SessionStatus = 
  | 'PENDING'
  | 'HANDSHAKE'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'BURNED';

/** Peer user information */
export interface PeerInfo {
  id: number;
  username?: string;
  displayName: string;
  photoUrl?: string;
  online: boolean;
  premium: boolean;
}

/** Active session data */
export interface ActiveSession {
  sessionId: string;
  status: SessionStatus;
  peer: PeerInfo;
  verified: boolean;
  peerVerified: boolean;
  createdAt: number;
  lastActivityAt: number;
}

/** Error codes for active sessions */
export type ActiveSessionsErrorCode =
  | 'CONNECTION_ERROR'
  | 'INTERNAL_ERROR';

/** Error codes for resuming session */
export type ResumeSessionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'NOT_PARTICIPANT'
  | 'SESSION_EXPIRED'
  | 'SESSION_NOT_ACTIVE'
  | 'INTERNAL_ERROR'
  | 'CONNECTION_ERROR';

/** Resume session result */
export interface ResumeSessionResult {
  success: boolean;
  session: ActiveSession | null;
  error: ResumeSessionErrorCode | null;
}

/** Server response for active sessions list */
interface ServerActiveSessionsEvent {
  success: boolean;
  sessions: Array<{
    sessionId: string;
    status: string;
    peer: {
      id: number;
      username?: string;
      displayName: string;
      photoUrl?: string;
      online: boolean;
      premium: boolean;
    };
    verified: boolean;
    peerVerified: boolean;
    createdAt: string;
    lastActivityAt: string;
  }>;
  count: number;
  serverTimestamp: string;
  error?: string;
}

/** Server response for session resumed */
interface ServerSessionResumedEvent {
  success: boolean;
  sessionId: string;
  status?: string;
  peer?: {
    id: number;
    username?: string;
    displayName: string;
    photoUrl?: string;
    online: boolean;
    premium: boolean;
  };
  verified?: boolean;
  peerVerified?: boolean;
  createdAt?: string;
  lastActivityAt?: string;
  error?: string;
}

interface UseActiveSessionsOptions {
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Subscribe to a STOMP destination */
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  /** Unsubscribe from a STOMP destination */
  unsubscribe: (destination: string) => void;
  /** Publish message to STOMP destination */
  publish: (destination: string, body: unknown) => void;
  /** Auto-fetch sessions on connect */
  autoFetch?: boolean;
  /** Callback when sessions are loaded */
  onSessionsLoaded?: (sessions: ActiveSession[]) => void;
  /** Callback when session is resumed */
  onSessionResumed?: (session: ActiveSession) => void;
  /** Callback when error occurs */
  onError?: (error: ActiveSessionsErrorCode | ResumeSessionErrorCode) => void;
}

interface UseActiveSessionsReturn {
  /** List of active sessions */
  sessions: ActiveSession[];
  /** Whether sessions are loading */
  isLoading: boolean;
  /** Error if any */
  error: ActiveSessionsErrorCode | null;
  /** Fetch active sessions */
  fetchSessions: () => void;
  /** Resume a specific session */
  resumeSession: (sessionId: string) => void;
  /** Whether resume is in progress */
  isResuming: boolean;
  /** Resume result */
  resumeResult: ResumeSessionResult | null;
  /** Reset resume state */
  resetResume: () => void;
}

/**
 * Hook for managing active sessions via STOMP WebSocket (4.6.5).
 *
 * Handles:
 * - Subscribing to active sessions list events
 * - Fetching active sessions on demand
 * - Resuming existing sessions
 *
 * @example
 * ```tsx
 * function SessionsList() {
 *   const { isConnected, subscribe, unsubscribe, publish } = useWebSocket({ autoConnect: true });
 *
 *   const {
 *     sessions,
 *     isLoading,
 *     fetchSessions,
 *     resumeSession,
 *   } = useActiveSessions({
 *     isConnected,
 *     subscribe,
 *     unsubscribe,
 *     publish,
 *     autoFetch: true,
 *     onSessionResumed: (session) => {
 *       console.log('Session resumed:', session);
 *       // Navigate to chat
 *     },
 *   });
 *
 *   return (
 *     <div>
 *       {sessions.map(session => (
 *         <SessionCard
 *           key={session.sessionId}
 *           session={session}
 *           onClick={() => resumeSession(session.sessionId)}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useActiveSessions({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  autoFetch = true,
  onSessionsLoaded,
  onSessionResumed,
  onError,
}: UseActiveSessionsOptions): UseActiveSessionsReturn {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ActiveSessionsErrorCode | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [resumeResult, setResumeResult] = useState<ResumeSessionResult | null>(null);

  const isSubscribedRef = useRef(false);
  const hasFetchedRef = useRef(false);

  /**
   * Parse server session to client format
   */
  const parseSession = useCallback((serverSession: ServerActiveSessionsEvent['sessions'][0]): ActiveSession => {
    return {
      sessionId: serverSession.sessionId,
      status: serverSession.status as SessionStatus,
      peer: {
        id: serverSession.peer.id,
        username: serverSession.peer.username,
        displayName: serverSession.peer.displayName,
        photoUrl: serverSession.peer.photoUrl,
        online: serverSession.peer.online,
        premium: serverSession.peer.premium,
      },
      verified: serverSession.verified,
      peerVerified: serverSession.peerVerified,
      createdAt: new Date(serverSession.createdAt).getTime(),
      lastActivityAt: new Date(serverSession.lastActivityAt).getTime(),
    };
  }, []);

  /**
   * Handle active sessions list event from server
   */
  const handleActiveSessionsList = useCallback((message: IMessage) => {
    try {
      const data: ServerActiveSessionsEvent = JSON.parse(message.body);
      setIsLoading(false);

      if (!data.success && data.error) {
        const errorCode = data.error as ActiveSessionsErrorCode;
        setError(errorCode);
        onError?.(errorCode);
        return;
      }

      const parsedSessions = data.sessions.map(parseSession);
      
      // Sort by last activity (most recent first)
      parsedSessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
      
      setSessions(parsedSessions);
      setError(null);
      onSessionsLoaded?.(parsedSessions);
      
      console.log('[useActiveSessions] Loaded sessions:', parsedSessions.length);
    } catch (err) {
      console.error('[useActiveSessions] Failed to parse sessions list:', err);
      setIsLoading(false);
      setError('INTERNAL_ERROR');
      onError?.('INTERNAL_ERROR');
    }
  }, [parseSession, onSessionsLoaded, onError]);

  /**
   * Handle session resumed event from server
   */
  const handleSessionResumed = useCallback((message: IMessage) => {
    try {
      const data: ServerSessionResumedEvent = JSON.parse(message.body);
      setIsResuming(false);

      if (!data.success && data.error) {
        const errorCode = data.error as ResumeSessionErrorCode;
        setResumeResult({
          success: false,
          session: null,
          error: errorCode,
        });
        onError?.(errorCode);
        return;
      }

      if (data.success && data.peer) {
        const resumedSession: ActiveSession = {
          sessionId: data.sessionId,
          status: (data.status || 'ACTIVE') as SessionStatus,
          peer: {
            id: data.peer.id,
            username: data.peer.username,
            displayName: data.peer.displayName,
            photoUrl: data.peer.photoUrl,
            online: data.peer.online,
            premium: data.peer.premium,
          },
          verified: data.verified ?? false,
          peerVerified: data.peerVerified ?? false,
          createdAt: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
          lastActivityAt: data.lastActivityAt ? new Date(data.lastActivityAt).getTime() : Date.now(),
        };

        setResumeResult({
          success: true,
          session: resumedSession,
          error: null,
        });
        
        onSessionResumed?.(resumedSession);
        console.log('[useActiveSessions] Session resumed:', resumedSession.sessionId);
      }
    } catch (err) {
      console.error('[useActiveSessions] Failed to parse session resumed event:', err);
      setIsResuming(false);
      setResumeResult({
        success: false,
        session: null,
        error: 'INTERNAL_ERROR',
      });
      onError?.('INTERNAL_ERROR');
    }
  }, [onSessionResumed, onError]);

  /**
   * Subscribe to session events when connected
   */
  useEffect(() => {
    if (isConnected && !isSubscribedRef.current) {
      subscribe(ACTIVE_SESSIONS_DESTINATION, handleActiveSessionsList);
      subscribe(SESSION_RESUMED_DESTINATION, handleSessionResumed);
      isSubscribedRef.current = true;
      console.log('[useActiveSessions] Subscribed to session events');
    }

    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(ACTIVE_SESSIONS_DESTINATION);
        unsubscribe(SESSION_RESUMED_DESTINATION);
        isSubscribedRef.current = false;
        console.log('[useActiveSessions] Unsubscribed from session events');
      }
    };
  }, [isConnected, subscribe, unsubscribe, handleActiveSessionsList, handleSessionResumed]);

  /**
   * Auto-fetch sessions when connected
   */
  useEffect(() => {
    if (isConnected && autoFetch && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      setIsLoading(true);
      publish(GET_ACTIVE_SESSIONS_DESTINATION, {});
      console.log('[useActiveSessions] Auto-fetching active sessions');
    }
  }, [isConnected, autoFetch, publish]);

  /**
   * Reset fetch flag when disconnected
   */
  useEffect(() => {
    if (!isConnected) {
      hasFetchedRef.current = false;
    }
  }, [isConnected]);

  /**
   * Fetch active sessions
   */
  const fetchSessions = useCallback(() => {
    if (!isConnected) {
      setError('CONNECTION_ERROR');
      onError?.('CONNECTION_ERROR');
      return;
    }

    setIsLoading(true);
    setError(null);
    publish(GET_ACTIVE_SESSIONS_DESTINATION, {});
    console.log('[useActiveSessions] Fetching active sessions');
  }, [isConnected, publish, onError]);

  /**
   * Resume a specific session (4.6.3)
   */
  const resumeSession = useCallback((sessionId: string) => {
    if (!isConnected) {
      setResumeResult({
        success: false,
        session: null,
        error: 'CONNECTION_ERROR',
      });
      onError?.('CONNECTION_ERROR');
      return;
    }

    setIsResuming(true);
    setResumeResult(null);
    publish('/app/session.resume', { sessionId });
    console.log('[useActiveSessions] Resuming session:', sessionId);
  }, [isConnected, publish, onError]);

  /**
   * Reset resume state
   */
  const resetResume = useCallback(() => {
    setIsResuming(false);
    setResumeResult(null);
  }, []);

  return {
    sessions,
    isLoading,
    error,
    fetchSessions,
    resumeSession,
    isResuming,
    resumeResult,
    resetResume,
  };
}
