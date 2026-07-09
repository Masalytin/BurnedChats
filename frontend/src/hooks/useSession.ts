import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMessage } from '@stomp/stompjs';
import type { UserInfo, WireUserResponse } from '../types';
import { mapWireUser } from '../types';
import { usePow, type PowPhase } from './usePow';
import type { PowSolution } from '../services/powService';

/** Destination for creating session */
const SESSION_CREATE_DESTINATION = '/app/session.create';

/** Destination for session created event (response to initiator) */
const SESSION_CREATED_DESTINATION = '/user/queue/session-created';

/** Destination for STOMP handler errors (PoW, rate-limit, etc.) */
const STOMP_ERRORS_DESTINATION = '/user/queue/errors';

/** Session creation error codes */
export type SessionErrorCode =
  | 'SELF_REQUEST'          // User tried to create session with themselves
  | 'ALREADY_HAS_SESSION'   // User already has an active session
  | 'RECIPIENT_HAS_SESSION' // Recipient already has an active session
  | 'PENDING_REQUEST_EXISTS'// Already sent a pending request
  | 'RECIPIENT_NOT_FOUND'   // Recipient not found
  | 'RATE_LIMITED'          // Too many requests
  | 'POW_INVALID'           // PoW solution rejected by server
  | 'POW_FAILED'            // PoW challenge/solve failed client-side
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
  /** User-facing message (i18n) when available */
  errorMessage: string | null;
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
  recipient?: WireUserResponse;
  hasSecretQuestion?: boolean;
  createdAt?: string;
  expiresAt?: string;
  error?: string;
}

interface StompErrorEvent {
  success?: boolean;
  error?: string;
  message?: string;
  /** Seconds until the client may retry (rate-limit responses). */
  retryAfter?: number;
}

