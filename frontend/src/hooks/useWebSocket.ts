import { useCallback, useEffect, useRef, useState } from 'react';
import { Client, IMessage, StompSubscription, IFrame } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import WebApp from '@twa-dev/sdk';

/** WebSocket connection error types */
export type WebSocketErrorType = 
  | 'auth_error'      // Authentication failed
  | 'auth_expired'    // Authentication data expired
  | 'connection_error' // General connection error
  | 'timeout'         // Connection timeout
  | 'unknown';        // Unknown error

interface WebSocketError {
  type: WebSocketErrorType;
  message: string;
  recoverable: boolean;
}

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
  /** Disconnect from server (clearStoredSubscriptions=true clears for full disconnect) */
  disconnect: (clearStoredSubscriptions?: boolean) => void;
  /** Subscribe to a destination */
  subscribe: (destination: string, callback: (message: IMessage) => void) => StompSubscription | null;
  /** Unsubscribe from a destination */
  unsubscribe: (destination: string) => void;
  /** Publish message to destination */
  publish: (destination: string, body: unknown) => void;
  /** STOMP client instance */
  client: Client | null;
}

const WS_URL = import.meta.env.VITE_WS_URL || '/ws';
const DEFAULT_RECONNECT_DELAY = 5000;
const DEFAULT_HEARTBEAT = 10000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

/** Header name for Telegram initData authentication */
const INIT_DATA_HEADER = 'X-Telegram-Init-Data';

/**
 * Parse STOMP error frame to determine error type.
 */
function parseStompError(frame: IFrame): WebSocketError {
  const message = frame.headers?.message || frame.body || 'Unknown error';
  const lowerMessage = message.toLowerCase();

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
 * Hook for STOMP over WebSocket connection with Telegram authentication.
 * 
 * Automatically includes Telegram initData in connection headers for
 * server-side authentication via StompAuthInterceptor.
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

  const handleError = useCallback((wsError: WebSocketError) => {
    setError(wsError);
    onError?.(wsError);

    // For non-recoverable errors, stop reconnection attempts
    if (!wsError.recoverable && clientRef.current) {
      clientRef.current.deactivate();
    }
  }, [onError]);

  const createClient = useCallback(() => {
    // Get fresh initData for each connection attempt
    const initData = WebApp.initData;

    if (!initData && import.meta.env.PROD) {
      console.warn('[WebSocket] No initData available - authentication will fail');
    }

    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      connectHeaders: {
        [INIT_DATA_HEADER]: initData || '',
      },
      reconnectDelay,
      heartbeatIncoming,
      heartbeatOutgoing,
      
      onConnect: () => {
        console.log('[WebSocket] Connected successfully');
        setIsConnected(true);
        setIsConnecting(false);
        setError(null);
        
        const wasReconnection = hasConnectedOnceRef.current;
        hasConnectedOnceRef.current = true;
        
        reconnectAttemptsRef.current = 0;
        setReconnectAttempt(0);
        
        // Restore subscriptions after reconnect (5.1.1)
        if (wasReconnection && storedSubscriptionsRef.current.size > 0) {
          console.log('[WebSocket] Restoring subscriptions after reconnect...');
          setIsReconnection(true);
          
          // Clear old subscription refs
          subscriptionsRef.current.clear();
          
          // Re-subscribe to all stored destinations
          storedSubscriptionsRef.current.forEach(({ destination, callback }) => {
            try {
              const subscription = client.subscribe(destination, callback);
              subscriptionsRef.current.set(destination, subscription);
              console.log(`[WebSocket] Restored subscription to ${destination}`);
            } catch (e) {
              console.error(`[WebSocket] Failed to restore subscription to ${destination}:`, e);
            }
          });
          
          onReconnect?.();
        } else {
          setIsReconnection(false);
        }
        
        onConnect?.();
      },
      
      onDisconnect: () => {
        console.log('[WebSocket] Disconnected');
        setIsConnected(false);
        setIsConnecting(false);
        onDisconnect?.();
      },
      
      onStompError: (frame) => {
        console.error('[WebSocket] STOMP Error:', frame.headers?.message || frame.body);
        const wsError = parseStompError(frame);
        handleError(wsError);
        setIsConnecting(false);
      },
      
      onWebSocketError: (event) => {
        console.error('[WebSocket] WebSocket Error:', event);
        handleError({
          type: 'connection_error',
          message: 'WebSocket connection failed',
          recoverable: true,
        });
        setIsConnecting(false);
      },
      
      onWebSocketClose: (event) => {
        console.log('[WebSocket] WebSocket Closed:', event?.reason || 'No reason');
        setIsConnected(false);
        
        // Track reconnection attempts
        if (maxReconnectAttempts > 0) {
          reconnectAttemptsRef.current += 1;
          setReconnectAttempt(reconnectAttemptsRef.current);
          
          if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
            console.warn('[WebSocket] Max reconnection attempts reached');
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
  }, [reconnectDelay, heartbeatIncoming, heartbeatOutgoing, maxReconnectAttempts, onConnect, onDisconnect, handleError]);

  const connect = useCallback(() => {
    if (clientRef.current?.connected) {
      console.log('[WebSocket] Already connected');
      return;
    }

    if (isConnecting) {
      console.log('[WebSocket] Connection in progress');
      return;
    }

    // Check for initData in production
    if (!WebApp.initData && import.meta.env.PROD) {
      handleError({
        type: 'auth_error',
        message: 'Missing authentication data. Please open the app from Telegram.',
        recoverable: false,
      });
      return;
    }

    setIsConnecting(true);
    setError(null);
    reconnectAttemptsRef.current = 0;
    setReconnectAttempt(0);

    const client = createClient();
    clientRef.current = client;
    
    console.log('[WebSocket] Initiating connection to', WS_URL);
    client.activate();
  }, [createClient, isConnecting, handleError]);

  const disconnect = useCallback((clearStoredSubscriptions = true) => {
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
      setIsConnecting(false);
      setIsReconnection(false);
      reconnectAttemptsRef.current = 0;
      setReconnectAttempt(0);
    }
  }, []);

  const subscribe = useCallback(
    (destination: string, callback: (message: IMessage) => void): StompSubscription | null => {
      // Store subscription callback for reconnect restoration (5.1.1)
      storedSubscriptionsRef.current.set(destination, { destination, callback });
      
      if (!clientRef.current?.connected) {
        console.warn('[WebSocket] Cannot subscribe - not connected (will subscribe on connect)');
        return null;
      }

      // Check if already subscribed
      if (subscriptionsRef.current.has(destination)) {
        console.warn(`[WebSocket] Already subscribed to ${destination}`);
        return subscriptionsRef.current.get(destination)!;
      }

      const subscription = clientRef.current.subscribe(destination, callback);
      subscriptionsRef.current.set(destination, subscription);
      
      console.log(`[WebSocket] Subscribed to ${destination}`);
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
        console.log(`[WebSocket] Unsubscribed from ${destination}`);
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

    clientRef.current.publish({
      destination,
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
    });
    
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
  };
}


