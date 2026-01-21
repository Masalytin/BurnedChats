import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { UserInfo, Session, SessionStatus } from '../types';

/** Destination for creating session */
const SESSION_CREATE_DESTINATION = '/app/session.create';

/** Destination for session created event (response to initiator) */
const SESSION_CREATED_DESTINATION = '/user/queue/session-created';

/** Session creation error codes */
export type SessionErrorCode =
  | 'SELF_REQUEST'          // User tried to create session with themselves
  | 'ALREADY_HAS_SESSION'   // User already has an active session
  | 'RECIPIENT_HAS_SESSION' // Recipient already has an active session
  | 'PENDING_REQUEST_EXISTS'// Already sent a pending request
  | 'RECIPIENT_NOT_FOUND'   // Recipient not found
  | 'RATE_LIMITED'          // Too many requests
  | 'INTERNAL_ERROR'        // Server error
  | 'CONNECTION_ERROR';     // WebSocket not connected

/** Status of session creation request */
export type CreateSessionStatus =
  | 'idle'           // No request in progress
  | 'creating'       // Request sent, waiting for response
  | 'created'        // Session created successfully
  | 'error';         // Creation failed

/** Session creation result */
export interface CreateSessionResult {
  status: CreateSessionStatus;
  session: PendingSession | null;
  error: SessionErrorCode | null;
}

/** Pending session data (after creation, waiting for acceptance) */
export interface PendingSession {
  id: string;
  recipient: UserInfo;
  hasSecretQuestion: boolean;
  createdAt: number;
  expiresAt: number;
}

/** Server response for session creation */
interface ServerSessionCreatedEvent {
  success: boolean;
  sessionId?: string;
  recipient?: {
    id: number;
    username?: string;
    displayName: string;
    photoUrl?: string;
    online: boolean;
    premium: boolean;
  };
  hasSecretQuestion?: boolean;
  createdAt?: string;
  expiresAt?: string;
  error?: string;
}

interface UseSessionOptions {
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Subscribe to a STOMP destination */
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  /** Unsubscribe from a STOMP destination */
  unsubscribe: (destination: string) => void;
  /** Publish message to STOMP destination */
  publish: (destination: string, body: unknown) => void;
  /** Callback when session is created */
  onSessionCreated?: (session: PendingSession) => void;
  /** Callback when creation fails */
  onError?: (error: SessionErrorCode) => void;
}

interface UseSessionReturn {
  /** Current creation result */
  result: CreateSessionResult;
  /** Create a new session */
  createSession: (recipientId: number, secretQuestion?: string) => void;
  /** Reset state */
  reset: () => void;
  /** Whether creation is in progress */
  isCreating: boolean;
}

/** Initial result state */
const initialResult: CreateSessionResult = {
  status: 'idle',
  session: null,
  error: null,
};

/**
 * Hook for managing chat session creation via STOMP WebSocket.
 *
 * Handles:
 * - Subscribing to session created events
 * - Sending create session requests
 * - Managing session creation state
 *
 * @example
 * ```tsx
 * function ChatRequestComponent() {
 *   const { isConnected, subscribe, unsubscribe, publish } = useWebSocket({ autoConnect: true });
 *
 *   const {
 *     result,
 *     createSession,
 *     reset,
 *     isCreating
 *   } = useSession({
 *     isConnected,
 *     subscribe,
 *     unsubscribe,
 *     publish,
 *     onSessionCreated: (session) => console.log('Session created:', session),
 *   });
 *
 *   return (
 *     <button
 *       onClick={() => createSession(123456789, 'What is our secret?')}
 *       disabled={isCreating}
 *     >
 *       Start Chat
 *     </button>
 *   );
 * }
 * ```
 */
export function useSession({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onSessionCreated,
  onError,
}: UseSessionOptions): UseSessionReturn {
  const [result, setResult] = useState<CreateSessionResult>(initialResult);

  const isSubscribedRef = useRef(false);

  /**
   * Handle session created event from server
   */
  const handleSessionCreated = useCallback((message: IMessage) => {
    try {
      const data: ServerSessionCreatedEvent = JSON.parse(message.body);

      if (!data.success && data.error) {
        const errorCode = data.error as SessionErrorCode;
        setResult({
          status: 'error',
          session: null,
          error: errorCode,
        });
        onError?.(errorCode);
        return;
      }

      if (data.success && data.sessionId && data.recipient) {
        const session: PendingSession = {
          id: data.sessionId,
          recipient: {
            id: data.recipient.id,
            username: data.recipient.username,
            displayName: data.recipient.displayName,
            photoUrl: data.recipient.photoUrl,
            online: data.recipient.online,
            premium: data.recipient.premium,
          },
          hasSecretQuestion: data.hasSecretQuestion ?? false,
          createdAt: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
          expiresAt: data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 5 * 60 * 1000,
        };

        setResult({
          status: 'created',
          session,
          error: null,
        });
        onSessionCreated?.(session);
      }
    } catch (error) {
      console.error('[useSession] Failed to parse session created event:', error);
      setResult({
        status: 'error',
        session: null,
        error: 'CONNECTION_ERROR',
      });
      onError?.('CONNECTION_ERROR');
    }
  }, [onSessionCreated, onError]);

  /**
   * Subscribe to session events when connected
   */
  useEffect(() => {
    if (isConnected && !isSubscribedRef.current) {
      subscribe(SESSION_CREATED_DESTINATION, handleSessionCreated);
      isSubscribedRef.current = true;
      console.log('[useSession] Subscribed to session created events');
    }

    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(SESSION_CREATED_DESTINATION);
        isSubscribedRef.current = false;
        console.log('[useSession] Unsubscribed from session created events');
      }
    };
  }, [isConnected, subscribe, unsubscribe, handleSessionCreated]);

  /**
   * Create a new session request
   */
  const createSession = useCallback((recipientId: number, secretQuestion?: string) => {
    if (!isConnected) {
      setResult({
        status: 'error',
        session: null,
        error: 'CONNECTION_ERROR',
      });
      onError?.('CONNECTION_ERROR');
      return;
    }

    setResult({
      status: 'creating',
      session: null,
      error: null,
    });

    const payload: { recipientId: number; secretQuestion?: string } = {
      recipientId,
    };

    if (secretQuestion?.trim()) {
      payload.secretQuestion = secretQuestion.trim();
    }

    publish(SESSION_CREATE_DESTINATION, payload);
    console.log('[useSession] Session creation request sent:', recipientId);
  }, [isConnected, publish, onError]);

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setResult(initialResult);
  }, []);

  return {
    result,
    createSession,
    reset,
    isCreating: result.status === 'creating',
  };
}
