/**
 * Centralized debug state hook for Debug Panel.
 * Aggregates state from WebSocket, Session, Handshake, and Crypto modules.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { HandshakeResult } from '@/hooks/useHandshake';
import type { CreateSessionResult } from '@/hooks/useSession';
import type { VisualFingerprintElement } from '@/types';
import {
  getActiveSessionIds,
  getSessionKeys,
  addKeyStoreListener,
  isHandshakeComplete,
} from '@/crypto/keyStore';

// ============================================
// Types
// ============================================

/** WebSocket debug state */
export interface WebSocketDebugState {
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  reconnectAttempt: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  connectionDuration: number;
  activeSubscriptions: string[];
  storedSubscriptions: string[];
  messagesSent: number;
  messagesReceived: number;
  error: { type: string; message: string; recoverable: boolean } | null;
}

/** Session flow stage */
export type SessionFlowStage = 
  | 'none' 
  | 'searching' 
  | 'creating' 
  | 'pending' 
  | 'incoming' 
  | 'handshaking' 
  | 'active';

/** Session flow debug state */
export interface SessionFlowState {
  currentFlow: SessionFlowStage;
  sessionId: string | null;
  peerId: number | null;
  peerName: string | null;
  handshakeStage: string | null;
  handshakeProgress: number;
  hasLocalKeys: boolean;
  hasPeerKey: boolean;
  hasSharedSecret: boolean;
  lastError: string | null;
  errorTimestamp: number | null;
}

/** Crypto debug state for a single session */
export interface CryptoSessionDebugState {
  sessionId: string;
  hasKeyPair: boolean;
  hasPeerPublicKey: boolean;
  hasSharedSecret: boolean;
  hasAESKey: boolean;
  fingerprint: string | null;
  visualFingerprint?: VisualFingerprintElement[];
  createdAt: number;
}

