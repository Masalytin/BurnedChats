import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { ChatRequest, UserInfo, WireUserResponse } from '../types';
import { mapWireUser } from '../types';

/** Destination for incoming request events (from server) */
const INCOMING_REQUEST_DESTINATION = '/user/queue/incoming-request';

/** Destination for session accepted event (from server) */
const SESSION_ACCEPTED_DESTINATION = '/user/queue/session-accepted';

/** Destination for session rejected event (initiator receives when peer declines) */
const SESSION_REJECTED_DESTINATION = '/user/queue/session-rejected';

/** Destination for pending-request expiry (initiator; IMP-DMPEND-03) */
const REQUEST_EXPIRED_DESTINATION = '/user/queue/request-expired';

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
  | 'WRONG_ANSWER'         // Secret answer does not match
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
  sender: WireUserResponse;
  fromInternalId?: string;
  hasSecretQuestion: boolean;
  secretQuestion?: string;
  createdAt: string;
  expiresAt: string;
}

/** Session accepted event from server */
interface ServerSessionAcceptedEvent {
  success: boolean;
  sessionId: string;
  peer?: WireUserResponse;
  acceptedAt?: string;
  error?: string;
}

/** Session rejected event from server (sent to initiator) */
interface ServerSessionRejectedEvent {
  sessionId: string;
  rejectedAt?: string;
}

