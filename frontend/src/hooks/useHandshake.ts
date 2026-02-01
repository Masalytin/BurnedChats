import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { UserInfo } from '../types';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  computeSharedSecret,
  deriveAESKey,
  generateFingerprint,
  generateVisualFingerprint,
  storeKeyPair,
  storePeerPublicKey,
  storeSharedSecret,
  getKeyPair,
  getSessionKeys,
  hasSession,
  isHandshakeComplete,
  burn,
} from '../crypto';
import { logCryptoOperation } from '../components/DebugPanel';

// ============================================
// Constants
// ============================================

/** Destination for sending public key */
const HANDSHAKE_KEY_DESTINATION = '/app/handshake.key';

/** Destination for receiving peer's public key */
const PEER_KEY_DESTINATION = '/user/queue/peer-key';

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
  /** Start handshake for a session */
  startHandshake: (sessionId: string, peer: UserInfo) => void;
  /** Cancel/abort handshake */
  cancelHandshake: () => void;
  /** Reset state */
  reset: () => void;
  /** Whether handshake is in progress */
  isHandshaking: boolean;
  /** Whether handshake is complete */
  isComplete: boolean;
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

  const isSubscribedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  
  // Buffer for peer keys that arrive before handshake starts (race condition fix)
  const pendingPeerKeyRef = useRef<Map<string, ServerPeerPublicKeyEvent>>(new Map());

  /**
   * Update result with new stage and progress.
   */
  const updateStage = useCallback((
    stage: HandshakeStage,
    extra?: Partial<HandshakeResult>
  ) => {
    setResult((prev) => ({
      ...prev,
      stage,
      progress: STAGE_PROGRESS[stage],
      ...extra,
    }));
  }, []);

  /**
   * Handle error during handshake.
   */
  const handleError = useCallback((errorCode: HandshakeErrorCode, sessionId?: string) => {
    console.error('[useHandshake] Error:', errorCode);
    
    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Burn any keys that were generated
    if (sessionId) {
      const startTime = performance.now();
      burn(sessionId);
      logCryptoOperation('burn', sessionId, true, performance.now() - startTime);
      // Clear any buffered peer key for this session
      pendingPeerKeyRef.current.delete(sessionId);
    }

    setResult((prev) => ({
      ...prev,
      stage: 'error',
      error: errorCode,
      progress: 0,
    }));

    activeSessionRef.current = null;
    onError?.(errorCode);
  }, [onError]);

  /**
   * Complete the handshake after computing shared secret.
   */
  const completeHandshake = useCallback(async (
    sessionId: string,
    rawSharedSecret: ArrayBuffer
  ) => {
    try {
      // Derive AES key using HKDF
      console.log('[useHandshake] Deriving AES key...');
      let startTime = performance.now();
      const aesKey = await deriveAESKey(rawSharedSecret, sessionId);
      logCryptoOperation('deriveAESKey', sessionId, true, performance.now() - startTime);

      // Generate fingerprints
      console.log('[useHandshake] Generating fingerprints...');
      startTime = performance.now();
      const fingerprint = await generateFingerprint(rawSharedSecret);
      logCryptoOperation('generateFingerprint', sessionId, true, performance.now() - startTime);
      
      startTime = performance.now();
      const visualFingerprint = await generateVisualFingerprint(rawSharedSecret);
      logCryptoOperation('generateVisualFingerprint', sessionId, true, performance.now() - startTime);

      // Store shared secret
      storeSharedSecret(sessionId, { sessionId, key: aesKey, fingerprint, visualFingerprint }, rawSharedSecret);

      // Clear timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      console.log('[useHandshake] Handshake complete:', sessionId, 'fingerprint:', fingerprint);

      updateStage('complete', { fingerprint });
      activeSessionRef.current = null;
      onHandshakeComplete?.(sessionId, fingerprint);

    } catch (error) {
      console.error('[useHandshake] Failed to complete handshake:', error);
      logCryptoOperation('deriveAESKey', sessionId, false, 0, String(error));
      handleError('KEY_DERIVATION_FAILED', sessionId);
    }
  }, [updateStage, handleError, onHandshakeComplete]);

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
        pendingPeerKeyRef.current.set(sessionId, data);
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
  }, [processPeerKey, handleError]);

  /**
   * Register subscription to peer key events immediately.
   * This ensures the subscription is stored and restored after reconnect.
   * Similar pattern to useIncomingRequests for session-accepted.
   */
  useEffect(() => {
    // Register subscription immediately - it will be stored and applied on connect
    // This is critical for reconnect scenarios where peer-key may arrive after reconnect
    if (!isSubscribedRef.current) {
      subscribe(PEER_KEY_DESTINATION, handlePeerPublicKey);
      isSubscribedRef.current = true;
      console.log('[useHandshake] Registered subscription for peer key events');
    }

    return () => {
      if (isSubscribedRef.current) {
        unsubscribe(PEER_KEY_DESTINATION);
        isSubscribedRef.current = false;
        console.log('[useHandshake] Unsubscribed from peer key events');
      }
    };
  }, [subscribe, unsubscribe, handlePeerPublicKey]);

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

    onHandshakeComplete?.(sessionId, sessionKeys.sharedSecret.fingerprint);
    return true;
  }, [onHandshakeComplete]);

  /**
   * Start handshake process for a session.
   */
  const startHandshake = useCallback(async (sessionId: string, peer: UserInfo) => {
    if (!isConnected) {
      handleError('CONNECTION_ERROR');
      return;
    }

    // Check if already handshaking
    if (activeSessionRef.current) {
      console.warn('[useHandshake] Handshake already in progress');
      return;
    }

    // Task 4.6.9: Try to restore from existing keys first
    if (hasSession(sessionId)) {
      console.log('[useHandshake] Session already has keys, attempting to restore...');
      if (restoreFromKeyStore(sessionId, peer)) {
        console.log('[useHandshake] Session restored from keyStore successfully');
        return;
      }
      // Keys exist but handshake not complete - burn and start fresh
      console.log('[useHandshake] Partial keys found, starting fresh handshake...');
      const burnStart = performance.now();
      burn(sessionId);
      logCryptoOperation('burn', sessionId, true, performance.now() - burnStart);
    }

    console.log('[useHandshake] Starting handshake for session:', sessionId);

    activeSessionRef.current = sessionId;
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
      const bufferedPeerKey = pendingPeerKeyRef.current.get(sessionId);
      if (bufferedPeerKey) {
        console.log('[useHandshake] Found buffered peer key, processing immediately...');
        pendingPeerKeyRef.current.delete(sessionId);
        // Process the buffered peer key
        await processPeerKey(bufferedPeerKey);
      }

    } catch (error) {
      console.error('[useHandshake] Failed to start handshake:', error);
      logCryptoOperation('generateKeyPair', sessionId, false, 0, String(error));
      handleError('KEY_GENERATION_FAILED', sessionId);
    }
  }, [isConnected, timeout, publish, updateStage, handleError, restoreFromKeyStore, processPeerKey]);

  /**
   * Cancel/abort the current handshake.
   */
  const cancelHandshake = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (activeSessionRef.current) {
      const sessionId = activeSessionRef.current;
      const startTime = performance.now();
      burn(sessionId);
      logCryptoOperation('burn', sessionId, true, performance.now() - startTime);
      // Clear any buffered peer key for this session
      pendingPeerKeyRef.current.delete(sessionId);
      activeSessionRef.current = null;
    }

    setResult(initialResult);
    console.log('[useHandshake] Handshake cancelled');
  }, []);

  /**
   * Reset state.
   */
  const reset = useCallback(() => {
    cancelHandshake();
  }, [cancelHandshake]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    result,
    startHandshake,
    cancelHandshake,
    reset,
    isHandshaking: result.stage !== 'idle' && result.stage !== 'complete' && result.stage !== 'error',
    isComplete: result.stage === 'complete',
  };
}
