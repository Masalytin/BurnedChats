import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { UserInfo } from '../types';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  computeSharedSecret,
  deriveAESKey,
  storeKeyPair,
  storePeerPublicKey,
  storeSharedSecret,
  getKeyPair,
  getPeerPublicKey,
  getSessionKeys,
  hasSession,
  isHandshakeComplete,
  burn,
} from '../crypto';
import { generateFingerprints } from '../crypto/ecdh';
import { logCryptoOperation } from '../components/DebugPanel';

// ============================================
// Constants
// ============================================

/** Destination for sending public key */
const HANDSHAKE_KEY_DESTINATION = '/app/handshake.key';

/** Destination for receiving peer's public key */
const PEER_KEY_DESTINATION = '/user/queue/peer-key';

/** Destination for receiving key refresh notifications (peer needs re-handshake) */
const HANDSHAKE_REFRESH_DESTINATION = '/user/queue/handshake-refresh';

// ============================================
// Types
// ============================================

/** Handshake progress stages */
export type HandshakeStage =
  | 'idle'                // Not started
  | 'generating_keys'     // Generating ECDH key pair
  | 'sending_key'         // Sending public key to server
  | 'waiting_peer'        // Waiting for peer's public key
  | 'computing_secret'    // Computing shared secret
  | 'complete'            // Handshake complete
  | 'error';              // Handshake failed

/** Handshake error codes */
export type HandshakeErrorCode =
  | 'KEY_GENERATION_FAILED'   // Failed to generate key pair
  | 'KEY_EXPORT_FAILED'       // Failed to export public key
  | 'KEY_SEND_FAILED'         // Failed to send key to server
  | 'PEER_KEY_INVALID'        // Peer's public key is invalid
  | 'KEY_IMPORT_FAILED'       // Failed to import peer's key
  | 'SECRET_COMPUTE_FAILED'   // Failed to compute shared secret
  | 'KEY_DERIVATION_FAILED'   // Failed to derive AES key
  | 'SESSION_NOT_FOUND'       // Session doesn't exist
  | 'NOT_PARTICIPANT'         // User is not a session participant
  | 'INVALID_STATUS'          // Session is not in handshake status
  | 'TIMEOUT'                 // Handshake timeout
  | 'CONNECTION_ERROR';       // WebSocket not connected

/** Handshake result state */
export interface HandshakeResult {
  stage: HandshakeStage;
  sessionId: string | null;
  peer: UserInfo | null;
  fingerprint: string | null;
  error: HandshakeErrorCode | null;
  progress: number; // 0-100
  /** Elapsed time in the current stage (ms); primarily updated during waiting_peer */
  elapsedMs?: number;
  /** True when waiting_peer exceeds SOFT_TIMEOUT — UI hint only, not a hard timeout */
  isTakingLonger?: boolean;
}

/** Server peer public key event */
interface ServerPeerPublicKeyEvent {
  success: boolean;
  sessionId: string;
  peerId?: number;
  publicKey?: string;
  timestamp?: string;
  error?: string;
}

/** Buffered peer key with insertion timestamp for TTL/size bounds */
interface PendingPeerKeyEntry {
  data: ServerPeerPublicKeyEvent;
  ts: number;
}

interface UseHandshakeOptions {
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Subscribe to a STOMP destination */
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  /** Unsubscribe from a STOMP destination */
  unsubscribe: (destination: string) => void;
  /** Publish message to STOMP destination */
  publish: (destination: string, body: unknown) => void;
  /** Callback when handshake completes */
  onHandshakeComplete?: (sessionId: string, fingerprint: string) => void;
  /** Callback when error occurs */
  onError?: (error: HandshakeErrorCode) => void;
  /** Handshake timeout in milliseconds (default: 30000) */
  timeout?: number;
}

interface UseHandshakeReturn {
  /** Current handshake result */
  result: HandshakeResult;
  /** Start handshake for a session. Pass forceRefresh=true to skip key restoration and force a fresh handshake. */
  startHandshake: (sessionId: string, peer: UserInfo, forceRefresh?: boolean) => void;
  /** Cancel/abort handshake */
  cancelHandshake: () => void;
  /** Reset state */
  reset: () => void;
  /** Whether handshake is in progress */
  isHandshaking: boolean;
  /** Whether handshake is complete */
  isComplete: boolean;
  /** Session ID that needs key refresh (set when peer requests re-handshake for ACTIVE session) */
  keyRefreshSessionId: string | null;
  /** Clear the key refresh request after handling it */
  clearKeyRefresh: () => void;
}

