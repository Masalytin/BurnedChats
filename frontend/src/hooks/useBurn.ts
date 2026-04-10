import { useCallback, useEffect, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { useWebSocket } from './useWebSocket';
import { burn as burnKeys } from '@/crypto/keyStore';
import { clearDownloadCache } from '@/services/fileDownloadService';
import { cancelAll } from '@/services/transferQueue';
import WebApp from '@twa-dev/sdk';

// ============================================
// Types
// ============================================

/** Burn error codes */
export type BurnErrorCode =
  | 'NOT_CONNECTED'       // WebSocket not connected
  | 'NO_SESSION'          // No active session
  | 'SESSION_NOT_FOUND'   // Session doesn't exist
  | 'NOT_PARTICIPANT'     // User is not a session participant
  | 'ALREADY_BURNED'      // Session was already burned
  | 'INTERNAL_ERROR';     // Unexpected error

/** Burn operation status */
export type BurnStatus = 'idle' | 'confirming' | 'burning' | 'burned' | 'error';

/** Burn signal event from server */
interface BurnSignalEvent {
  success: boolean;
  sessionId: string;
  burnedBy?: number;
  burnedAt?: string;
  error?: string;
}

/** Hook options */
interface UseBurnOptions {
  /** Session ID to monitor for burn signals */
  sessionId: string;
  /** Current user's Telegram ID */
  userId: number;
  /** Callback when session is burned (by either participant) */
  onBurned?: (burnedBy: number, wasSelf: boolean) => void;
  /** Callback when error occurs */
  onError?: (error: BurnErrorCode) => void;
}

/** Hook return value */
interface UseBurnReturn {
  /** Current burn status */
  status: BurnStatus;
  /** Whether a burn is in progress */
  isBurning: boolean;
  /** Whether session was burned */
  isBurned: boolean;
  /** Who burned the session (user ID) */
  burnedBy: number | null;
  /** Whether current user initiated the burn */
  wasSelfBurn: boolean;
  /** Request to burn the session (shows confirmation) */
  requestBurn: () => void;
  /** Confirm and execute burn */
  confirmBurn: () => Promise<void>;
  /** Cancel burn request */
  cancelBurn: () => void;
  /** Current error */
  error: BurnErrorCode | null;
}

// ============================================
// Constants
// ============================================

const BURN_SIGNAL_DESTINATION = '/user/queue/burn-signal';
const BURN_SESSION_DESTINATION = '/app/session.burn';

// ============================================
// Hook Implementation
// ============================================

/**
 * Hook for burn (destroy) operations on chat sessions.
 * 
 * Handles:
 * - Initiating burn requests (4.4.4)
 * - Receiving BURN_SIGNAL events (4.4.7)
 * - Cleaning up local cryptographic keys
 * - Haptic feedback for burn events
 * 
 * @example
 * ```tsx
 * function ChatView({ sessionId, userId }: Props) {
 *   const { 
 *     status, 
 *     isBurned, 
 *     requestBurn, 
 *     confirmBurn, 
 *     cancelBurn 
 *   } = useBurn({
 *     sessionId,
 *     userId,
 *     onBurned: (burnedBy, wasSelf) => {
 *       navigate('/');
 *     },
 *   });
 * 
 *   return (
 *     <>
 *       <button onClick={requestBurn}>🔥 Burn</button>
 *       {status === 'confirming' && (
 *         <BurnConfirmDialog 
 *           onConfirm={confirmBurn} 
 *           onCancel={cancelBurn} 
 *         />
 *       )}
 *       {isBurned && <BurnAnimation />}
 *     </>
 *   );
 * }
 * ```
 */
export function useBurn(options: UseBurnOptions): UseBurnReturn {
  const { sessionId, userId, onBurned, onError } = options;

  const [status, setStatus] = useState<BurnStatus>('idle');
  const [error, setError] = useState<BurnErrorCode | null>(null);
  const [burnedBy, setBurnedBy] = useState<number | null>(null);

  const { isConnected, subscribe, unsubscribe, publish } = useWebSocket();

  // ============================================
  // Error Handling
  // ============================================

  const handleError = useCallback((code: BurnErrorCode) => {
    setError(code);
    setStatus('error');
    onError?.(code);
    console.error(`[useBurn] Error: ${code}`);
  }, [onError]);

  // ============================================
  // Burn Request (4.4.4)
  // ============================================

  /**
   * Request to burn the session - shows confirmation dialog.
   */
  const requestBurn = useCallback(() => {
    if (status === 'burning' || status === 'burned') {
      return;
    }
    setStatus('confirming');
    setError(null);
    
    // Haptic feedback for important action
    try {
      WebApp.HapticFeedback.impactOccurred('medium');
    } catch {
      // Haptic not available
    }
  }, [status]);

  /**
   * Cancel the burn request.
   */
  const cancelBurn = useCallback(() => {
    if (status === 'confirming') {
      setStatus('idle');
      setError(null);
    }
  }, [status]);

  /**
   * Confirm and execute the burn.
   */
  const confirmBurn = useCallback(async () => {
    if (!isConnected) {
      handleError('NOT_CONNECTED');
      return;
    }

    if (!sessionId) {
      handleError('NO_SESSION');
      return;
    }

    setStatus('burning');
    setError(null);

    // Haptic feedback for destructive action
    try {
      WebApp.HapticFeedback.notificationOccurred('warning');
    } catch {
      // Haptic not available
    }

    // Send burn request to server
    publish(BURN_SESSION_DESTINATION, {
      sessionId,
    });

    // Note: status will be updated when we receive the BURN_SIGNAL event
    // or error response from the server
  }, [isConnected, sessionId, publish, handleError]);

  // ============================================
  // Handle BURN_SIGNAL (4.4.7)
  // ============================================

  /**
   * Handle incoming BURN_SIGNAL event.
   */
  const handleBurnSignal = useCallback((message: IMessage) => {
    try {
      const event: BurnSignalEvent = JSON.parse(message.body);

      // Ignore events for other sessions
      if (event.sessionId !== sessionId) {
        return;
      }

      if (!event.success) {
        // Burn failed
        const errorCode = mapServerError(event.error);
        handleError(errorCode);
        return;
      }

      // Burn successful
      const burnerId = event.burnedBy || 0;
      const wasSelf = burnerId === userId;

      setBurnedBy(burnerId);
      setStatus('burned');
      setError(null);

      cancelAll();
      // Destroy local cryptographic keys and cached files
      burnKeys(sessionId);
      clearDownloadCache();

      // Strong haptic feedback for burn
      try {
        WebApp.HapticFeedback.notificationOccurred('success');
        // Additional impact for dramatic effect
        setTimeout(() => {
          try {
            WebApp.HapticFeedback.impactOccurred('heavy');
          } catch {
            // Haptic not available
          }
        }, 100);
      } catch {
        // Haptic not available
      }

      console.log(`[useBurn] Session ${sessionId} burned by ${burnerId} (self: ${wasSelf})`);

      // Notify callback
      onBurned?.(burnerId, wasSelf);

    } catch (parseErr) {
      console.error('[useBurn] Failed to parse burn signal:', parseErr);
    }
  }, [sessionId, userId, onBurned, handleError]);

  // ============================================
  // Subscriptions
  // ============================================

  useEffect(() => {
    if (!isConnected || !sessionId) {
      return;
    }

    // Subscribe to burn signal events
    subscribe(BURN_SIGNAL_DESTINATION, handleBurnSignal);

    return () => {
      unsubscribe(BURN_SIGNAL_DESTINATION);
    };
  }, [isConnected, sessionId, subscribe, unsubscribe, handleBurnSignal]);

  // ============================================
  // Cleanup
  // ============================================

  useEffect(() => {
    // Reset state when session changes
    return () => {
      setStatus('idle');
      setError(null);
      setBurnedBy(null);
    };
  }, [sessionId]);

  return {
    status,
    isBurning: status === 'burning',
    isBurned: status === 'burned',
    burnedBy,
    wasSelfBurn: burnedBy === userId,
    requestBurn,
    confirmBurn,
    cancelBurn,
    error,
  };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Map server error to client error code.
 */
function mapServerError(serverError?: string): BurnErrorCode {
  if (!serverError) return 'INTERNAL_ERROR';

  const errorMap: Record<string, BurnErrorCode> = {
    'SESSION_NOT_FOUND': 'SESSION_NOT_FOUND',
    'NOT_PARTICIPANT': 'NOT_PARTICIPANT',
    'ALREADY_BURNED': 'ALREADY_BURNED',
    'INTERNAL_ERROR': 'INTERNAL_ERROR',
  };

  return errorMap[serverError] || 'INTERNAL_ERROR';
}
