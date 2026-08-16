import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Client, IMessage, StompSubscription, IFrame } from '@stomp/stompjs';
import type { AuthCredentials } from '../auth';

/**
 * STOMP client surface passed into chat message hooks (same shape for DM and rooms).
 * Keeps `isReconnection` in sync with {@link useWebSocket}.
 */
export interface ChatWebSocketApi {
  isConnected: boolean;
  /** True when this is a reconnection (not the first connect). Same as `useWebSocket.isReconnection`. */
  isReconnection?: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}
import SockJS from 'sockjs-client';
import WebApp from '@twa-dev/sdk';
import { debugLog, incrementMessagesSent, incrementMessagesReceived, logStompMessage } from '../components/DebugPanel';
import { buildStompErrorDebugData } from '../components/DebugPanel/DebugPanel';
import { buildWebSocketHandshakeUrl } from './webSocketHandshakeUrl';

/** WebSocket connection error types */
export type WebSocketErrorType = 
  | 'auth_error'      // Authentication failed
  | 'auth_expired'    // Authentication data expired
  | 'connection_error' // General connection error
  | 'timeout'         // Connection timeout
  | 'room_subscribe_denied' // Room topic SUBSCRIBE rejected (NOT_MEMBER / SUBSCRIBE_DENIED)
  | 'unknown';        // Unknown error

export interface WebSocketError {
  type: WebSocketErrorType;
  message: string;
  recoverable: boolean;
  /** Present when {@link WebSocketErrorType.room_subscribe_denied} */
  roomId?: string;
}

const ROOM_TOPIC_PREFIX = '/topic/room/';

/** Stored subscription for reconnect restoration */
interface StoredSubscription {
  destination: string;
  callback: (message: IMessage) => void;
}

interface UseWebSocketOptions {
  /** Auto-connect when hook mounts */
  autoConnect?: boolean;
  /** Delay before reconnection attempts (ms) */
  reconnectDelay?: number;
  /** Expected heartbeat interval from server (ms) */
  heartbeatIncoming?: number;
  /** Heartbeat interval to server (ms) */
  heartbeatOutgoing?: number;
  /** Maximum reconnection attempts (0 = unlimited) */
  maxReconnectAttempts?: number;
  /** Callback when connection is established */
  onConnect?: () => void;
  /** Callback when disconnected */
  onDisconnect?: () => void;
  /** Callback when error occurs */
  onError?: (error: WebSocketError) => void;
  /** Callback when reconnected (after disconnect) */
  onReconnect?: () => void;
  /** Returns current auth credentials for WebSocket handshake (SockJS query params) */
  getCredentials?: () => AuthCredentials | null;
}

/** Debug state for WebSocket */
export interface WebSocketDebugInfo {
  /** List of currently active subscription destinations */
  activeSubscriptions: string[];
  /** List of stored subscription destinations (for reconnect) */
  storedSubscriptions: string[];
}

interface UseWebSocketReturn {
  /** Whether connected to server */
  isConnected: boolean;
  /** Whether connection is in progress */
  isConnecting: boolean;
  /** Current error state */
  error: WebSocketError | null;
  /** Reconnection attempt count */
  reconnectAttempt: number;
  /** Whether this is a reconnection (not first connect) */
  isReconnection: boolean;
  /** Initiate connection */
  connect: () => void;
  /**
   * Disconnect from server.
   * @param clearStoredSubscriptions When `true` (default): clear stored reconnect subs —
   *   use **only on logout**. When `false`: keep subs for navigation/remount reuse.
   */
  disconnect: (clearStoredSubscriptions?: boolean) => void;
  /** Subscribe to a destination */
  subscribe: (destination: string, callback: (message: IMessage) => void) => StompSubscription | null;
  /** Unsubscribe from a destination */
  unsubscribe: (destination: string) => void;
  /** Publish message to destination */
  publish: (destination: string, body: unknown) => void;
  /** STOMP client instance */
  client: Client | null;
  /** Debug information (subscriptions, etc.) */
  _debug: WebSocketDebugInfo;
}

const WS_URL = import.meta.env.VITE_WS_URL || '/ws';
const DEFAULT_RECONNECT_DELAY = 5000;
const DEFAULT_HEARTBEAT = 10000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Interval for sending application-level heartbeat to refresh Redis online status TTL.
 * Server sets TTL=30s, so we refresh every 20s to keep the key alive.
 */
const PRESENCE_HEARTBEAT_INTERVAL = 20000;
const PRESENCE_HEARTBEAT_DESTINATION = '/app/heartbeat';

/**
 * Extract roomId from STOMP ERROR frame for room topic subscribe denial (IMP-ROOM-22/26).
 */
