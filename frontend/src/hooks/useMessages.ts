import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { useWebSocket } from './useWebSocket';
import { encryptMessage, decryptMessage } from '@/crypto/aes';
import { getAESKey, isHandshakeComplete } from '@/crypto/keyStore';
import type { DecryptedMessage, MessageStatus } from '@/types';

// ============================================
// Types
// ============================================

/** Message send result */
export interface SendMessageResult {
  success: boolean;
  messageId: string | null;
  error: MessageErrorCode | null;
}

/** Message error codes */
export type MessageErrorCode =
  | 'NOT_CONNECTED'       // WebSocket not connected
  | 'NO_SESSION'          // No active session
  | 'NO_ENCRYPTION_KEY'   // Handshake not complete
  | 'ENCRYPTION_FAILED'   // Failed to encrypt message
  | 'DECRYPTION_FAILED'   // Failed to decrypt message
  | 'SEND_FAILED'         // Failed to send message
  | 'SESSION_NOT_ACTIVE'  // Session is not in active state
  | 'SESSION_BURNED'      // Session was destroyed
  | 'INTERNAL_ERROR';     // Unexpected error

/** New message event from server */
interface NewMessageEvent {
  success: boolean;
  sessionId: string;
  messageId: string;
  senderId: number;
  encryptedContent: string;
  iv: string;
  clientTimestamp: number;
  serverTimestamp: string;
  error?: string;
}

/** Message sent acknowledgment from server */
interface MessageSentEvent {
  success: boolean;
  sessionId: string;
  messageId: string;
  serverTimestamp: string;
  delivered: boolean;
  queued: boolean;
  error?: string;
}

/** Hook options */
interface UseMessagesOptions {
  /** Session ID to listen for messages */
  sessionId: string;
  /** Current user's Telegram ID */
  userId: number;
  /** Callback when new message arrives */
  onNewMessage?: (message: DecryptedMessage) => void;
  /** Callback when message status changes */
  onStatusChange?: (messageId: string, status: MessageStatus) => void;
  /** Callback when error occurs */
  onError?: (error: MessageErrorCode, details?: string) => void;
}

/** Hook return value */
interface UseMessagesReturn {
  /** List of decrypted messages */
  messages: DecryptedMessage[];
  /** Whether messages are loading */
  isLoading: boolean;
  /** Send a new message */
  sendMessage: (text: string) => Promise<SendMessageResult>;
  /** Clear all messages (local only) */
  clearMessages: () => void;
  /** Retry failed message */
  retryMessage: (messageId: string) => Promise<SendMessageResult>;
  /** Current error */
  error: MessageErrorCode | null;
}

// ============================================
// Constants
// ============================================

const NEW_MESSAGE_DESTINATION = '/user/queue/new-message';
const MESSAGE_SENT_DESTINATION = '/user/queue/message-sent';
const SEND_MESSAGE_DESTINATION = '/app/message.send';

// ============================================
// Hook Implementation
// ============================================

