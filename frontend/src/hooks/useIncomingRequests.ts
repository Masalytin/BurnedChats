import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { ChatRequest, UserInfo } from '../types';

/** Destination for incoming request events (from server) */
const INCOMING_REQUEST_DESTINATION = '/user/queue/incoming-request';

/** Destination for session accepted event (from server) */
const SESSION_ACCEPTED_DESTINATION = '/user/queue/session-accepted';

/** Destination for accept request action */
const ACCEPT_SESSION_DESTINATION = '/app/session.accept';

/** Destination for reject request action */
const REJECT_SESSION_DESTINATION = '/app/session.reject';

/** Accept request error codes */
export type AcceptErrorCode =
  | 'SESSION_NOT_FOUND'     // Session doesn't exist
  | 'NOT_RESPONDER'         // User is not the responder
  | 'ALREADY_ACCEPTED'      // Session already accepted
  | 'SESSION_EXPIRED'       // Session has expired
  | 'REQUEST_EXPIRED'       // Request has expired
  | 'ANSWER_REQUIRED'       // Secret answer is required
  | 'INTERNAL_ERROR'        // Server error
  | 'CONNECTION_ERROR';     // WebSocket not connected

/** Status of accept/reject action */
export type ActionStatus =
  | 'idle'           // No action in progress
  | 'accepting'      // Accept in progress
  | 'rejecting'      // Reject in progress
  | 'accepted'       // Successfully accepted
  | 'rejected'       // Successfully rejected
  | 'error';         // Action failed

/** Incoming request from server */
interface ServerIncomingRequestEvent {
  sessionId: string;
  sender: {
    id: number;
    username?: string;
    displayName: string;
    photoUrl?: string;
    online: boolean;
    premium: boolean;
  };
  hasSecretQuestion: boolean;
  secretQuestion?: string;
  createdAt: string;
  expiresAt: string;
}

/** Session accepted event from server */
interface ServerSessionAcceptedEvent {
  success: boolean;
  sessionId: string;
  peer?: {
    id: number;
    username?: string;
    displayName: string;
    photoUrl?: string;
    online: boolean;
    premium: boolean;
  };
  acceptedAt?: string;
  error?: string;
}

/** Action result state */
export interface ActionResult {
  status: ActionStatus;
  sessionId: string | null;
  peer: UserInfo | null;
  error: AcceptErrorCode | null;
}

interface UseIncomingRequestsOptions {
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Subscribe to a STOMP destination */
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  /** Unsubscribe from a STOMP destination */
  unsubscribe: (destination: string) => void;
  /** Publish message to STOMP destination */
  publish: (destination: string, body: unknown) => void;
  /** Callback when a new request is received */
  onRequestReceived?: (request: ChatRequest) => void;
  /** Callback when session is accepted */
  onSessionAccepted?: (sessionId: string, peer: UserInfo) => void;
  /** Callback when a request is rejected */
  onRequestRejected?: (sessionId: string) => void;
  /** Callback when an error occurs */
  onError?: (error: AcceptErrorCode) => void;
}

interface UseIncomingRequestsReturn {
  /** List of incoming requests */
  requests: ChatRequest[];
  /** Current action result */
  actionResult: ActionResult;
  /** Accept a request */
  acceptRequest: (sessionId: string, secretAnswer?: string) => void;
  /** Reject a request */
  rejectRequest: (sessionId: string) => void;
  /** Clear a request from list (e.g., after expire) */
  clearRequest: (sessionId: string) => void;
  /** Reset action result */
  resetAction: () => void;
  /** Whether an action is in progress */
  isProcessing: boolean;
}

/** Initial action result state */
const initialActionResult: ActionResult = {
  status: 'idle',
  sessionId: null,
  peer: null,
  error: null,
};