/** Pending request expired (TIMEOUT only on this wedge) */
interface ServerRequestExpiredEvent {
  sessionId: string;
  reason?: 'TIMEOUT';
  timestamp?: string;
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
  /** Callback when session is accepted (as responder) */
  onSessionAccepted?: (sessionId: string, peer: UserInfo) => void;
  /** Callback when OUR request is accepted by the peer (as initiator) */
  onOurRequestAccepted?: (sessionId: string, peer: UserInfo) => void;
  /** Callback when OUR request is rejected by the peer (as initiator) */
  onOurRequestRejected?: (sessionId: string) => void;
  /** Callback when a pending request expires (TIMEOUT); match by sessionId */
  onRequestExpired?: (sessionId: string) => void;
  /** Callback when we locally reject an incoming request (as responder) */
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
  onOurRequestAccepted,
  onOurRequestRejected,
  onRequestExpired,
  onRequestRejected,
  onError,
}: UseIncomingRequestsOptions): UseIncomingRequestsReturn {
  const [requests, setRequests] = useState<ChatRequest[]>([]);
  const [actionResult, setActionResult] = useState<ActionResult>(initialActionResult);

  const isSubscribedRef = useRef(false);
  const pendingActionRef = useRef<string | null>(null);

  // Callback refs for stable handlers (prevents subscription churn on every render)
  const onRequestReceivedRef = useRef(onRequestReceived);
  const onSessionAcceptedRef = useRef(onSessionAccepted);
  const onOurRequestAcceptedRef = useRef(onOurRequestAccepted);
  const onOurRequestRejectedRef = useRef(onOurRequestRejected);
  const onRequestExpiredRef = useRef(onRequestExpired);
  const onRequestRejectedRef = useRef(onRequestRejected);
  const onErrorRef = useRef(onError);

  // Keep refs up to date
  useEffect(() => {
    onRequestReceivedRef.current = onRequestReceived;
    onSessionAcceptedRef.current = onSessionAccepted;
    onOurRequestAcceptedRef.current = onOurRequestAccepted;
    onOurRequestRejectedRef.current = onOurRequestRejected;
    onRequestExpiredRef.current = onRequestExpired;
    onRequestRejectedRef.current = onRequestRejected;
    onErrorRef.current = onError;
  });

  /**
   * Handle incoming request event from server.
   */
  const handleIncomingRequest = useCallback((message: IMessage) => {
    try {
      const data: ServerIncomingRequestEvent = JSON.parse(message.body);

      const sender = mapWireUser(data.sender);
      const request: ChatRequest = {
        id: data.sessionId,
        fromInternalId: data.fromInternalId?.trim() || sender.internalId,
        fromUserId: sender.id,
        fromUsername: sender.username,
        fromName: sender.displayName,
        secretQuestion: data.secretQuestion,
        createdAt: new Date(data.createdAt).getTime(),
        expiresAt: new Date(data.expiresAt).getTime(),
        fromOnline: sender.online,
      };

      setRequests((prev) => {
        // Avoid duplicates
        if (prev.some((r) => r.id === request.id)) {
          return prev;
        }
        return [...prev, request];
      });

      onRequestReceivedRef.current?.(request);
      console.log('[useIncomingRequests] Received incoming request:', request.id);
    } catch (error) {
      console.error('[useIncomingRequests] Failed to parse incoming request:', error);
    }
  }, []);

  /**
   * Handle session accepted event from server.
   * This handles two cases:
   * 1. We accepted a request (as responder) - pendingActionRef matches
   * 2. Our request was accepted by peer (as initiator) - pendingActionRef doesn't match
   */
  const handleSessionAccepted = useCallback((message: IMessage) => {
    try {
      const data: ServerSessionAcceptedEvent = JSON.parse(message.body);
      const sessionId = data.sessionId;

      // Check if this was our pending accept action (we're the responder)
      const weAreResponder = pendingActionRef.current === sessionId;

      if (weAreResponder) {
        // We accepted a request - handle responder case
        pendingActionRef.current = null;

        if (!data.success && data.error) {
          const errorCode = data.error as AcceptErrorCode;
          setActionResult({
            status: 'error',
            sessionId,
            peer: null,
            error: errorCode,
          });
          onErrorRef.current?.(errorCode);
          return;
        }

        if (data.success && data.peer) {
          const peer = mapWireUser(data.peer);

          setActionResult({
            status: 'accepted',
            sessionId,
            peer,
            error: null,
          });

          // Remove request from list
          setRequests((prev) => prev.filter((r) => r.id !== sessionId));

          onSessionAcceptedRef.current?.(sessionId, peer);
          console.log('[useIncomingRequests] Session accepted (as responder):', sessionId);
        }
      } else {
        // We're the initiator - our request was accepted by the peer
        // This happens when someone accepts our chat request
        if (data.success && data.peer) {
          const peer = mapWireUser(data.peer);

          onOurRequestAcceptedRef.current?.(sessionId, peer);
          console.log('[useIncomingRequests] Our request accepted (as initiator):', sessionId);
        }
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
        onErrorRef.current?.('CONNECTION_ERROR');
      }
    }
  }, []);

  /**
   * Handle session rejected event from server (we're the initiator).
   */
  const handleSessionRejected = useCallback((message: IMessage) => {
    try {
      const data: ServerSessionRejectedEvent = JSON.parse(message.body);
      const sessionId = data.sessionId;
      if (!sessionId) {
        console.warn('[useIncomingRequests] Session rejected event missing sessionId');
        return;
      }
      onOurRequestRejectedRef.current?.(sessionId);
      console.log('[useIncomingRequests] Our request rejected (as initiator):', sessionId);
    } catch (error) {
      console.error('[useIncomingRequests] Failed to parse session rejected event:', error);
    }
  }, []);

  /**
   * Handle request-expired (TIMEOUT). Match by sessionId; pendingSession may be null.
   */
  const handleRequestExpired = useCallback((message: IMessage) => {
    try {
      const data: ServerRequestExpiredEvent = JSON.parse(message.body);
      const sessionId = data.sessionId;
      if (!sessionId) {
        console.warn('[useIncomingRequests] Request expired event missing sessionId');
        return;
      }
      setRequests((prev) => prev.filter((r) => r.id !== sessionId));
      onRequestExpiredRef.current?.(sessionId);
      console.log('[useIncomingRequests] Request expired:', sessionId);
    } catch (error) {
      console.error('[useIncomingRequests] Failed to parse request expired event:', error);
    }
  }, []);

  /**
   * Register subscriptions immediately (even before connected).
   * This ensures the WebSocket hook can apply them when connection is established,
   * preventing race conditions where server sends messages before subscriptions are ready.
   */
  useEffect(() => {
    // Register subscriptions immediately - they will be stored and applied on connect
    if (!isSubscribedRef.current) {
      subscribe(INCOMING_REQUEST_DESTINATION, handleIncomingRequest);
      subscribe(SESSION_ACCEPTED_DESTINATION, handleSessionAccepted);
      subscribe(SESSION_REJECTED_DESTINATION, handleSessionRejected);
      subscribe(REQUEST_EXPIRED_DESTINATION, handleRequestExpired);
      isSubscribedRef.current = true;
      console.log('[useIncomingRequests] Registered subscriptions for incoming requests');
    }

    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(INCOMING_REQUEST_DESTINATION);
        unsubscribe(SESSION_ACCEPTED_DESTINATION);
        unsubscribe(SESSION_REJECTED_DESTINATION);
        unsubscribe(REQUEST_EXPIRED_DESTINATION);
        isSubscribedRef.current = false;
        console.log('[useIncomingRequests] Unsubscribed from incoming requests');
      }
    };
  }, [subscribe, unsubscribe, handleIncomingRequest, handleSessionAccepted, handleSessionRejected, handleRequestExpired]);

  /**
   * Fetch pending requests explicitly when connected.
   * Fixes race condition: server sends pending requests on SessionConnectedEvent
   * BEFORE the client's SUBSCRIBE frames arrive, so messages are lost.
   */
  const hasFetchedPendingRef = useRef(false);

  useEffect(() => {
    if (isConnected && !hasFetchedPendingRef.current) {
      hasFetchedPendingRef.current = true;
      publish('/app/session.pending', {});
      console.log('[useIncomingRequests] Fetching pending requests');
    }
    if (!isConnected) {
      hasFetchedPendingRef.current = false;
    }
  }, [isConnected, publish]);

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
      onErrorRef.current?.('CONNECTION_ERROR');
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
  }, [isConnected, publish]);

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
      onErrorRef.current?.('CONNECTION_ERROR');
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
      onRequestRejectedRef.current?.(sessionId);
    }, 100);

    console.log('[useIncomingRequests] Reject request sent:', sessionId);
  }, [isConnected, publish]);

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