function extractRoomIdFromSubscribeError(frame: IFrame, message: string): string | undefined {
  const fromMessage = message.match(/subscribe denied for room\s+(\S+)/i)?.[1];
  if (fromMessage) {
    return fromMessage;
  }

  const subscriptionHeader = frame.headers?.subscription;
  if (typeof subscriptionHeader === 'string') {
    const fromSubscription = subscriptionHeader.match(/\/topic\/room\/([^/\s]+)/)?.[1];
    if (fromSubscription) {
      return fromSubscription;
    }
  }

  return undefined;
}

/**
 * Detect room topic SUBSCRIBE denial (NOT_MEMBER / SUBSCRIBE_DENIED from IMP-ROOM-22).
 */
function parseRoomSubscribeDeniedError(frame: IFrame, message: string): WebSocketError | null {
  const upperMessage = message.toUpperCase();
  const isNotMember = upperMessage.includes('NOT_MEMBER');
  const isSubscribeDenied = upperMessage.includes('SUBSCRIBE_DENIED');

  if (!isNotMember && !isSubscribeDenied) {
    return null;
  }

  // NOT_MEMBER appears in user-queue JSON acks too; STOMP ERROR from subscribe guard
  // always includes NOT_MEMBER or SUBSCRIBE_DENIED in the ERROR frame message header.
  return {
    type: 'room_subscribe_denied',
    message,
    recoverable: true,
    roomId: extractRoomIdFromSubscribeError(frame, message),
  };
}

/**
 * Drop stored/active room topic subscriptions so reconnect does not retry denied SUBSCRIBE.
 */
function clearRoomTopicSubscriptions(
  subscriptionsRef: MutableRefObject<Map<string, StompSubscription>>,
  storedSubscriptionsRef: MutableRefObject<Map<string, StoredSubscription>>,
  roomId?: string,
): void {
  const targets = roomId
    ? [`${ROOM_TOPIC_PREFIX}${roomId}`]
    : [...storedSubscriptionsRef.current.keys()].filter((dest) => dest.startsWith(ROOM_TOPIC_PREFIX));

  for (const destination of targets) {
    storedSubscriptionsRef.current.delete(destination);
    const subscription = subscriptionsRef.current.get(destination);
    if (subscription) {
      try {
        subscription.unsubscribe();
      } catch {
        // Ignore unsubscribe errors
      }
      subscriptionsRef.current.delete(destination);
    }
    debugLog('info', `Cleared room topic subscription after NOT_MEMBER: ${destination}`);
  }
}

/**
 * Parse STOMP error frame to determine error type.
 */
function parseStompError(frame: IFrame): WebSocketError {
  const message = frame.headers?.message || frame.body || 'Unknown error';
  const lowerMessage = message.toLowerCase();

  const roomSubscribeDenied = parseRoomSubscribeDeniedError(frame, message);
  if (roomSubscribeDenied) {
    return roomSubscribeDenied;
  }

  // Check for authentication errors
  if (lowerMessage.includes('auth') || 
      lowerMessage.includes('missing required field') ||
      lowerMessage.includes('invalid signature')) {
    return {
      type: 'auth_error',
      message: 'Authentication failed. Please restart the app.',
      recoverable: false,
    };
  }

  if (lowerMessage.includes('expired')) {
    return {
      type: 'auth_expired',
      message: 'Session expired. Please restart the app.',
      recoverable: false,
    };
  }

  return {
    type: 'connection_error',
    message,
    recoverable: true,
  };
}

