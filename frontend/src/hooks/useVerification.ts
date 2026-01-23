import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';

// ============================================
// Constants
// ============================================

/** Destination for sending verification confirmation */
const VERIFICATION_CONFIRM_DESTINATION = '/app/verification.confirm';

/** Destination for receiving verification events */
const VERIFICATION_DESTINATION = '/user/queue/verification';

// ============================================
// Types
// ============================================

/** Verification error codes */
export type VerificationErrorCode =
  | 'SESSION_NOT_FOUND'     // Session doesn't exist
  | 'NOT_PARTICIPANT'       // User is not in this session
  | 'SESSION_NOT_ACTIVE'    // Session is not active
  | 'SESSION_BURNED'        // Session was burned
  | 'SESSION_NOT_READY'     // Session is still pending
  | 'FINGERPRINT_MISMATCH'  // Fingerprint doesn't match (possible MITM)
  | 'CONNECTION_ERROR'      // WebSocket not connected
  | 'INTERNAL_ERROR';       // Server error

/** Verification status for a session */
export interface VerificationStatus {
  /** Session ID */
  sessionId: string;
  /** Whether the current user has verified */
  selfVerified: boolean;
  /** Whether the peer has verified */
  peerVerified: boolean;
  /** Whether both users have verified */
  bothVerified: boolean;
  /** Timestamp when verification was last updated */
  verifiedAt: Date | null;
  /** Whether a mismatch was reported (security alert) */
  mismatchReported: boolean;
}

/** Server verification event */
interface ServerVerificationEvent {
  success: boolean;
  sessionId?: string;
  verified?: boolean;
  peerVerified?: boolean;
  bothVerified?: boolean;
  verifiedAt?: string;
  error?: string;
}

interface UseVerificationOptions {
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Subscribe to a STOMP destination */
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  /** Unsubscribe from a STOMP destination */
  unsubscribe: (destination: string) => void;
  /** Publish message to STOMP destination */
  publish: (destination: string, body: unknown) => void;
  /** Callback when verification status changes */
  onStatusChange?: (status: VerificationStatus) => void;
  /** Callback when both parties verify */
  onBothVerified?: (sessionId: string) => void;
  /** Callback when mismatch is reported (security alert) */
  onMismatch?: (sessionId: string) => void;
  /** Callback when error occurs */
  onError?: (error: VerificationErrorCode, sessionId?: string) => void;
}

interface UseVerificationReturn {
  /** Verification status map by session ID */
  statuses: Map<string, VerificationStatus>;
  /** Get status for a specific session */
  getStatus: (sessionId: string) => VerificationStatus | null;
  /** Confirm fingerprint verification (fingerprint matches) */
  confirmVerification: (sessionId: string) => void;
  /** Report fingerprint mismatch (security concern) */
  reportMismatch: (sessionId: string) => void;
  /** Whether a specific session is fully verified */
  isFullyVerified: (sessionId: string) => boolean;
  /** Whether peer has verified for a specific session */
  isPeerVerified: (sessionId: string) => boolean;
  /** Clear status for a session */
  clearStatus: (sessionId: string) => void;
}

/** Create initial status for a session */
function createInitialStatus(sessionId: string): VerificationStatus {
  return {
    sessionId,
    selfVerified: false,
    peerVerified: false,
    bothVerified: false,
    verifiedAt: null,
    mismatchReported: false,
  };
}

