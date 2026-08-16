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

// ============================================
// STOMP Message Types (Phase 2)
// ============================================

/** STOMP command types */
export type StompCommand = 'SEND' | 'MESSAGE' | 'SUBSCRIBE' | 'UNSUBSCRIBE' | 'CONNECT' | 'CONNECTED' | 'DISCONNECT' | 'ERROR' | 'ACK' | 'NACK';

/** STOMP message for logging */
export interface StompMessage {
  id: number;
  timestamp: number;
  direction: 'outgoing' | 'incoming';
  destination: string;
  command: StompCommand;
  headers: Record<string, string>;
  body: unknown;
  size: number;
  /** For request/response correlation */
  correlationId?: string;
}

/** Correlated request/response pair */
export interface CorrelatedMessage {
  requestId: string;
  request: StompMessage;
  response: StompMessage | null;
  latencyMs: number | null;
  status: 'pending' | 'success' | 'error' | 'timeout';
}

/** STOMP messages debug state */
export interface StompMessagesState {
  messages: StompMessage[];
  correlatedMessages: CorrelatedMessage[];
  filter: {
    direction: 'all' | 'outgoing' | 'incoming';
    destination: string | null;
  };
}

// ============================================
// Performance Metrics Types (Phase 5)
// ============================================

/** Performance metrics for the application */
export interface PerformanceMetrics {
  /** Time to establish initial connection (ms) */
  connectionTime: number | null;
  /** Average message round-trip latency (ms) */
  avgMessageLatency: number;
  /** Total handshake duration from start to complete (ms) */
  handshakeDuration: number | null;
  /** Crypto operation times by operation type (ms) */
  cryptoOperationTimes: Record<string, { avg: number; min: number; max: number; count: number }>;
  /** Message counts */
  messageStats: {
    totalSent: number;
    totalReceived: number;
    sentPerMinute: number;
    receivedPerMinute: number;
  };
  /** Latency samples for trend analysis */
  latencySamples: Array<{ timestamp: number; latency: number }>;
}