/**
 * Hook for STOMP over WebSocket with identity auth on the SockJS handshake.
 *
 * Credentials (`X-Telegram-Init-Data`, `X-Auth-Type`, `X-Auth-Token`) are sent as
 * URL query params on `/ws`, not in STOMP CONNECT headers — see IMP-AUDIT-23 decision-log.
 * 
 * @example
 * ```tsx
 * function ChatComponent() {
 *   const { isConnected, error, subscribe, publish } = useWebSocket({
 *     autoConnect: true,
 *     onConnect: () => console.log('Connected!'),
 *   });
 * 
 *   useEffect(() => {
 *     if (isConnected) {
 *       subscribe('/user/queue/messages', (msg) => {
 *         console.log('Received:', JSON.parse(msg.body));
 *       });
 *     }
 *   }, [isConnected, subscribe]);
 * 
 *   const sendMessage = () => {
 *     publish('/app/message.send', { text: 'Hello!' });
 *   };
 * 
 *   if (error && !error.recoverable) {
 *     return <div>Error: {error.message}</div>;
 *   }
 * 
 *   return <div>Connected: {isConnected ? 'Yes' : 'No'}</div>;
 * }
 * ```
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    autoConnect = false,
    reconnectDelay = DEFAULT_RECONNECT_DELAY,
    heartbeatIncoming = DEFAULT_HEARTBEAT,
    heartbeatOutgoing = DEFAULT_HEARTBEAT,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
    onConnect,
    onDisconnect,
    onError,
    onReconnect,
    getCredentials,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<WebSocketError | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [isReconnection, setIsReconnection] = useState(false);
  
  const clientRef = useRef<Client | null>(null);
  const subscriptionsRef = useRef<Map<string, StompSubscription>>(new Map());
  /** Store subscription callbacks for reconnect restoration */
  const storedSubscriptionsRef = useRef<Map<string, StoredSubscription>>(new Map());
  const reconnectAttemptsRef = useRef(0);
  /** Track if we've connected at least once */
  const hasConnectedOnceRef = useRef(false);
  /** Track connection state without causing re-renders in connect callback */
  const isConnectingRef = useRef(false);
  
  /** Store callbacks in refs to prevent unnecessary recreations of createClient */
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);
  const onReconnectRef = useRef(onReconnect);
  
  // Keep refs up to date
  useEffect(() => {
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onErrorRef.current = onError;
    onReconnectRef.current = onReconnect;
  }, [onConnect, onDisconnect, onError, onReconnect]);

  const handleError = useCallback((wsError: WebSocketError) => {
    setError(wsError);
    onErrorRef.current?.(wsError);

    // For non-recoverable errors, stop reconnection attempts
    if (!wsError.recoverable && clientRef.current) {
      clientRef.current.deactivate();
    }
  }, []);

  const createClient = useCallback(() => {
    const credentials = getCredentials?.() ?? null;
    const isWallet = credentials?.type === 'wallet';
    const initData = credentials?.type === 'telegram' ? credentials.initData || '' : '';
    const sessionToken = isWallet ? credentials?.sessionToken || '' : '';
    const handshakeUrl = buildWebSocketHandshakeUrl(WS_URL, credentials);

    debugLog('info', 'Creating STOMP client', {
      wsPath: WS_URL,
      authType: credentials?.type ?? 'unknown',
      hasInitData: Boolean(initData),
      initDataLength: initData?.length || 0,
      hasSessionToken: Boolean(sessionToken),
    });

    if (!isWallet && !initData && import.meta.env.PROD) {
      debugLog('warn', 'No initData available - authentication will fail');
    }

    const client = new Client({
      webSocketFactory: () => {
        debugLog('info', 'Creating SockJS connection', { wsPath: WS_URL });
        return new SockJS(handshakeUrl);
      },
      reconnectDelay,
      heartbeatIncoming,
      heartbeatOutgoing,
      
      onConnect: () => {
        debugLog('success', 'STOMP connected successfully');
        
        const wasReconnection = hasConnectedOnceRef.current;
        hasConnectedOnceRef.current = true;
        
        reconnectAttemptsRef.current = 0;
        setReconnectAttempt(0);
        
        // Restore/apply stored subscriptions BEFORE signaling connected
        // This prevents race conditions where server sends messages before subscriptions are ready
        if (storedSubscriptionsRef.current.size > 0) {
          debugLog('info', wasReconnection ? 'Restoring subscriptions after reconnect' : 'Applying stored subscriptions on first connect');
          
          if (wasReconnection) {
            setIsReconnection(true);
            // Clear old subscription refs on reconnect
            subscriptionsRef.current.clear();
          }
          
          // Subscribe to all stored destinations
          storedSubscriptionsRef.current.forEach(({ destination, callback }) => {
            // Skip if already subscribed (for first connect)
            if (subscriptionsRef.current.has(destination)) {
              return;
            }
            try {
              const subscription = client.subscribe(destination, callback);
              subscriptionsRef.current.set(destination, subscription);
              debugLog('info', `${wasReconnection ? 'Restored' : 'Applied'} subscription to ${destination}`);
            } catch (e) {
              debugLog('error', `Failed to subscribe to ${destination}`, { error: String(e) });
            }
          });
          
          if (wasReconnection) {
            onReconnectRef.current?.();
          }
        } else {
          setIsReconnection(false);
        }
        
        // Set connected state AFTER subscriptions are established
        setIsConnected(true);
        isConnectingRef.current = false;
        setIsConnecting(false);
        setError(null);
        
        onConnectRef.current?.();
      },
      
      onDisconnect: () => {
        debugLog('warn', 'STOMP disconnected');
        setIsConnected(false);
        isConnectingRef.current = false;
        setIsConnecting(false);
        onDisconnectRef.current?.();
      },
      
      onStompError: (frame) => {
        debugLog('error', 'STOMP error', buildStompErrorDebugData(frame));
        const wsError = parseStompError(frame);
        if (wsError.type === 'room_subscribe_denied') {
          clearRoomTopicSubscriptions(subscriptionsRef, storedSubscriptionsRef, wsError.roomId);
        }
        handleError(wsError);
        isConnectingRef.current = false;
        setIsConnecting(false);
      },
      
      onWebSocketError: (event) => {
        debugLog('error', 'WebSocket error', { 
          type: event?.type,
          message: (event as ErrorEvent)?.message || 'Unknown error',
        });
        handleError({
          type: 'connection_error',
          message: 'WebSocket connection failed',
          recoverable: true,
        });
        isConnectingRef.current = false;
        setIsConnecting(false);
      },
      
      onWebSocketClose: (event) => {
        debugLog('warn', 'WebSocket closed', { 
          code: event?.code,
          reason: event?.reason || 'No reason',
          wasClean: event?.wasClean,
        });
        setIsConnected(false);
        
        // Track reconnection attempts
        if (maxReconnectAttempts > 0) {
          reconnectAttemptsRef.current += 1;
          setReconnectAttempt(reconnectAttemptsRef.current);
          
          if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
            debugLog('error', 'Max reconnection attempts reached', { 
              attempts: reconnectAttemptsRef.current 
            });
            handleError({
              type: 'connection_error',
              message: 'Unable to connect after multiple attempts',
              recoverable: false,
            });
          }
        }
      },
    });

    return client;
  }, [reconnectDelay, heartbeatIncoming, heartbeatOutgoing, maxReconnectAttempts, handleError, getCredentials]);

  const connect = useCallback(() => {
    debugLog('info', 'connect() called', { 
      alreadyConnected: clientRef.current?.connected,
      isConnecting: isConnectingRef.current,
    });
    
    if (clientRef.current?.connected) {
      debugLog('info', 'Already connected, skipping');
      return;
    }

    // Use ref to check connection state (avoids race condition from state updates)
    if (isConnectingRef.current) {
      debugLog('info', 'Connection in progress, skipping');
      return;
    }

    // Check for initData in production
    const credentials = getCredentials?.() ?? null;
    const isWallet = credentials?.type === 'wallet';
    const initData = credentials?.type === 'telegram' ? credentials.initData || '' : '';
    const sessionToken = isWallet ? credentials?.sessionToken || '' : '';
    if (!isWallet && !initData && import.meta.env.PROD) {
      debugLog('error', 'No initData in production', { 
        platform: WebApp.platform,
        version: WebApp.version,
      });
      handleError({
        type: 'auth_error',
        message: 'Missing authentication data. Please open the app from Telegram.',
        recoverable: false,
      });
      return;
    }
    if (isWallet && !sessionToken) {
      debugLog('error', 'Wallet session token is missing');
      handleError({
        type: 'auth_error',
        message: 'Wallet session is missing. Please reconnect wallet.',
        recoverable: false,
      });
      return;
    }

    // Set ref immediately to prevent race conditions
    isConnectingRef.current = true;
    setIsConnecting(true);
    setError(null);
    reconnectAttemptsRef.current = 0;
    setReconnectAttempt(0);

    const client = createClient();
    clientRef.current = client;
    
    debugLog('info', 'Activating STOMP client', { wsPath: WS_URL });
    client.activate();
  }, [createClient, getCredentials, handleError]);

  /**
   * @param clearStoredSubscriptions - `true` (default) clears stored subscriptions — use **only**
   *   on logout. For routine remounts / effect cleanup pass `false` to retain subs for reconnect.
   */
  const disconnect = useCallback((clearStoredSubscriptions = true) => {
    debugLog('info', 'disconnect()', { clearStoredSubscriptions });
    if (clientRef.current) {
      // Clear all active subscriptions
      subscriptionsRef.current.forEach((sub) => {
        try {
          sub.unsubscribe();
        } catch {
          // Ignore unsubscribe errors
        }
      });
      subscriptionsRef.current.clear();

      // Clear stored subscriptions only if explicitly requested (full disconnect)
      if (clearStoredSubscriptions) {
        storedSubscriptionsRef.current.clear();
        hasConnectedOnceRef.current = false;
      }

      clientRef.current.deactivate();
      clientRef.current = null;
      setIsConnected(false);
      isConnectingRef.current = false;
      setIsConnecting(false);
      setIsReconnection(false);
      reconnectAttemptsRef.current = 0;
      setReconnectAttempt(0);
    }
  }, []);

  const subscribe = useCallback(
    (destination: string, callback: (message: IMessage) => void): StompSubscription | null => {
      // Wrap callback to track received messages and log STOMP messages
      const wrappedCallback = (message: IMessage) => {
        incrementMessagesReceived();
        
        // Log incoming STOMP message for Phase 2 tracing
        let parsedBody: unknown;
        try {
          parsedBody = message.body ? JSON.parse(message.body) : null;
        } catch {
          parsedBody = message.body;
        }
        
        const headers: Record<string, string> = {};
        // IMessage headers is a StompHeaders object, convert to Record
        if (message.headers) {
          Object.keys(message.headers).forEach(key => {
            headers[key] = String(message.headers[key]);
          });
        }
        
        logStompMessage(
          'incoming',
          destination,
          'MESSAGE',
          headers,
          parsedBody,
          // Use destination as correlation ID for simple correlation
          destination
        );
        
        callback(message);
      };
      
      // Store subscription callback for reconnect restoration (5.1.1)
      storedSubscriptionsRef.current.set(destination, { destination, callback: wrappedCallback });
      
      if (!clientRef.current?.connected) {
        debugLog('warn', 'Cannot subscribe - not connected (will subscribe on connect)');
        return null;
      }

      // Check if already subscribed
      if (subscriptionsRef.current.has(destination)) {
        console.warn(`[WebSocket] Already subscribed to ${destination}`);
        return subscriptionsRef.current.get(destination)!;
      }

      const subscription = clientRef.current.subscribe(destination, wrappedCallback);
      subscriptionsRef.current.set(destination, subscription);
      return subscription;
    },
    []
  );

  const unsubscribe = useCallback((destination: string) => {
    // Remove from stored subscriptions (5.1.1)
    storedSubscriptionsRef.current.delete(destination);
    
    const subscription = subscriptionsRef.current.get(destination);
    if (subscription) {
      try {
        subscription.unsubscribe();
        subscriptionsRef.current.delete(destination);
      } catch (e) {
        console.warn(`[WebSocket] Failed to unsubscribe from ${destination}:`, e);
      }
    }
  }, []);

  const publish = useCallback((destination: string, body: unknown) => {
    if (!clientRef.current?.connected) {
      console.warn('[WebSocket] Cannot publish - not connected');
      return;
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };

    clientRef.current.publish({
      destination,
      body: JSON.stringify(body),
      headers,
    });
    
    // Track message for debug panel
    incrementMessagesSent();
    
    // Log STOMP message for Phase 2 tracing
    logStompMessage(
      'outgoing',
      destination,
      'SEND',
      headers,
      body,
      // Use destination as correlation ID for simple correlation
      destination
    );
    
    if (import.meta.env.DEV) {
      console.log(`[WebSocket] Published to ${destination}:`, body);
    }
  }, []);

  // Auto-connect if enabled
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Application-level presence heartbeat (refreshes Redis online TTL)
  // Server online status key has 30s TTL; we refresh every 20s to keep it alive.
  // Without this, after 30s the server considers the user offline and queues messages.
  useEffect(() => {
    if (!isConnected) return;

    // Send heartbeat immediately on connect to refresh TTL
    if (clientRef.current?.connected) {
      try {
        clientRef.current.publish({
          destination: PRESENCE_HEARTBEAT_DESTINATION,
          body: '{}',
          headers: { 'content-type': 'application/json' },
        });
        debugLog('info', 'Presence heartbeat sent (initial)');
      } catch (e) {
        debugLog('warn', 'Failed to send initial presence heartbeat', { error: String(e) });
      }
    }

    const intervalId = setInterval(() => {
      if (clientRef.current?.connected) {
        try {
          clientRef.current.publish({
            destination: PRESENCE_HEARTBEAT_DESTINATION,
            body: '{}',
            headers: { 'content-type': 'application/json' },
          });
          debugLog('info', 'Presence heartbeat sent');
        } catch (e) {
          debugLog('warn', 'Failed to send presence heartbeat', { error: String(e) });
        }
      }
    }, PRESENCE_HEARTBEAT_INTERVAL);

    return () => {
      clearInterval(intervalId);
    };
  }, [isConnected]);

  // Debug state for Debug Panel
  const _debug: WebSocketDebugInfo = {
    activeSubscriptions: Array.from(subscriptionsRef.current.keys()),
    storedSubscriptions: Array.from(storedSubscriptionsRef.current.keys()),
  };

  return {
    isConnected,
    isConnecting,
    error,
    reconnectAttempt,
    isReconnection,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    publish,
    client: clientRef.current,
    _debug,
  };
}