interface PendingCreateContext {
  recipientInternalId: string;
  secret?: CreateSessionSecretOptions;
  powRetried: boolean;
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

export interface CreateSessionSecretOptions {
  secretQuestion: string;
  secretExpectedAnswer: string;
}

interface UseSessionReturn {
  /** Current creation result */
  result: CreateSessionResult;
  /** Create a new session */
  createSession: (recipientInternalId: string, secret?: CreateSessionSecretOptions) => void;
  /** Reset state */
  reset: () => void;
  /** Whether creation is in progress */
  isCreating: boolean;
  /** Current PoW phase (for progress UI). */
  powPhase: PowPhase;
  /** Live PoW hash-iteration count for the active/last solve (for progress UI). */
  powProgressIterations: number;
}

/** Initial result state */
const initialResult: CreateSessionResult = {
  status: 'idle',
  session: null,
  error: null,
  errorMessage: null,
};

/**
 * Hook for managing chat session creation via STOMP WebSocket.
 *
 * Handles:
 * - Subscribing to session created events
 * - PoW challenge/solve before session.create (IMP-ASPOW-06)
 * - Sending create session requests
 * - Managing session creation state
 */
export function useSession({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onSessionCreated,
  onError,
}: UseSessionOptions): UseSessionReturn {
  const { t } = useTranslation();
  const [result, setResult] = useState<CreateSessionResult>(initialResult);

  const isSubscribedRef = useRef(false);
  const errorsSubscribedRef = useRef(false);
  const pendingCreateRef = useRef<PendingCreateContext | null>(null);
  const createInFlightRef = useRef(false);
  const createAbortRef = useRef<AbortController | null>(null);

  const {
    solveFor,
    cancel: cancelPow,
    phase: powPhase,
    progressIterations: powProgressIterations,
  } = usePow({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
  });

  // Callback refs for stable handlers (prevents subscription churn on every render)
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onErrorRef = useRef(onError);
  const solveForRef = useRef(solveFor);
  const publishRef = useRef(publish);
  const tRef = useRef(t);

  // Keep refs up to date
  useEffect(() => {
    onSessionCreatedRef.current = onSessionCreated;
    onErrorRef.current = onError;
    solveForRef.current = solveFor;
    publishRef.current = publish;
    tRef.current = t;
  });

  const failCreation = useCallback((error: SessionErrorCode, errorMessage: string) => {
    pendingCreateRef.current = null;
    createInFlightRef.current = false;
    setResult({
      status: 'error',
      session: null,
      error,
      errorMessage,
    });
    onErrorRef.current?.(error);
  }, []);

  const cleanupErrorsSubscription = useCallback(() => {
    if (errorsSubscribedRef.current) {
      unsubscribe(STOMP_ERRORS_DESTINATION);
      errorsSubscribedRef.current = false;
    }
  }, [unsubscribe]);

  const buildSessionPayload = useCallback((
    recipientInternalId: string,
    secret: CreateSessionSecretOptions | undefined,
    pow: PowSolution,
  ) => {
    const payload: {
      recipientInternalId: string;
      secretQuestion?: string;
      secretExpectedAnswer?: string;
      pow: PowSolution;
    } = {
      recipientInternalId,
      pow,
    };

    const q = secret?.secretQuestion?.trim();
    const a = secret?.secretExpectedAnswer?.trim();
    if (q && a) {
      payload.secretQuestion = q;
      payload.secretExpectedAnswer = a;
    }

    return payload;
  }, []);

  const publishSessionCreate = useCallback((
    recipientInternalId: string,
    secret: CreateSessionSecretOptions | undefined,
    pow: PowSolution,
  ) => {
    publishRef.current(SESSION_CREATE_DESTINATION, buildSessionPayload(recipientInternalId, secret, pow));
    console.log('[useSession] Session creation request sent:', recipientInternalId);
  }, [buildSessionPayload]);

  const runCreateWithPow = useCallback(async (context: PendingCreateContext) => {
    if (createInFlightRef.current) {
      return;
    }
    createInFlightRef.current = true;
    const abort = new AbortController();
    createAbortRef.current = abort;

    try {
      const pow = await solveForRef.current('session_create');
      if (abort.signal.aborted) {
        return;
      }
      publishSessionCreate(context.recipientInternalId, context.secret, pow);
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort) {
        return;
      }
      const message = error instanceof Error && error.message.includes('timed out')
        ? tRef.current('pow.errors.timeout')
        : tRef.current('pow.errors.failed');
      failCreation('POW_FAILED', message);
      cleanupErrorsSubscription();
    } finally {
      if (createAbortRef.current === abort) {
        createAbortRef.current = null;
      }
      createInFlightRef.current = false;
    }
  }, [cleanupErrorsSubscription, failCreation, publishSessionCreate]);

  /**
   * Handle PoW-related errors from /user/queue/errors during session creation.
   */
  const handleStompError = useCallback((message: IMessage) => {
    const pending = pendingCreateRef.current;
    if (!pending) {
      return;
    }

    try {
      const data: StompErrorEvent = JSON.parse(message.body);
      const code = data.error;

      if (code === 'POW_REQUIRED') {
        if (!pending.powRetried) {
          pendingCreateRef.current = { ...pending, powRetried: true };
          void runCreateWithPow(pendingCreateRef.current);
          return;
        }
        cleanupErrorsSubscription();
        failCreation('POW_FAILED', tRef.current('pow.errors.required'));
        return;
      }

      if (code === 'POW_INVALID') {
        cleanupErrorsSubscription();
        failCreation('POW_INVALID', tRef.current('pow.errors.invalid'));
        return;
      }

      if (code === 'RATE_LIMIT_EXCEEDED') {
        cleanupErrorsSubscription();
        const baseMessage = tRef.current('chatRequest.errors.RATE_LIMITED');
        const retryAfter = data.retryAfter;
        const errorMessage =
          typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0
            ? `${baseMessage} (${retryAfter}s)`
            : baseMessage;
        failCreation('RATE_LIMITED', errorMessage);
      }
    } catch (error) {
      console.error('[useSession] Failed to parse STOMP error event:', error);
    }
  }, [cleanupErrorsSubscription, failCreation, runCreateWithPow]);