/** Initial result state */
const initialResult: HandshakeResult = {
  stage: 'idle',
  sessionId: null,
  peer: null,
  fingerprint: null,
  error: null,
  progress: 0,
};

/** Default handshake timeout (30 seconds) */
const DEFAULT_TIMEOUT = 30000;

/** Maximum manual in-place retries before user must start over */
export const MAX_HANDSHAKE_MANUAL_RETRIES = 5;

/** Base cooldown between manual retries (exponential backoff multiplier) */
export const HANDSHAKE_RETRY_BASE_COOLDOWN_MS = 2000;

/** Soft threshold for waiting_peer — UI "taking longer than usual" hint (ms) */
export const SOFT_TIMEOUT = 9000;

/** Interval for updating elapsedMs / isTakingLonger during waiting_peer */
const WAITING_PEER_TICK_MS = 500;

/** Max buffered peer keys for sessions without an active handshake yet */
const MAX_PENDING_PEER_KEYS = 8;

/** TTL for buffered peer keys before eviction (ms) */
const PENDING_PEER_KEY_TTL_MS = 60_000;

/** Progress values for each stage */
const STAGE_PROGRESS: Record<HandshakeStage, number> = {
  idle: 0,
  generating_keys: 15,
  sending_key: 30,
  waiting_peer: 50,
  computing_secret: 75,
  complete: 100,
  error: 0,
};