/** Crypto operations log entry */
export interface CryptoOperationEntry {
  timestamp: number;
  operation: string;
  sessionId: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

/** Full crypto debug state */
export interface CryptoDebugState {
  sessions: CryptoSessionDebugState[];
  operations: CryptoOperationEntry[];
}

/** Timeline event for session flow */
export interface TimelineEvent {
  id: number;
  timestamp: number;
  label: string;
  status: 'complete' | 'current' | 'pending' | 'error';
  details?: string;
}

/** Full debug state */
export interface DebugState {
  websocket: WebSocketDebugState;
  sessionFlow: SessionFlowState;
  crypto: CryptoDebugState;
  timeline: TimelineEvent[];
}

// ============================================
// Global Message Counters
// ============================================

let globalMessagesSent = 0;
let globalMessagesReceived = 0;
const messageListeners = new Set<() => void>();

export function incrementMessagesSent(): void {
  globalMessagesSent++;
  messageListeners.forEach(fn => fn());
}

export function incrementMessagesReceived(): void {
  globalMessagesReceived++;
  messageListeners.forEach(fn => fn());
}

export function resetMessageCounters(): void {
  globalMessagesSent = 0;
  globalMessagesReceived = 0;
  messageListeners.forEach(fn => fn());
}

// ============================================
// Crypto Operations Logger
// ============================================

let cryptoOperations: CryptoOperationEntry[] = [];
const cryptoListeners = new Set<() => void>();
const MAX_CRYPTO_OPERATIONS = 50;

export function logCryptoOperation(
  operation: string,
  sessionId: string,
  success: boolean,
  durationMs: number,
  error?: string
): void {
  const entry: CryptoOperationEntry = {
    timestamp: Date.now(),
    operation,
    sessionId,
    success,
    durationMs,
    error,
  };
  
  cryptoOperations = [...cryptoOperations.slice(-(MAX_CRYPTO_OPERATIONS - 1)), entry];
  cryptoListeners.forEach(fn => fn());
}

export function clearCryptoOperations(): void {
  cryptoOperations = [];
  cryptoListeners.forEach(fn => fn());
}

// ============================================
// Hook Options
// ============================================

interface UseDebugStateOptions {
  isConnected: boolean;
  isConnecting: boolean;
  reconnectAttempt: number;
  wsError: { type: string; message: string; recoverable: boolean } | null;
  activeSubscriptions?: string[];
  storedSubscriptions?: string[];
  sessionResult?: CreateSessionResult;
  handshakeResult?: HandshakeResult;
}

// ============================================
// Hook Implementation
// ============================================

export function useDebugState({
  isConnected,
  isConnecting,
  reconnectAttempt,
  wsError,
  activeSubscriptions = [],
  storedSubscriptions = [],
  sessionResult,
  handshakeResult,
}: UseDebugStateOptions): DebugState {
  // WebSocket state
  const [connectionTimestamps, setConnectionTimestamps] = useState({
    lastConnectedAt: null as number | null,
    lastDisconnectedAt: null as number | null,
  });
  
  // Message counters
  const [messageCounters, setMessageCounters] = useState({
    sent: globalMessagesSent,
    received: globalMessagesReceived,
  });

  // Crypto operations
  const [operations, setOperations] = useState<CryptoOperationEntry[]>(cryptoOperations);

  // Crypto sessions
  const [cryptoSessions, setCryptoSessions] = useState<CryptoSessionDebugState[]>([]);

  // Timeline events
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const timelineIdRef = { current: 0 };

  // Track connection state changes
  useEffect(() => {
    if (isConnected) {
      setConnectionTimestamps(prev => ({
        ...prev,
        lastConnectedAt: Date.now(),
      }));
    } else if (!isConnecting && connectionTimestamps.lastConnectedAt) {
      setConnectionTimestamps(prev => ({
        ...prev,
        lastDisconnectedAt: Date.now(),
      }));
    }
  }, [isConnected, isConnecting, connectionTimestamps.lastConnectedAt]);

  // Subscribe to message counter updates
  useEffect(() => {
    const updateCounters = () => {
      setMessageCounters({
        sent: globalMessagesSent,
        received: globalMessagesReceived,
      });
    };
    messageListeners.add(updateCounters);
    return () => { messageListeners.delete(updateCounters); };
  }, []);

  // Subscribe to crypto operations updates
  useEffect(() => {
    const updateOperations = () => {
      setOperations([...cryptoOperations]);
    };
    cryptoListeners.add(updateOperations);
    return () => { cryptoListeners.delete(updateOperations); };
  }, []);

  // Subscribe to keyStore updates
  useEffect(() => {
    const updateCryptoSessions = () => {
      const sessionIds = getActiveSessionIds();
      const sessions: CryptoSessionDebugState[] = sessionIds.map(sessionId => {
        const keys = getSessionKeys(sessionId);
        return {
          sessionId,
          hasKeyPair: Boolean(keys?.keyPair),
          hasPeerPublicKey: Boolean(keys?.peerPublicKey),
          hasSharedSecret: Boolean(keys?.sharedSecret),
          hasAESKey: Boolean(keys?.sharedSecret?.key),
          fingerprint: keys?.sharedSecret?.fingerprint || null,
          visualFingerprint: keys?.sharedSecret?.visualFingerprint,
          createdAt: keys?.createdAt || Date.now(),
        };
      });
      setCryptoSessions(sessions);
    };

    // Initial load
    updateCryptoSessions();

    // Subscribe to changes
    const unsubscribe = addKeyStoreListener(() => {
      updateCryptoSessions();
    });

    return unsubscribe;
  }, []);

  // Add timeline event
  const addTimelineEvent = useCallback((label: string, status: TimelineEvent['status'], details?: string) => {
    setTimeline(prev => [
      ...prev,
      {
        id: ++timelineIdRef.current,
        timestamp: Date.now(),
        label,
        status,
        details,
      },
    ].slice(-20)); // Keep last 20 events
  }, []);

  // Track session flow changes
  useEffect(() => {
    if (sessionResult?.status === 'creating') {
      addTimelineEvent('Creating session...', 'current');
    } else if (sessionResult?.status === 'created' && sessionResult.session) {
      addTimelineEvent(
        `Session created`,
        'complete',
        `Peer: ${sessionResult.session.recipient.displayName}`
      );
    } else if (sessionResult?.status === 'error' && sessionResult.error) {
      addTimelineEvent(`Session error: ${sessionResult.error}`, 'error');
    }
  }, [sessionResult?.status, sessionResult?.session, sessionResult?.error, addTimelineEvent]);

  // Track handshake changes
  useEffect(() => {
    if (!handshakeResult) return;
    
    const { stage, peer } = handshakeResult;
    
    switch (stage) {
      case 'generating_keys':
        addTimelineEvent('Generating keys...', 'current');
        break;
      case 'sending_key':
        addTimelineEvent('Sending public key...', 'current');
        break;
      case 'waiting_peer':
        addTimelineEvent('Waiting for peer key...', 'current', peer?.displayName);
        break;
      case 'computing_secret':
        addTimelineEvent('Computing shared secret...', 'current');
        break;
      case 'complete':
        addTimelineEvent('Handshake complete', 'complete', `Fingerprint: ${handshakeResult.fingerprint?.slice(0, 8)}...`);
        break;
      case 'error':
        addTimelineEvent(`Handshake error: ${handshakeResult.error}`, 'error');
        break;
    }
  }, [handshakeResult?.stage, handshakeResult?.peer, handshakeResult?.fingerprint, handshakeResult?.error, addTimelineEvent]);

  // Compute WebSocket state
  const websocketState: WebSocketDebugState = useMemo(() => {
    let status: WebSocketDebugState['status'] = 'disconnected';
    if (isConnected) {
      status = 'connected';
    } else if (isConnecting) {
      status = reconnectAttempt > 0 ? 'reconnecting' : 'connecting';
    }

    const connectionDuration = connectionTimestamps.lastConnectedAt && isConnected
      ? Date.now() - connectionTimestamps.lastConnectedAt
      : 0;

    return {
      status,
      reconnectAttempt,
      lastConnectedAt: connectionTimestamps.lastConnectedAt,
      lastDisconnectedAt: connectionTimestamps.lastDisconnectedAt,
      connectionDuration,
      activeSubscriptions,
      storedSubscriptions,
      messagesSent: messageCounters.sent,
      messagesReceived: messageCounters.received,
      error: wsError,
    };
  }, [
    isConnected,
    isConnecting,
    reconnectAttempt,
    connectionTimestamps,
    activeSubscriptions,
    storedSubscriptions,
    messageCounters,
    wsError,
  ]);

  // Compute session flow state
  const sessionFlowState: SessionFlowState = useMemo(() => {
    let currentFlow: SessionFlowStage = 'none';
    let sessionId: string | null = null;
    let peerId: number | null = null;
    let peerName: string | null = null;
    let lastError: string | null = null;
    let errorTimestamp: number | null = null;

    // Determine flow from session result
    if (sessionResult) {
      if (sessionResult.status === 'creating') {
        currentFlow = 'creating';
      } else if (sessionResult.status === 'created' && sessionResult.session) {
        sessionId = sessionResult.session.id;
        peerId = sessionResult.session.recipient.id;
        peerName = sessionResult.session.recipient.displayName;
        currentFlow = 'pending';
      } else if (sessionResult.status === 'error') {
        lastError = sessionResult.error || 'Unknown error';
        errorTimestamp = Date.now();
      }
    }

    // Override with handshake state if active
    if (handshakeResult && handshakeResult.stage !== 'idle') {
      sessionId = handshakeResult.sessionId;
      if (handshakeResult.peer) {
        peerId = handshakeResult.peer.id;
        peerName = handshakeResult.peer.displayName;
      }
      
      if (handshakeResult.stage === 'complete') {
        currentFlow = 'active';
      } else if (handshakeResult.stage === 'error') {
        currentFlow = 'none';
        lastError = handshakeResult.error || 'Unknown handshake error';
        errorTimestamp = Date.now();
      } else {
        currentFlow = 'handshaking';
      }
    }

    // Check crypto state for session
    const hasKeys = sessionId ? isHandshakeComplete(sessionId) : false;
    const sessionKeys = sessionId ? getSessionKeys(sessionId) : undefined;

    return {
      currentFlow,
      sessionId,
      peerId,
      peerName,
      handshakeStage: handshakeResult?.stage || null,
      handshakeProgress: handshakeResult?.progress || 0,
      hasLocalKeys: Boolean(sessionKeys?.keyPair),
      hasPeerKey: Boolean(sessionKeys?.peerPublicKey),
      hasSharedSecret: hasKeys,
      lastError,
      errorTimestamp,
    };
  }, [sessionResult, handshakeResult]);

  // Compute crypto state
  const cryptoState: CryptoDebugState = useMemo(() => ({
    sessions: cryptoSessions,
    operations,
  }), [cryptoSessions, operations]);

  return {
    websocket: websocketState,
    sessionFlow: sessionFlowState,
    crypto: cryptoState,
    timeline,
  };
}