/** Full debug state */
export interface DebugState {
  websocket: WebSocketDebugState;
  sessionFlow: SessionFlowState;
  crypto: CryptoDebugState;
  timeline: TimelineEvent[];
  stomp: StompMessagesState;
  performance: PerformanceMetrics;
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
// Payload gate (IMP-DBGPANEL-01)
// ============================================

/** Test-only override. `undefined` restores `import.meta.env.DEV`. */
let payloadAllowedOverride: boolean | undefined;

/**
 * STOMP body is allowed in the ring iff DEV — same gate as CryptoTab dump
 * and Flow/keyStore fingerprint fields (IMP-DBGPANEL-05).
 * Do not mix with `import.meta.env.PROD`.
 */
export function isDebugPayloadAllowed(): boolean {
  if (payloadAllowedOverride !== undefined) {
    return payloadAllowedOverride;
  }
  return import.meta.env.DEV === true;
}

/** Force DEV/prod payload gate in unit tests. Pass `undefined` to restore. */
export function setDebugPayloadAllowedForTests(allowed: boolean | undefined): void {
  payloadAllowedOverride = allowed;
}

// ============================================
// STOMP Message Logger (Phase 2)
// ============================================

let stompMessages: StompMessage[] = [];
let stompMessageId = 0;
const stompListeners = new Set<() => void>();
const MAX_STOMP_MESSAGES = 100;

/** Snapshot of the in-memory STOMP ring (test + panel subscribers). */
export function getStompMessages(): StompMessage[] {
  return [...stompMessages];
}

/** Pending requests for correlation (key: correlationId) */
const pendingRequests = new Map<string, { request: StompMessage; timestamp: number }>();
let correlatedMessages: CorrelatedMessage[] = [];
const CORRELATION_TIMEOUT_MS = 30000;

/**
 * Log a STOMP message (outgoing or incoming)
 */
export function logStompMessage(
  direction: 'outgoing' | 'incoming',
  destination: string,
  command: StompCommand,
  headers: Record<string, string>,
  body: unknown,
  correlationId?: string
): StompMessage {
  let size = 0;
  try {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    size = new Blob([bodyStr ?? '']).size;
  } catch {
    size = 0;
  }

  const storedBody = isDebugPayloadAllowed() ? body : undefined;

  const message: StompMessage = {
    id: stompMessageId++,
    timestamp: Date.now(),
    direction,
    destination,
    command,
    headers,
    body: storedBody,
    size,
    correlationId,
  };

  stompMessages = [...stompMessages.slice(-(MAX_STOMP_MESSAGES - 1)), message];

  // Handle request/response correlation
  if (direction === 'outgoing' && correlationId) {
    // Store pending request
    pendingRequests.set(correlationId, { request: message, timestamp: Date.now() });
    correlatedMessages = [
      ...correlatedMessages.slice(-49),
      {
        requestId: correlationId,
        request: message,
        response: null,
        latencyMs: null,
        status: 'pending',
      },
    ];
  } else if (direction === 'incoming' && correlationId) {
    // Try to match with pending request
    const pending = pendingRequests.get(correlationId);
    if (pending) {
      const latencyMs = Date.now() - pending.timestamp;
      pendingRequests.delete(correlationId);

      // Update correlated message
      correlatedMessages = correlatedMessages.map(cm =>
        cm.requestId === correlationId
          ? {
              ...cm,
              response: message,
              latencyMs,
              status: command === 'ERROR' ? 'error' : 'success',
            }
          : cm
      );
    }
  }

  stompListeners.forEach(fn => fn());
  return message;
}

/**
 * Clear all STOMP messages
 */
export function clearStompMessages(): void {
  stompMessages = [];
  correlatedMessages = [];
  pendingRequests.clear();
  stompListeners.forEach(fn => fn());
}

/**
 * Check for timed out pending requests
 */
function checkTimeouts(): void {
  const now = Date.now();
  let hasChanges = false;

  pendingRequests.forEach((value, key) => {
    if (now - value.timestamp > CORRELATION_TIMEOUT_MS) {
      pendingRequests.delete(key);
      correlatedMessages = correlatedMessages.map(cm =>
        cm.requestId === key && cm.status === 'pending'
          ? { ...cm, status: 'timeout' }
          : cm
      );
      hasChanges = true;
    }
  });

  if (hasChanges) {
    stompListeners.forEach(fn => fn());
  }
}

// Check for timeouts periodically
if (typeof window !== 'undefined') {
  setInterval(checkTimeouts, 5000);
}

// ============================================
// Performance Metrics Tracking (Phase 5)
// ============================================

let connectionStartTime: number | null = null;
let connectionEstablishedTime: number | null = null;
let handshakeStartTime: number | null = null;
let handshakeCompleteTime: number | null = null;
let latencySamples: Array<{ timestamp: number; latency: number }> = [];
const MAX_LATENCY_SAMPLES = 100;
const performanceListeners = new Set<() => void>();

/** Start tracking connection time */
export function startConnectionTiming(): void {
  connectionStartTime = Date.now();
  connectionEstablishedTime = null;
  performanceListeners.forEach(fn => fn());
}

/** Mark connection as established */
export function markConnectionEstablished(): void {
  if (connectionStartTime) {
    connectionEstablishedTime = Date.now();
  }
  performanceListeners.forEach(fn => fn());
}

/** Get connection time in ms */
export function getConnectionTime(): number | null {
  if (connectionStartTime && connectionEstablishedTime) {
    return connectionEstablishedTime - connectionStartTime;
  }
  return null;
}

/** Start tracking handshake time */
export function startHandshakeTiming(): void {
  handshakeStartTime = Date.now();
  handshakeCompleteTime = null;
  performanceListeners.forEach(fn => fn());
}

/** Mark handshake as complete */
export function markHandshakeComplete(): void {
  if (handshakeStartTime) {
    handshakeCompleteTime = Date.now();
  }
  performanceListeners.forEach(fn => fn());
}

/** Get handshake duration in ms */
export function getHandshakeDuration(): number | null {
  if (handshakeStartTime && handshakeCompleteTime) {
    return handshakeCompleteTime - handshakeStartTime;
  }
  return null;
}

/** Record a latency sample from correlated messages */
export function recordLatencySample(latency: number): void {
  latencySamples = [
    ...latencySamples.slice(-(MAX_LATENCY_SAMPLES - 1)),
    { timestamp: Date.now(), latency },
  ];
  performanceListeners.forEach(fn => fn());
}

/** Get latency samples */
export function getLatencySamples(): Array<{ timestamp: number; latency: number }> {
  return [...latencySamples];
}

/** Clear all performance metrics */
export function clearPerformanceMetrics(): void {
  connectionStartTime = null;
  connectionEstablishedTime = null;
  handshakeStartTime = null;
  handshakeCompleteTime = null;
  latencySamples = [];
  performanceListeners.forEach(fn => fn());
}

/** Compute crypto operation statistics */
function computeCryptoStats(): Record<string, { avg: number; min: number; max: number; count: number }> {
  const stats: Record<string, { total: number; min: number; max: number; count: number }> = {};
  
  for (const op of cryptoOperations) {
    if (!op.success) continue;
    
    if (!stats[op.operation]) {
      stats[op.operation] = { total: 0, min: Infinity, max: 0, count: 0 };
    }
    
    stats[op.operation].total += op.durationMs;
    stats[op.operation].min = Math.min(stats[op.operation].min, op.durationMs);
    stats[op.operation].max = Math.max(stats[op.operation].max, op.durationMs);
    stats[op.operation].count++;
  }
  
  const result: Record<string, { avg: number; min: number; max: number; count: number }> = {};
  for (const [key, value] of Object.entries(stats)) {
    result[key] = {
      avg: Math.round(value.total / value.count),
      min: value.min === Infinity ? 0 : value.min,
      max: value.max,
      count: value.count,
    };
  }
  
  return result;
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

  // STOMP messages state (Phase 2)
  const [stompState, setStompState] = useState<StompMessagesState>({
    messages: stompMessages,
    correlatedMessages: correlatedMessages,
    filter: { direction: 'all', destination: null },
  });

  // Performance metrics state (Phase 5)
  const [performanceUpdate, setPerformanceUpdate] = useState(0);

  // Subscribe to STOMP message updates
  useEffect(() => {
    const updateStompState = () => {
      setStompState(prev => ({
        ...prev,
        messages: [...stompMessages],
        correlatedMessages: [...correlatedMessages],
      }));
    };
    stompListeners.add(updateStompState);
    return () => { stompListeners.delete(updateStompState); };
  }, []);

  // Subscribe to performance metrics updates (Phase 5)
  useEffect(() => {
    const updatePerformance = () => {
      setPerformanceUpdate(prev => prev + 1);
    };
    performanceListeners.add(updatePerformance);
    return () => { performanceListeners.delete(updatePerformance); };
  }, []);

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
      const allowDump = isDebugPayloadAllowed();
      const sessions: CryptoSessionDebugState[] = sessionIds.map(sessionId => {
        const keys = getSessionKeys(sessionId);
        return {
          sessionId,
          hasKeyPair: Boolean(keys?.keyPair),
          hasPeerPublicKey: Boolean(keys?.peerPublicKey),
          hasSharedSecret: Boolean(keys?.sharedSecret),
          hasAESKey: Boolean(keys?.sharedSecret?.key),
          fingerprint: allowDump ? (keys?.sharedSecret?.fingerprint || null) : null,
          visualFingerprint: allowDump ? keys?.sharedSecret?.visualFingerprint : undefined,
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
        addTimelineEvent(
          'Handshake complete',
          'complete',
          isDebugPayloadAllowed()
            ? `Fingerprint: ${handshakeResult.fingerprint?.slice(0, 8)}...`
            : undefined,
        );
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
        peerId = sessionResult.session.recipient.id ?? null;
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
        peerId = handshakeResult.peer.id ?? null;
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

  // Compute performance metrics (Phase 5)
  const performanceState: PerformanceMetrics = useMemo(() => {
    // Calculate average latency from samples
    const samples = getLatencySamples();
    const avgLatency = samples.length > 0
      ? Math.round(samples.reduce((sum, s) => sum + s.latency, 0) / samples.length)
      : 0;

    // Calculate messages per minute
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentSent = stompMessages.filter(
      m => m.direction === 'outgoing' && m.timestamp > oneMinuteAgo
    ).length;
    const recentReceived = stompMessages.filter(
      m => m.direction === 'incoming' && m.timestamp > oneMinuteAgo
    ).length;

    return {
      connectionTime: getConnectionTime(),
      avgMessageLatency: avgLatency,
      handshakeDuration: getHandshakeDuration(),
      cryptoOperationTimes: computeCryptoStats(),
      messageStats: {
        totalSent: messageCounters.sent,
        totalReceived: messageCounters.received,
        sentPerMinute: recentSent,
        receivedPerMinute: recentReceived,
      },
      latencySamples: samples,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageCounters, performanceUpdate, stompState.messages]);

  return {
    websocket: websocketState,
    sessionFlow: sessionFlowState,
    crypto: cryptoState,
    timeline,
    stomp: stompState,
    performance: performanceState,
  };
}