/**
 * Hook for managing fingerprint verification via STOMP WebSocket.
 *
 * Handles the verification flow where users confirm that their
 * visual fingerprints match, providing MITM protection.
 *
 * @example
 * ```tsx
 * function VerificationComponent({ sessionId }) {
 *   const { isConnected, subscribe, unsubscribe, publish } = useWebSocket({ autoConnect: true });
 *
 *   const {
 *     getStatus,
 *     confirmVerification,
 *     reportMismatch,
 *     isFullyVerified,
 *   } = useVerification({
 *     isConnected,
 *     subscribe,
 *     unsubscribe,
 *     publish,
 *     onBothVerified: (sessionId) => {
 *       console.log('Both parties verified!', sessionId);
 *     },
 *     onMismatch: (sessionId) => {
 *       alert('WARNING: Fingerprint mismatch detected!');
 *     },
 *   });
 *
 *   const status = getStatus(sessionId);
 *
 *   return (
 *     <div>
 *       <p>You verified: {status?.selfVerified ? 'Yes' : 'No'}</p>
 *       <p>Peer verified: {status?.peerVerified ? 'Yes' : 'No'}</p>
 *       <button onClick={() => confirmVerification(sessionId)}>
 *         Confirm Match
 *       </button>
 *       <button onClick={() => reportMismatch(sessionId)}>
 *         Report Mismatch
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useVerification({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onStatusChange,
  onBothVerified,
  onMismatch,
  onError,
}: UseVerificationOptions): UseVerificationReturn {
  const [statuses, setStatuses] = useState<Map<string, VerificationStatus>>(new Map());

  const isSubscribedRef = useRef(false);

  /**
   * Update status for a session.
   */
  const updateStatus = useCallback((
    sessionId: string,
    updates: Partial<VerificationStatus>
  ) => {
    setStatuses((prev) => {
      const newStatuses = new Map(prev);
      const existing = newStatuses.get(sessionId) || createInitialStatus(sessionId);
      const updated = { ...existing, ...updates };
      newStatuses.set(sessionId, updated);
      
      // Trigger callback
      onStatusChange?.(updated);
      
      return newStatuses;
    });
  }, [onStatusChange]);

  /**
   * Handle verification event from server.
   */
  const handleVerificationEvent = useCallback((message: IMessage) => {
    try {
      const data: ServerVerificationEvent = JSON.parse(message.body);

      console.log('[useVerification] Received verification event:', data);

      // Handle error response
      if (!data.success && data.error) {
        const errorCode = data.error as VerificationErrorCode;
        
        // Check for mismatch
        if (errorCode === 'FINGERPRINT_MISMATCH' && data.sessionId) {
          updateStatus(data.sessionId, {
            mismatchReported: true,
            selfVerified: false,
            peerVerified: false,
            bothVerified: false,
          });
          onMismatch?.(data.sessionId);
        }
        
        onError?.(errorCode, data.sessionId);
        return;
      }

      // Update status
      if (data.sessionId) {
        const updates: Partial<VerificationStatus> = {};
        
        if (data.verified !== undefined) {
          updates.selfVerified = data.verified;
        }
        if (data.peerVerified !== undefined) {
          updates.peerVerified = data.peerVerified;
        }
        if (data.bothVerified !== undefined) {
          updates.bothVerified = data.bothVerified;
        }
        if (data.verifiedAt) {
          updates.verifiedAt = new Date(data.verifiedAt);
        }

        updateStatus(data.sessionId, updates);

        // Trigger both verified callback
        if (data.bothVerified) {
          onBothVerified?.(data.sessionId);
        }
      }

    } catch (error) {
      console.error('[useVerification] Failed to handle verification event:', error);
    }
  }, [updateStatus, onBothVerified, onMismatch, onError]);

  /**
   * Subscribe to verification events when connected.
   */
  useEffect(() => {
    if (isConnected && !isSubscribedRef.current) {
      subscribe(VERIFICATION_DESTINATION, handleVerificationEvent);
      isSubscribedRef.current = true;
      console.log('[useVerification] Subscribed to verification events');
    }

    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(VERIFICATION_DESTINATION);
        isSubscribedRef.current = false;
        console.log('[useVerification] Unsubscribed from verification events');
      }
    };
  }, [isConnected, subscribe, unsubscribe, handleVerificationEvent]);

  /**
   * Get status for a specific session.
   */
  const getStatus = useCallback((sessionId: string): VerificationStatus | null => {
    return statuses.get(sessionId) || null;
  }, [statuses]);

  /**
   * Confirm fingerprint verification (fingerprint matches).
   */
  const confirmVerification = useCallback((sessionId: string) => {
    if (!isConnected) {
      onError?.('CONNECTION_ERROR', sessionId);
      return;
    }

    console.log('[useVerification] Confirming verification for session:', sessionId);

    // Optimistically update local state
    updateStatus(sessionId, { selfVerified: true });

    // Send confirmation to server
    publish(VERIFICATION_CONFIRM_DESTINATION, {
      sessionId,
      confirmed: true,
    });
  }, [isConnected, publish, updateStatus, onError]);

  /**
   * Report fingerprint mismatch (security concern).
   */
  const reportMismatch = useCallback((sessionId: string) => {
    if (!isConnected) {
      onError?.('CONNECTION_ERROR', sessionId);
      return;
    }

    console.warn('[useVerification] SECURITY: Reporting fingerprint mismatch for session:', sessionId);

    // Update local state
    updateStatus(sessionId, { 
      selfVerified: false,
      mismatchReported: true,
    });

    // Send mismatch report to server
    publish(VERIFICATION_CONFIRM_DESTINATION, {
      sessionId,
      confirmed: false,
    });
  }, [isConnected, publish, updateStatus, onError]);

  /**
   * Check if a session is fully verified.
   */
  const isFullyVerified = useCallback((sessionId: string): boolean => {
    const status = statuses.get(sessionId);
    return status?.bothVerified === true;
  }, [statuses]);

  /**
   * Check if peer has verified.
   */
  const isPeerVerified = useCallback((sessionId: string): boolean => {
    const status = statuses.get(sessionId);
    return status?.peerVerified === true;
  }, [statuses]);

  /**
   * Clear status for a session.
   */
  const clearStatus = useCallback((sessionId: string) => {
    setStatuses((prev) => {
      const newStatuses = new Map(prev);
      newStatuses.delete(sessionId);
      return newStatuses;
    });
  }, []);

  return {
    statuses,
    getStatus,
    confirmVerification,
    reportMismatch,
    isFullyVerified,
    isPeerVerified,
    clearStatus,
  };
}