/**
 * Hook for managing ECDH key exchange (handshake) via STOMP WebSocket.
 *
 * Handles the complete handshake flow:
 * 1. Generate ECDH P-256 key pair
 * 2. Send public key to server
 * 3. Receive peer's public key
 * 4. Compute shared secret
 * 5. Derive AES-GCM key
 * 6. Generate visual fingerprint
 *
 * @example
 * ```tsx
 * function HandshakeComponent() {
 *   const { isConnected, subscribe, unsubscribe, publish } = useWebSocket({ autoConnect: true });
 *
 *   const {
 *     result,
 *     startHandshake,
 *     cancelHandshake,
 *     isHandshaking,
 *     isComplete
 *   } = useHandshake({
 *     isConnected,
 *     subscribe,
 *     unsubscribe,
 *     publish,
 *     onHandshakeComplete: (sessionId, fingerprint) => {
 *       console.log('Handshake complete:', sessionId, fingerprint);
 *     },
 *   });
 *
 *   // Start handshake when session is accepted
 *   useEffect(() => {
 *     if (sessionAccepted) {
 *       startHandshake(sessionId, peer);
 *     }
 *   }, [sessionAccepted]);
 *
 *   return (
 *     <div>
 *       <p>Stage: {result.stage}</p>
 *       <p>Progress: {result.progress}%</p>
 *       {isComplete && <p>Fingerprint: {result.fingerprint}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useHandshake({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onHandshakeComplete,
  onError,
  timeout = DEFAULT_TIMEOUT,
}: UseHandshakeOptions): UseHandshakeReturn {
  const [result, setResult] = useState<HandshakeResult>(initialResult);
  const [keyRefreshSessionId, setKeyRefreshSessionId] = useState<string | null>(null);

  const isSubscribedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingPeerTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const currentStageRef = useRef<HandshakeStage>('idle');
  const stageStartRef = useRef<number>(0);
  
  /** Buffered peer key with insertion timestamp for TTL/size bounds */
  const pendingPeerKeyRef = useRef<Map<string, PendingPeerKeyEntry>>(new Map());

  /**
   * Evict expired entries, then drop oldest until size is below MAX_PENDING_PEER_KEYS.
   */
  const prunePendingPeerKeys = useCallback((): void => {
    const map = pendingPeerKeyRef.current;
    const now = Date.now();

    for (const [sessionId, entry] of map) {
      if (now - entry.ts > PENDING_PEER_KEY_TTL_MS) {
        map.delete(sessionId);
      }
    }

    while (map.size >= MAX_PENDING_PEER_KEYS) {
      let oldestSessionId: string | null = null;
      let oldestTs = Infinity;

      for (const [sessionId, entry] of map) {
        if (entry.ts < oldestTs) {
          oldestTs = entry.ts;
          oldestSessionId = sessionId;
        }
      }

      if (oldestSessionId === null) {
        break;
      }
      map.delete(oldestSessionId);
    }
  }, []);

  // Callback refs for stable handlers (prevents subscription churn on every render)
  const onHandshakeCompleteRef = useRef(onHandshakeComplete);
  const onErrorRef = useRef(onError);

  // Keep refs up to date
  useEffect(() => {
    onHandshakeCompleteRef.current = onHandshakeComplete;
    onErrorRef.current = onError;
  });

  /**
   * Stop waiting_peer elapsed timer.
   */
  const clearWaitingPeerTick = useCallback(() => {
    if (waitingPeerTickRef.current) {
      clearInterval(waitingPeerTickRef.current);
      waitingPeerTickRef.current = null;
    }
  }, []);

  /**
   * Clear handshake timers without touching session state.
   */
  const clearHandshakeTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    clearWaitingPeerTick();
  }, [clearWaitingPeerTick]);

  /**
   * Log duration of a handshake stage to DebugPanel (timings only, no key material).
   */
  const logStageDuration = useCallback((
    stage: HandshakeStage,
    sessionId: string,
    success = true
  ) => {
    if (stageStartRef.current <= 0) {
      return;
    }
    const durationMs = Math.round(performance.now() - stageStartRef.current);
    logCryptoOperation(`handshakeStage:${stage}`, sessionId, success, durationMs);
  }, []);

  /**
   * Start periodic elapsedMs / isTakingLonger updates while in waiting_peer.
   */
  const startWaitingPeerTick = useCallback((sessionId: string) => {
    clearWaitingPeerTick();
    stageStartRef.current = performance.now();

    waitingPeerTickRef.current = setInterval(() => {
      if (activeSessionRef.current !== sessionId) {
        return;
      }
      const elapsedMs = Math.round(performance.now() - stageStartRef.current);
      const isTakingLonger = elapsedMs >= SOFT_TIMEOUT;
      setResult((prev) =>
        prev.stage === 'waiting_peer' && prev.sessionId === sessionId
          ? { ...prev, elapsedMs, isTakingLonger }
          : prev
      );
    }, WAITING_PEER_TICK_MS);
  }, [clearWaitingPeerTick]);

  /**
   * Update result with new stage and progress.
   */
  const updateStage = useCallback((
    stage: HandshakeStage,
    extra?: Partial<HandshakeResult>
  ) => {
    const sessionId = activeSessionRef.current;
    const prevStage = currentStageRef.current;

    if (sessionId && prevStage !== stage && prevStage !== 'idle') {
      logStageDuration(prevStage, sessionId);
    }

    if (prevStage === 'waiting_peer' && stage !== 'waiting_peer') {
      clearWaitingPeerTick();
    }

    currentStageRef.current = stage;
    stageStartRef.current = performance.now();

    if (stage === 'waiting_peer' && sessionId) {
      startWaitingPeerTick(sessionId);
    }

    setResult((prev) => ({
      ...prev,
      stage,
      progress: STAGE_PROGRESS[stage],
      ...(stage === 'waiting_peer'
        ? { elapsedMs: 0, isTakingLonger: false }
        : stage !== prevStage
          ? { elapsedMs: undefined, isTakingLonger: undefined }
          : {}),
      ...extra,
    }));
  }, [logStageDuration, clearWaitingPeerTick, startWaitingPeerTick]);

  /**
   * Handle error during handshake.
   */
  const handleError = useCallback((errorCode: HandshakeErrorCode, sessionId?: string) => {
    console.error('[useHandshake] Error:', errorCode);

    const resolvedSessionId = sessionId ?? activeSessionRef.current;
    if (resolvedSessionId && currentStageRef.current !== 'idle') {
      logStageDuration(currentStageRef.current, resolvedSessionId, false);
    }
    clearHandshakeTimers();
    
    // Burn any keys that were generated
    if (sessionId) {
      const startTime = performance.now();
      burn(sessionId);
      logCryptoOperation('burn', sessionId, true, performance.now() - startTime);
      // Clear any buffered peer key for this session
      pendingPeerKeyRef.current.delete(sessionId);
    }

    currentStageRef.current = 'error';
    stageStartRef.current = 0;

    setResult((prev) => ({
      ...prev,
      stage: 'error',
      error: errorCode,
      progress: 0,
      elapsedMs: undefined,
      isTakingLonger: undefined,
    }));

    activeSessionRef.current = null;
    onErrorRef.current?.(errorCode);
  }, [logStageDuration, clearHandshakeTimers]);

  /**
   * Complete the handshake after computing shared secret.
   */
  const completeHandshake = useCallback(async (
    sessionId: string,
    rawSharedSecret: ArrayBuffer
  ) => {
    try {
      const keyPair = getKeyPair(sessionId);
      const peerPublicKey = getPeerPublicKey(sessionId);
      if (!keyPair || !peerPublicKey) {
        handleError('SESSION_NOT_FOUND', sessionId);
        return;
      }

      // Derive AES key and fingerprints in parallel (independent operations)
      console.log('[useHandshake] Deriving AES key and fingerprints...');
      const startTime = performance.now();
      const [aesKey, { fingerprint, visualFingerprint }] = await Promise.all([
        deriveAESKey(rawSharedSecret, sessionId),
        generateFingerprints(keyPair.publicKey, peerPublicKey),
      ]);
      logCryptoOperation('completeHandshake', sessionId, true, performance.now() - startTime);

      // Store shared secret after both derivations succeed
      storeSharedSecret(sessionId, { sessionId, key: aesKey, fingerprint, visualFingerprint }, rawSharedSecret);

      // Clear timeout
      clearHandshakeTimers();

      updateStage('complete', { fingerprint });
      activeSessionRef.current = null;
      onHandshakeCompleteRef.current?.(sessionId, fingerprint);

    } catch (error) {
      console.error('[useHandshake] Failed to complete handshake:', error);
      logCryptoOperation('completeHandshake', sessionId, false, 0, String(error));
      handleError('KEY_DERIVATION_FAILED', sessionId);
    }
  }, [updateStage, handleError, clearHandshakeTimers]);

  /**
   * Process a peer public key event (either fresh or from buffer).
   */
  const processPeerKey = useCallback(async (data: ServerPeerPublicKeyEvent) => {
    const sessionId = data.sessionId;

    console.log('[useHandshake] Processing peer key for session:', sessionId);

    // Handle error response
    if (!data.success && data.error) {
      handleError(data.error as HandshakeErrorCode, sessionId);
      return;
    }

    // Validate public key
    if (!data.publicKey) {
      handleError('PEER_KEY_INVALID', sessionId);
      return;
    }

    updateStage('computing_secret');

    // Import peer's public key
    console.log('[useHandshake] Importing peer public key...');
    let peerPublicKey: CryptoKey;
    let startTime = performance.now();
    try {
      peerPublicKey = await importPublicKey(data.publicKey);
      logCryptoOperation('importPublicKey', sessionId, true, performance.now() - startTime);
    } catch (error) {
      logCryptoOperation('importPublicKey', sessionId, false, performance.now() - startTime, String(error));
      console.error('[useHandshake] Failed to import peer key:', error);
      handleError('KEY_IMPORT_FAILED', sessionId);
      return;
    }

    // Store peer's public key
    storePeerPublicKey(sessionId, peerPublicKey);

    // Get our private key
    const keyPair = getKeyPair(sessionId);
    if (!keyPair) {
      handleError('SESSION_NOT_FOUND', sessionId);
      return;
    }

    // Compute shared secret
    console.log('[useHandshake] Computing shared secret...');
    let rawSharedSecret: ArrayBuffer;
    startTime = performance.now();
    try {
      rawSharedSecret = await computeSharedSecret(keyPair.privateKey, peerPublicKey);
      logCryptoOperation('computeSharedSecret', sessionId, true, performance.now() - startTime);
    } catch (error) {
      logCryptoOperation('computeSharedSecret', sessionId, false, performance.now() - startTime, String(error));
      console.error('[useHandshake] Failed to compute shared secret:', error);
      handleError('SECRET_COMPUTE_FAILED', sessionId);
      return;
    }

    // Complete the handshake
    await completeHandshake(sessionId, rawSharedSecret);
  }, [updateStage, handleError, completeHandshake]);

  /**
   * Handle peer's public key event from server.
   */
  const handlePeerPublicKey = useCallback(async (message: IMessage) => {
    try {
      const data: ServerPeerPublicKeyEvent = JSON.parse(message.body);
      const sessionId = data.sessionId;

      console.log('[useHandshake] Received peer key event:', data);

      // Check if this is for our active handshake
      if (activeSessionRef.current !== sessionId) {
        // Buffer the peer key for later - it may have arrived before startHandshake was called
        // This fixes a race condition where peer-key arrives before session-accepted
        console.log('[useHandshake] Buffering peer key for session (handshake not yet started):', sessionId);
        prunePendingPeerKeys();
        pendingPeerKeyRef.current.set(sessionId, { data, ts: Date.now() });
        return;
      }

      // Process the peer key
      await processPeerKey(data);

    } catch (error) {
      console.error('[useHandshake] Failed to handle peer key event:', error);
      if (activeSessionRef.current) {
        handleError('CONNECTION_ERROR', activeSessionRef.current);
      }
    }
  }, [processPeerKey, handleError, prunePendingPeerKeys]);

  /**
   * Handle key refresh notification from server.
   * Sent when the peer submits a new key for an ACTIVE session (e.g., after reconnecting).
   * We need to also generate and submit our key to complete the key refresh.
   */
  const handleKeyRefresh = useCallback((message: IMessage) => {
    try {
      const data = JSON.parse(message.body);
      if (data.sessionId && data.type === 'KEY_REFRESH_NEEDED') {
        console.log('[useHandshake] Key refresh requested for session:', data.sessionId);
        // Don't auto-start if we're already handshaking for this session
        if (activeSessionRef.current === data.sessionId) {
          console.log('[useHandshake] Already handshaking for this session, ignoring refresh');
          return;
        }
        setKeyRefreshSessionId(data.sessionId);
      }
    } catch (error) {
      console.error('[useHandshake] Failed to handle key refresh notification:', error);
    }
  }, []);

  /**
   * Clear the key refresh request after handling it.
   */
  const clearKeyRefresh = useCallback(() => {
    setKeyRefreshSessionId(null);
  }, []);

  /**
   * Register subscription to peer key events and key refresh notifications immediately.
   * This ensures the subscription is stored and restored after reconnect.
   * Similar pattern to useIncomingRequests for session-accepted.
   */
  useEffect(() => {
    // Register subscription immediately - it will be stored and applied on connect
    // This is critical for reconnect scenarios where peer-key may arrive after reconnect
    if (!isSubscribedRef.current) {
      subscribe(PEER_KEY_DESTINATION, handlePeerPublicKey);
      subscribe(HANDSHAKE_REFRESH_DESTINATION, handleKeyRefresh);
      isSubscribedRef.current = true;
      console.log('[useHandshake] Registered subscriptions for peer key and refresh events');
    }

    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(PEER_KEY_DESTINATION);
        unsubscribe(HANDSHAKE_REFRESH_DESTINATION);
        isSubscribedRef.current = false;
        console.log('[useHandshake] Unsubscribed from peer key and refresh events');
      }
    };
  }, [subscribe, unsubscribe, handlePeerPublicKey, handleKeyRefresh]);

  /**
   * Restore session from existing keys in keyStore (4.6.9).
   * Returns true if restoration was successful, false if fresh handshake is needed.
   */
  const restoreFromKeyStore = useCallback((sessionId: string, peer: UserInfo): boolean => {
    // Check if we have a completed handshake for this session
    if (!isHandshakeComplete(sessionId)) {
      return false;
    }

    const sessionKeys = getSessionKeys(sessionId);
    if (!sessionKeys?.sharedSecret?.fingerprint) {
      return false;
    }

    console.log('[useHandshake] Restoring session from keyStore:', sessionId);

    // Session is already complete - restore the state
    setResult({
      stage: 'complete',
      sessionId,
      peer,
      fingerprint: sessionKeys.sharedSecret.fingerprint,
      error: null,
      progress: 100,
    });

    onHandshakeCompleteRef.current?.(sessionId, sessionKeys.sharedSecret.fingerprint);
    return true;
  }, []);

  /**
   * Start handshake process for a session.
   * @param sessionId - The session to handshake for
   * @param peer - The peer user info
   * @param forceRefresh - If true, skip key restoration and force a fresh handshake (used for key refresh on ACTIVE sessions)
   */
  const startHandshake = useCallback(async (sessionId: string, peer: UserInfo, forceRefresh?: boolean) => {
    if (!isConnected) {
      handleError('CONNECTION_ERROR');
      return;
    }

    // Defensive cleanup before any (re)start — clears stale timers/buffers from error or race
    clearHandshakeTimers();
    pendingPeerKeyRef.current.delete(sessionId);

    // Allow forceRefresh restart for the same session (auto-resume / in-place retry)
    if (activeSessionRef.current) {
      if (forceRefresh && activeSessionRef.current === sessionId) {
        clearHandshakeTimers();
        pendingPeerKeyRef.current.delete(sessionId);
        if (currentStageRef.current !== 'idle') {
          logStageDuration(currentStageRef.current, sessionId, false);
        }
        activeSessionRef.current = null;
        currentStageRef.current = 'idle';
        stageStartRef.current = 0;
      } else {
        console.warn('[useHandshake] Handshake already in progress');
        return;
      }
    }

    // Task 4.6.9: Try to restore from existing keys first (skip if forcing refresh)
    if (hasSession(sessionId)) {
      if (!forceRefresh) {
        console.log('[useHandshake] Session already has keys, attempting to restore...');
        if (restoreFromKeyStore(sessionId, peer)) {
          console.log('[useHandshake] Session restored from keyStore successfully');
          return;
        }
      }
      // Keys exist but handshake not complete (or force refresh) - burn and start fresh
      console.log('[useHandshake] %s, starting fresh handshake...', 
        forceRefresh ? 'Force refresh requested' : 'Partial keys found');
      const burnStart = performance.now();
      burn(sessionId);
      logCryptoOperation('burn', sessionId, true, performance.now() - burnStart);
    }

    console.log('[useHandshake] Starting handshake for session:', sessionId);

    activeSessionRef.current = sessionId;
    currentStageRef.current = 'generating_keys';
    stageStartRef.current = performance.now();
    setResult({
      stage: 'generating_keys',
      sessionId,
      peer,
      fingerprint: null,
      error: null,
      progress: STAGE_PROGRESS.generating_keys,
    });

    // Set timeout
    timeoutRef.current = setTimeout(() => {
      if (activeSessionRef.current === sessionId) {
        handleError('TIMEOUT', sessionId);
      }
    }, timeout);

    try {
      // Step 1: Generate ECDH key pair
      console.log('[useHandshake] Generating key pair...');
      let startTime = performance.now();
      const keyPair = await generateKeyPair();
      logCryptoOperation('generateKeyPair', sessionId, true, performance.now() - startTime);
      storeKeyPair(sessionId, keyPair);

      updateStage('sending_key');

      // Step 2: Export and send public key
      console.log('[useHandshake] Exporting public key...');
      startTime = performance.now();
      const publicKeyBase64 = await exportPublicKey(keyPair.publicKey);
      logCryptoOperation('exportPublicKey', sessionId, true, performance.now() - startTime);

      console.log('[useHandshake] Sending public key to server...');
      publish(HANDSHAKE_KEY_DESTINATION, {
        sessionId,
        publicKey: publicKeyBase64,
      });

      updateStage('waiting_peer');
      console.log('[useHandshake] Waiting for peer public key...');

      // Check if we have a buffered peer key (race condition: peer-key arrived before startHandshake)
      prunePendingPeerKeys();
      const bufferedPeerKey = pendingPeerKeyRef.current.get(sessionId);
      if (bufferedPeerKey) {
        console.log('[useHandshake] Found buffered peer key, processing immediately...');
        pendingPeerKeyRef.current.delete(sessionId);
        await processPeerKey(bufferedPeerKey.data);
      }

    } catch (error) {
      console.error('[useHandshake] Failed to start handshake:', error);
      logCryptoOperation('generateKeyPair', sessionId, false, 0, String(error));
      handleError('KEY_GENERATION_FAILED', sessionId);
    }
  }, [isConnected, timeout, publish, updateStage, handleError, restoreFromKeyStore, processPeerKey, clearHandshakeTimers, logStageDuration, prunePendingPeerKeys]);

  /**
   * Cancel/abort the current handshake.
   */
  const cancelHandshake = useCallback(() => {
    clearHandshakeTimers();

    if (activeSessionRef.current) {
      const sessionId = activeSessionRef.current;
      if (currentStageRef.current !== 'idle') {
        logStageDuration(currentStageRef.current, sessionId, false);
      }
      const startTime = performance.now();
      burn(sessionId);
      logCryptoOperation('burn', sessionId, true, performance.now() - startTime);
      // Clear any buffered peer key for this session
      pendingPeerKeyRef.current.delete(sessionId);
      activeSessionRef.current = null;
    }

    currentStageRef.current = 'idle';
    stageStartRef.current = 0;
    setResult(initialResult);
    console.log('[useHandshake] Handshake cancelled');
  }, [clearHandshakeTimers, clearWaitingPeerTick, logStageDuration]);

  /**
   * Reset state (idempotent). Safe to call from error stage before forceRefresh retry.
   */
  const reset = useCallback(() => {
    cancelHandshake();
  }, [cancelHandshake]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearHandshakeTimers();
    };
  }, [clearHandshakeTimers]);

  return {
    result,
    startHandshake,
    cancelHandshake,
    reset,
    isHandshaking: result.stage !== 'idle' && result.stage !== 'complete' && result.stage !== 'error',
    isComplete: result.stage === 'complete',
    keyRefreshSessionId,
    clearKeyRefresh,
  };
}