  /**
   * Handle session created event from server
   */
  const handleSessionCreated = useCallback((message: IMessage) => {
    try {
      const data: ServerSessionCreatedEvent = JSON.parse(message.body);

      if (!data.success && data.error) {
        cleanupErrorsSubscription();
        pendingCreateRef.current = null;
        const errorCode = data.error as SessionErrorCode;
        setResult({
          status: 'error',
          session: null,
          error: errorCode,
          errorMessage: null,
        });
        onErrorRef.current?.(errorCode);
        return;
      }

      if (data.success && data.sessionId && data.recipient) {
        cleanupErrorsSubscription();
        pendingCreateRef.current = null;

        const session: PendingSession = {
          id: data.sessionId,
          recipient: mapWireUser(data.recipient),
          hasSecretQuestion: data.hasSecretQuestion ?? false,
          createdAt: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
          expiresAt: data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 5 * 60 * 1000,
        };

        setResult({
          status: 'created',
          session,
          error: null,
          errorMessage: null,
        });
        onSessionCreatedRef.current?.(session);
      }
    } catch (error) {
      console.error('[useSession] Failed to parse session created event:', error);
      cleanupErrorsSubscription();
      pendingCreateRef.current = null;
      setResult({
        status: 'error',
        session: null,
        error: 'CONNECTION_ERROR',
        errorMessage: null,
      });
      onErrorRef.current?.('CONNECTION_ERROR');
    }
  }, [cleanupErrorsSubscription]);

  /**
   * Register subscription immediately (even before connected).
   * The WebSocket hook stores subscriptions and applies them on connect/reconnect.
   */
  useEffect(() => {
    if (!isSubscribedRef.current) {
      subscribe(SESSION_CREATED_DESTINATION, handleSessionCreated);
      isSubscribedRef.current = true;
      console.log('[useSession] Registered subscription for session created events');
    }

    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(SESSION_CREATED_DESTINATION);
        isSubscribedRef.current = false;
        console.log('[useSession] Unsubscribed from session created events');
      }
      cleanupErrorsSubscription();
      cancelPow();
    };
  }, [subscribe, unsubscribe, handleSessionCreated, cleanupErrorsSubscription, cancelPow]);

  /**
   * Create a new session request (with PoW when enabled on server).
   */
  const createSession = useCallback((recipientInternalId: string, secret?: CreateSessionSecretOptions) => {
    if (!isConnected) {
      setResult({
        status: 'error',
        session: null,
        error: 'CONNECTION_ERROR',
        errorMessage: null,
      });
      onErrorRef.current?.('CONNECTION_ERROR');
      return;
    }

    const trimmedId = recipientInternalId.trim();
    if (!trimmedId) {
      setResult({
        status: 'error',
        session: null,
        error: 'RECIPIENT_NOT_FOUND',
        errorMessage: null,
      });
      onErrorRef.current?.('RECIPIENT_NOT_FOUND');
      return;
    }

    setResult({
      status: 'creating',
      session: null,
      error: null,
      errorMessage: null,
    });

    pendingCreateRef.current = {
      recipientInternalId: trimmedId,
      secret,
      powRetried: false,
    };

    if (!errorsSubscribedRef.current) {
      subscribe(STOMP_ERRORS_DESTINATION, handleStompError);
      errorsSubscribedRef.current = true;
    }

    void runCreateWithPow(pendingCreateRef.current);
  }, [isConnected, subscribe, handleStompError, runCreateWithPow]);

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    createAbortRef.current?.abort();
    createAbortRef.current = null;
    createInFlightRef.current = false;
    pendingCreateRef.current = null;
    cleanupErrorsSubscription();
    cancelPow();
    setResult(initialResult);
  }, [cleanupErrorsSubscription, cancelPow]);

  return {
    result,
    createSession,
    reset,
    isCreating: result.status === 'creating',
    powPhase,
    powProgressIterations,
  };
}