/**
 * Hook for encrypted message exchange.
 * 
 * Handles end-to-end encryption/decryption of messages using
 * the shared AES key established during handshake.
 * 
 * @example
 * ```tsx
 * function ChatView({ sessionId, userId }: Props) {
 *   const { messages, sendMessage, isLoading } = useMessages({
 *     sessionId,
 *     userId,
 *     onNewMessage: (msg) => console.log('New message:', msg.content),
 *   });
 * 
 *   const handleSend = async (text: string) => {
 *     const result = await sendMessage(text);
 *     if (!result.success) {
 *       console.error('Failed:', result.error);
 *     }
 *   };
 * 
 *   return (
 *     <div>
 *       {messages.map(msg => (
 *         <div key={msg.id} className={msg.isOwn ? 'own' : 'peer'}>
 *           {msg.content}
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useMessages(options: UseMessagesOptions): UseMessagesReturn {
  const { sessionId, userId, onNewMessage, onStatusChange, onError } = options;

  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<MessageErrorCode | null>(null);

  // Pending messages waiting for acknowledgment
  const pendingMessagesRef = useRef<Map<string, { text: string; timestamp: number }>>(new Map());

  const { isConnected, subscribe, unsubscribe, publish } = useWebSocket();

  // ============================================
  // Error Handling
  // ============================================

  const handleError = useCallback((code: MessageErrorCode, details?: string) => {
    setError(code);
    onError?.(code, details);
    console.error(`[useMessages] Error: ${code}`, details);
  }, [onError]);

  // ============================================
  // Encryption (4.2.5)
  // ============================================

  /**
   * Encrypt and send a message.
   */
  const sendMessage = useCallback(async (text: string): Promise<SendMessageResult> => {
    // Validate connection
    if (!isConnected) {
      handleError('NOT_CONNECTED');
      return { success: false, messageId: null, error: 'NOT_CONNECTED' };
    }

    // Validate session
    if (!sessionId) {
      handleError('NO_SESSION');
      return { success: false, messageId: null, error: 'NO_SESSION' };
    }

    // Check handshake is complete
    if (!isHandshakeComplete(sessionId)) {
      handleError('NO_ENCRYPTION_KEY');
      return { success: false, messageId: null, error: 'NO_ENCRYPTION_KEY' };
    }

    // Get AES key
    const aesKey = getAESKey(sessionId);
    if (!aesKey) {
      handleError('NO_ENCRYPTION_KEY');
      return { success: false, messageId: null, error: 'NO_ENCRYPTION_KEY' };
    }

    // Generate message ID
    const messageId = generateMessageId();
    const timestamp = Date.now();

    try {
      // Encrypt message with session binding
      const encrypted = await encryptMessage(aesKey, text, sessionId);

      // Add to pending
      pendingMessagesRef.current.set(messageId, { text, timestamp });

      // Add to local messages with 'sending' status
      const localMessage: DecryptedMessage = {
        id: messageId,
        sessionId,
        fromUserId: userId,
        content: text,
        timestamp,
        status: 'sending',
        isOwn: true,
      };
      setMessages(prev => [...prev, localMessage]);

      // Send to server
      publish(SEND_MESSAGE_DESTINATION, {
        sessionId,
        messageId,
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        timestamp,
      });

      return { success: true, messageId, error: null };

    } catch (err) {
      console.error('[useMessages] Encryption failed:', err);
      handleError('ENCRYPTION_FAILED', err instanceof Error ? err.message : 'Unknown error');
      return { success: false, messageId: null, error: 'ENCRYPTION_FAILED' };
    }
  }, [isConnected, sessionId, userId, publish, handleError]);

  // ============================================
  // Decryption (4.2.6)
  // ============================================

  /**
   * Handle incoming encrypted message.
   */
  const handleNewMessage = useCallback(async (message: IMessage) => {
    try {
      const event: NewMessageEvent = JSON.parse(message.body);

      if (!event.success) {
        console.warn('[useMessages] Received error event:', event.error);
        return;
      }

      // Ignore messages for other sessions
      if (event.sessionId !== sessionId) {
        return;
      }

      // Check if we have the decryption key
      const aesKey = getAESKey(sessionId);
      if (!aesKey) {
        handleError('NO_ENCRYPTION_KEY', 'Cannot decrypt message - no AES key');
        return;
      }

      try {
        // Decrypt message with session binding
        const plaintext = await decryptMessage(
          aesKey,
          event.encryptedContent,
          event.iv,
          sessionId
        );

        // Create decrypted message object
        const decryptedMessage: DecryptedMessage = {
          id: event.messageId,
          sessionId: event.sessionId,
          fromUserId: event.senderId,
          content: plaintext,
          timestamp: event.clientTimestamp || new Date(event.serverTimestamp).getTime(),
          status: 'delivered',
          isOwn: event.senderId === userId,
        };

        // Add to messages (avoid duplicates)
        setMessages(prev => {
          const exists = prev.some(m => m.id === event.messageId);
          if (exists) return prev;
          return [...prev, decryptedMessage];
        });

        // Notify callback
        onNewMessage?.(decryptedMessage);

      } catch (decryptErr) {
        console.error('[useMessages] Decryption failed:', decryptErr);
        handleError('DECRYPTION_FAILED', decryptErr instanceof Error ? decryptErr.message : 'Unknown error');
      }

    } catch (parseErr) {
      console.error('[useMessages] Failed to parse message:', parseErr);
    }
  }, [sessionId, userId, onNewMessage, handleError]);

  /**
   * Handle message sent acknowledgment.
   */
  const handleMessageSent = useCallback((message: IMessage) => {
    try {
      const event: MessageSentEvent = JSON.parse(message.body);

      // Ignore events for other sessions
      if (event.sessionId !== sessionId) {
        return;
      }

      // Remove from pending
      pendingMessagesRef.current.delete(event.messageId);

      if (event.success) {
        // Update message status
        const newStatus: MessageStatus = event.delivered ? 'delivered' : 'sent';

        setMessages(prev => prev.map(msg =>
          msg.id === event.messageId
            ? { ...msg, status: newStatus }
            : msg
        ));

        onStatusChange?.(event.messageId, newStatus);
      } else {
        // Message failed
        console.error('[useMessages] Message send failed:', event.error);

        setMessages(prev => prev.map(msg =>
          msg.id === event.messageId
            ? { ...msg, status: 'failed' }
            : msg
        ));

        onStatusChange?.(event.messageId, 'failed');

        // Map server error to client error code
        const errorCode = mapServerError(event.error);
        handleError(errorCode, event.error);
      }

    } catch (parseErr) {
      console.error('[useMessages] Failed to parse message-sent event:', parseErr);
    }
  }, [sessionId, onStatusChange, handleError]);

  // ============================================
  // Retry Failed Message
  // ============================================

  /**
   * Retry sending a failed message.
   */
  const retryMessage = useCallback(async (messageId: string): Promise<SendMessageResult> => {
    const message = messages.find(m => m.id === messageId);
    if (!message || message.status !== 'failed') {
      return { success: false, messageId, error: 'INTERNAL_ERROR' };
    }

    // Remove failed message
    setMessages(prev => prev.filter(m => m.id !== messageId));

    // Resend
    return sendMessage(message.content);
  }, [messages, sendMessage]);

  // ============================================
  // Clear Messages
  // ============================================

  /**
   * Clear all local messages.
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    pendingMessagesRef.current.clear();
    setError(null);
  }, []);

  // ============================================
  // Subscriptions
  // ============================================

  useEffect(() => {
    if (!isConnected || !sessionId) {
      return;
    }

    // Subscribe to new messages
    subscribe(NEW_MESSAGE_DESTINATION, handleNewMessage);

    // Subscribe to message sent acknowledgments
    subscribe(MESSAGE_SENT_DESTINATION, handleMessageSent);

    return () => {
      unsubscribe(NEW_MESSAGE_DESTINATION);
      unsubscribe(MESSAGE_SENT_DESTINATION);
    };
  }, [isConnected, sessionId, subscribe, unsubscribe, handleNewMessage, handleMessageSent]);

  // ============================================
  // Cleanup on Session Change
  // ============================================

  useEffect(() => {
    // Clear messages when session changes
    return () => {
      clearMessages();
    };
  }, [sessionId, clearMessages]);

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
    retryMessage,
    error,
  };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Generate a unique message ID.
 */
function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `msg-${timestamp}-${random}`;
}

/**
 * Map server error to client error code.
 */
function mapServerError(serverError?: string): MessageErrorCode {
  if (!serverError) return 'INTERNAL_ERROR';

  const errorMap: Record<string, MessageErrorCode> = {
    'SESSION_NOT_FOUND': 'NO_SESSION',
    'NOT_PARTICIPANT': 'NO_SESSION',
    'SESSION_NOT_ACTIVE': 'SESSION_NOT_ACTIVE',
    'SESSION_PENDING': 'SESSION_NOT_ACTIVE',
    'SESSION_HANDSHAKE': 'NO_ENCRYPTION_KEY',
    'SESSION_BURNED': 'SESSION_BURNED',
    'SESSION_EXPIRED': 'SESSION_NOT_ACTIVE',
    'QUEUE_FAILED': 'SEND_FAILED',
    'INTERNAL_ERROR': 'INTERNAL_ERROR',
  };

  return errorMap[serverError] || 'INTERNAL_ERROR';
}