/**
 * Hook for managing incoming chat requests via STOMP WebSocket.
 *
 * Handles:
 * - Subscribing to incoming request events
 * - Storing and managing incoming requests
 * - Accepting or rejecting requests
 * - Handling response events
 *
 * @example
 * ```tsx
 * function IncomingRequestsComponent() {
 *   const { isConnected, subscribe, unsubscribe, publish } = useWebSocket({ autoConnect: true });
 *
 *   const {
 *     requests,
 *     actionResult,
 *     acceptRequest,
 *     rejectRequest,
 *     isProcessing
 *   } = useIncomingRequests({
 *     isConnected,
 *     subscribe,
 *     unsubscribe,
 *     publish,
 *     onSessionAccepted: (sessionId, peer) => console.log('Session accepted:', sessionId),
 *   });
 *
 *   return (
 *     <div>
 *       {requests.map(req => (
 *         <div key={req.id}>
 *           <span>{req.fromName} wants to chat</span>
 *           <button onClick={() => acceptRequest(req.id)} disabled={isProcessing}>Accept</button>
 *           <button onClick={() => rejectRequest(req.id)} disabled={isProcessing}>Reject</button>
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useIncomingRequests({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onRequestReceived,
  onSessionAccepted,
  onRequestRejected,
  onError,
}: UseIncomingRequestsOptions): UseIncomingRequestsReturn {
  const [requests, setRequests] = useState<ChatRequest[]>([]);
  const [actionResult, setActionResult] = useState<ActionResult>(initialActionResult);

  const isSubscribedRef = useRef(false);
  const pendingActionRef = useRef<string | null>(null);

  /**
   * Handle incoming request event from server.
   */
  const handleIncomingRequest = useCallback((message: IMessage) => {
    try {
      const data: ServerIncomingRequestEvent = JSON.parse(message.body);

      const request: ChatRequest = {
        id: data.sessionId,
        fromUserId: data.sender.id,
        fromUsername: data.sender.username,
        fromName: data.sender.displayName,
        secretQuestion: data.secretQuestion,
        createdAt: new Date(data.createdAt).getTime(),
        expiresAt: new Date(data.expiresAt).getTime(),
      };

      setRequests((prev) => {
        // Avoid duplicates
        if (prev.some((r) => r.id === request.id)) {
          return prev;
        }
        return [...prev, request];
      });

      onRequestReceived?.(request);
      console.log('[useIncomingRequests] Received incoming request:', request.id);
    } catch (error) {
      console.error('[useIncomingRequests] Failed to parse incoming request:', error);
    }
  }, [onRequestReceived]);

  /**
   * Handle session accepted event from server.
   */
  const handleSessionAccepted = useCallback((message: IMessage) => {
    try {
      const data: ServerSessionAcceptedEvent = JSON.parse(message.body);
      const sessionId = data.sessionId;

      // Only process if this was our pending action
      if (pendingActionRef.current !== sessionId) {
        // This might be an acceptance notification for when we're the initiator
        // In that case, we just need to handle it elsewhere (session hook)
        return;
      }

      pendingActionRef.current = null;

      if (!data.success && data.error) {
        const errorCode = data.error as AcceptErrorCode;
        setActionResult({
          status: 'error',
          sessionId,
          peer: null,
          error: errorCode,
        });
        onError?.(errorCode);
        return;
      }

      if (data.success && data.peer) {
        const peer: UserInfo = {
          id: data.peer.id,
          username: data.peer.username,
          displayName: data.peer.displayName,
          photoUrl: data.peer.photoUrl,
          online: data.peer.online,
          premium: data.peer.premium,
        };

        setActionResult({
          status: 'accepted',
          sessionId,
          peer,
          error: null,
        });

        // Remove request from list
        setRequests((prev) => prev.filter((r) => r.id !== sessionId));

        onSessionAccepted?.(sessionId, peer);
        console.log('[useIncomingRequests] Session accepted:', sessionId);
      }
    } catch (error) {
      console.error('[useIncomingRequests] Failed to parse session accepted event:', error);
      if (pendingActionRef.current) {
        setActionResult({
          status: 'error',
          sessionId: pendingActionRef.current,
          peer: null,
          error: 'CONNECTION_ERROR',
        });
        pendingActionRef.current = null;
        onError?.('CONNECTION_ERROR');
      }
    }
  }, [onSessionAccepted, onError]);

  /**
   * Subscribe to events when connected.
   */
  useEffect(() => {
    if (isConnected && !isSubscribedRef.current) {
      subscribe(INCOMING_REQUEST_DESTINATION, handleIncomingRequest);
      subscribe(SESSION_ACCEPTED_DESTINATION, handleSessionAccepted);
      isSubscribedRef.current = true;
      console.log('[useIncomingRequests] Subscribed to incoming requests');
    }

    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(INCOMING_REQUEST_DESTINATION);
        unsubscribe(SESSION_ACCEPTED_DESTINATION);
        isSubscribedRef.current = false;
        console.log('[useIncomingRequests] Unsubscribed from incoming requests');
      }
    };
  }, [isConnected, subscribe, unsubscribe, handleIncomingRequest, handleSessionAccepted]);

  /**
   * Accept a request.
   */
  const acceptRequest = useCallback((sessionId: string, secretAnswer?: string) => {
    if (!isConnected) {
      setActionResult({
        status: 'error',
        sessionId,
        peer: null,
        error: 'CONNECTION_ERROR',
      });
      onError?.('CONNECTION_ERROR');
      return;
    }

    if (pendingActionRef.current) {
      console.warn('[useIncomingRequests] Action already in progress');
      return;
    }

    pendingActionRef.current = sessionId;
    setActionResult({
      status: 'accepting',
      sessionId,
      peer: null,
      error: null,
    });

    const payload: { sessionId: string; secretAnswer?: string } = { sessionId };
    if (secretAnswer?.trim()) {
      payload.secretAnswer = secretAnswer.trim();
    }

    publish(ACCEPT_SESSION_DESTINATION, payload);
    console.log('[useIncomingRequests] Accept request sent:', sessionId);
  }, [isConnected, publish, onError]);

  /**
   * Reject a request.
   */
  const rejectRequest = useCallback((sessionId: string) => {
    if (!isConnected) {
      setActionResult({
        status: 'error',
        sessionId,
        peer: null,
        error: 'CONNECTION_ERROR',
      });
      onError?.('CONNECTION_ERROR');
      return;
    }

    setActionResult({
      status: 'rejecting',
      sessionId,
      peer: null,
      error: null,
    });

    publish(REJECT_SESSION_DESTINATION, { sessionId });

    // Remove from list immediately (no need to wait for confirmation)
    setRequests((prev) => prev.filter((r) => r.id !== sessionId));

    // Set status to rejected after small delay
    setTimeout(() => {
      setActionResult({
        status: 'rejected',
        sessionId,
        peer: null,
        error: null,
      });
      onRequestRejected?.(sessionId);
    }, 100);

    console.log('[useIncomingRequests] Reject request sent:', sessionId);
  }, [isConnected, publish, onError, onRequestRejected]);

  /**
   * Clear a request from list (e.g., after expiration).
   */
  const clearRequest = useCallback((sessionId: string) => {
    setRequests((prev) => prev.filter((r) => r.id !== sessionId));
  }, []);

  /**
   * Reset action result.
   */
  const resetAction = useCallback(() => {
    setActionResult(initialActionResult);
    pendingActionRef.current = null;
  }, []);

  return {
    requests,
    actionResult,
    acceptRequest,
    rejectRequest,
    clearRequest,
    resetAction,
    isProcessing: actionResult.status === 'accepting' || actionResult.status === 'rejecting',
  };
}
