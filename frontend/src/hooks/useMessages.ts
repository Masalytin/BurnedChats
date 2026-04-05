import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { encryptMessage, decryptMessage } from '@/crypto/aes';
import { encryptFileMetadata, decryptFileMetadata } from '@/crypto/fileEncryption';
import { getAESKey, isHandshakeComplete, getDebugInfo } from '@/crypto/keyStore';
import { uploadFile } from '@/services/fileUploadService';
import { downloadThumbnail } from '@/services/fileDownloadService';
import { FileTransferError, fileTransferErrorI18nKey } from '@/services/fileTransferErrors';
import { validateFileForUpload } from '@/utils/fileValidation';
import { fileValidationToastParams } from '@/utils/fileValidationI18n';
import type { DecryptedMessage, DecryptedFileMessage, FileMetadata, MessageStatus, MessageType } from '@/types';
import { debugLog } from '@/components/DebugPanel';

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

/** New message event from server (matches backend NewMessageEvent) */
interface NewMessageEvent {
  success: boolean;
  sessionId: string;
  messageId: string;
  senderId: number;
  encryptedContent: string;
  iv: string;
  /** Client epoch ms; may be null if omitted */
  clientTimestamp?: number | null;
  /** Server time ISO-8601 string */
  serverTimestamp?: string;
  error?: string;
  /** Message type: text, image, video, or file */
  type?: string;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
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

/** Synced message from server (5.1.2, matches SyncMessagesEvent.SyncedMessage) */
interface SyncedMessage {
  messageId: string;
  senderId: number;
  encryptedContent: string;
  iv: string;
  clientTimestamp?: number | null;
  serverTimestamp?: string;
  type?: string;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
}

/** Sync messages event from server (5.1.2) */
interface SyncMessagesEvent {
  success: boolean;
  sessionId: string;
  messages: SyncedMessage[];
  count: number;
  serverTimestamp: string;
  error?: string;
}

/** WebSocket API passed from parent (must use same connection as app) */
export interface UseMessagesWebSocket {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

/** Options for file message sending */
export interface SendFileOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** Hook options */
interface UseMessagesOptions {
  /** Session ID to listen for messages */
  sessionId: string;
  /** Current user's Telegram ID */
  userId: number;
  /** WebSocket connection from app (required – use same instance as AppContent) */
  ws: UseMessagesWebSocket;
  /** Whether WebSocket is a reconnection (5.1.2) */
  isReconnection?: boolean;
  /** Callback when new message arrives */
  onNewMessage?: (message: DecryptedMessage) => void;
  /** Callback when message status changes */
  onStatusChange?: (messageId: string, status: MessageStatus) => void;
  /** Callback when error occurs */
  onError?: (error: MessageErrorCode, details?: string, i18nValues?: Record<string, string | number>) => void;
  /** Callback when messages are synced after reconnection (5.1.2) */
  onSyncComplete?: (count: number) => void;
}

/** Hook return value */
interface UseMessagesReturn {
  /** List of decrypted messages */
  messages: DecryptedMessage[];
  /** Whether messages are loading */
  isLoading: boolean;
  /** Whether sync is in progress (5.1.2) */
  isSyncing: boolean;
  /** Send a new text message */
  sendMessage: (text: string) => Promise<SendMessageResult>;
  /** Send a file message (image, video, or document) with optional caption */
  sendFileMessage: (file: File, caption?: string, options?: SendFileOptions) => Promise<SendMessageResult>;
  /** Clear all messages (local only) */
  clearMessages: () => void;
  /** Retry failed message */
  retryMessage: (messageId: string) => Promise<SendMessageResult>;
  /** Manually trigger message sync (5.1.2) */
  syncMessages: () => void;
  /** Current error */
  error: MessageErrorCode | null;
}

// ============================================
// Constants
// ============================================

const NEW_MESSAGE_DESTINATION = '/user/queue/new-message';
const MESSAGE_SENT_DESTINATION = '/user/queue/message-sent';
const SEND_MESSAGE_DESTINATION = '/app/message.send';
const SYNC_MESSAGES_DESTINATION = '/app/message.sync';
const SYNC_MESSAGES_RESULT_DESTINATION = '/user/queue/sync-messages';

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
 * function ChatView({ sessionId, userId, ws }: Props) {
 *   const { messages, sendMessage, isLoading } = useMessages({
 *     sessionId,
 *     userId,
 *     ws,
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
  const { sessionId, userId, ws, isReconnection, onNewMessage, onStatusChange, onError, onSyncComplete } = options;
  const { isConnected, subscribe, unsubscribe, publish } = ws;

  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [isLoading, _setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<MessageErrorCode | null>(null);

  // Pending messages waiting for acknowledgment
  const pendingMessagesRef = useRef<Map<string, { text: string; timestamp: number }>>(new Map());
  // Track if sync has been triggered for this session/reconnection
  const syncTriggeredRef = useRef(false);
  // Refs for handlers so subscription effect doesn't re-run on handler identity change (avoids missing messages)
  const handleNewMessageRef = useRef<(message: IMessage) => void>(() => {});
  const handleMessageSentRef = useRef<(message: IMessage) => void>(() => {});
  const handleSyncMessagesRef = useRef<(message: IMessage) => void>(() => {});

  // ============================================
  // Error Handling
  // ============================================

  const handleError = useCallback((code: MessageErrorCode, details?: string, i18nValues?: Record<string, string | number>) => {
    setError(code);
    onError?.(code, details, i18nValues);
    console.error(`[useMessages] Error: ${code}`, details);
  }, [onError]);

  // ============================================
  // Encryption (4.2.5)
  // ============================================

  /**
   * Encrypt and send a message.
   */
  const sendMessage = useCallback(async (text: string): Promise<SendMessageResult> => {
    // Clear previous error before attempting to send
    setError(null);

    const keyStoreInfo = getDebugInfo();
    const handshakeComplete = isHandshakeComplete(sessionId);
    debugLog('info', 'sendMessage called', {
      textPreview: text.substring(0, 20) + (text.length > 20 ? '...' : ''),
      sessionId,
      isConnected,
      handshakeComplete,
      keyStoreSessionCount: keyStoreInfo.sessionCount,
    });
    console.log('[useMessages] sendMessage called', {
      text: text.substring(0, 20) + (text.length > 20 ? '...' : ''),
      sessionId,
      isConnected,
      handshakeComplete,
      keyStoreSessionIds: keyStoreInfo.sessionIds,
      keyStoreSessionCount: keyStoreInfo.sessionCount,
    });

    // Validate connection
    if (!isConnected) {
      debugLog('error', 'Send blocked: not connected to WebSocket');
      console.error('[useMessages] Not connected to WebSocket');
      handleError('NOT_CONNECTED');
      return { success: false, messageId: null, error: 'NOT_CONNECTED' };
    }

    // Validate session
    if (!sessionId) {
      debugLog('error', 'Send blocked: no session ID');
      console.error('[useMessages] No session ID');
      handleError('NO_SESSION');
      return { success: false, messageId: null, error: 'NO_SESSION' };
    }

    // Check handshake is complete
    if (!handshakeComplete) {
      debugLog('error', 'Send blocked: handshake not complete', {
        sessionId,
        hint: 'Complete handshake and click "Continue to Chat"',
      });
      console.error('[useMessages] Send blocked: handshake not complete for session:', sessionId, '(user may need to complete handshake and click "Continue to Chat")');
      handleError('NO_ENCRYPTION_KEY');
      return { success: false, messageId: null, error: 'NO_ENCRYPTION_KEY' };
    }

    // Get AES key
    const aesKey = getAESKey(sessionId);
    if (!aesKey) {
      debugLog('error', 'Send blocked: no AES key for session', { sessionId });
      console.error('[useMessages] No AES key found for session:', sessionId);
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

      // Add to local messages with 'sending' status, keep sorted by timestamp
      const localMessage: DecryptedMessage = {
        id: messageId,
        sessionId,
        fromUserId: userId,
        content: text,
        timestamp,
        status: 'sending',
        isOwn: true,
        type: 'text',
      };
      setMessages(prev => [...prev, localMessage].sort((a, b) => a.timestamp - b.timestamp));

      // Send to server
      debugLog('success', 'Message sent to server', { messageId, sessionId });
      console.log('[useMessages] Sending message to server', { messageId, sessionId });
      publish(SEND_MESSAGE_DESTINATION, {
        sessionId,
        messageId,
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        timestamp,
      });

      console.log('[useMessages] Message published successfully', { messageId });
      return { success: true, messageId, error: null };

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      debugLog('error', 'Message encryption failed', { error: errMsg });
      console.error('[useMessages] Encryption failed:', err);
      handleError('ENCRYPTION_FAILED', errMsg);
      return { success: false, messageId: null, error: 'ENCRYPTION_FAILED' };
    }
  }, [isConnected, sessionId, userId, publish, handleError]);

  // ============================================
  // File Message Sending (P4-3-2-1)
  // ============================================

  /**
   * Encrypt and send a file message (image, video, or document).
   */
  const sendFileMessage = useCallback(async (
    file: File,
    caption?: string,
    options?: SendFileOptions,
  ): Promise<SendMessageResult> => {
    setError(null);

    if (!isConnected) {
      handleError('NOT_CONNECTED');
      return { success: false, messageId: null, error: 'NOT_CONNECTED' };
    }

    if (!sessionId) {
      handleError('NO_SESSION');
      return { success: false, messageId: null, error: 'NO_SESSION' };
    }

    if (!isHandshakeComplete(sessionId)) {
      handleError('NO_ENCRYPTION_KEY');
      return { success: false, messageId: null, error: 'NO_ENCRYPTION_KEY' };
    }

    const aesKey = getAESKey(sessionId);
    if (!aesKey) {
      handleError('NO_ENCRYPTION_KEY');
      return { success: false, messageId: null, error: 'NO_ENCRYPTION_KEY' };
    }

    const validated = validateFileForUpload(file);
    if (!validated.ok) {
      handleError('SEND_FAILED', validated.errorKey, fileValidationToastParams(validated));
      return { success: false, messageId: null, error: 'SEND_FAILED' };
    }

    const messageId = generateMessageId();
    const timestamp = Date.now();
    const messageType = validated.messageType;

    try {
      const uploadResult = await uploadFile(
        file,
        aesKey,
        { type: 'session', id: sessionId },
        { onProgress: options?.onProgress, signal: options?.signal },
      );

      const encryptedMeta = await encryptFileMetadata(
        { fileName: file.name, mimeType: validated.resolvedMime },
        aesKey,
      );

      const encrypted = await encryptMessage(aesKey, caption || '', sessionId);

      pendingMessagesRef.current.set(messageId, { text: caption || '', timestamp });

      const localMessage: DecryptedMessage = {
        id: messageId,
        sessionId,
        fromUserId: userId,
        content: caption || fileContentPlaceholder(messageType, file.name),
        timestamp,
        status: 'sending',
        isOwn: true,
        type: messageType,
        fileId: uploadResult.fileId,
        thumbnailFileId: uploadResult.thumbnailFileId,
        fileSize: uploadResult.size,
      };
      setMessages(prev => [...prev, localMessage].sort((a, b) => a.timestamp - b.timestamp));

      publish(SEND_MESSAGE_DESTINATION, {
        sessionId,
        messageId,
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        timestamp,
        type: messageType,
        fileId: uploadResult.fileId,
        thumbnailFileId: uploadResult.thumbnailFileId,
        encryptedMeta,
        fileSize: uploadResult.size,
      });

      debugLog('success', 'File message sent', { messageId, sessionId, type: messageType });
      return { success: true, messageId, error: null };

    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { success: false, messageId: null, error: 'SEND_FAILED' };
      }
      if (err instanceof FileTransferError && err.kind === 'aborted') {
        return { success: false, messageId: null, error: 'SEND_FAILED' };
      }
      if (err instanceof FileTransferError) {
        const key = fileTransferErrorI18nKey(err);
        debugLog('error', 'File message send failed', { kind: err.kind, key });
        handleError('SEND_FAILED', key);
        return { success: false, messageId: null, error: 'SEND_FAILED' };
      }
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      debugLog('error', 'File message send failed', { error: errMsg });
      handleError('SEND_FAILED', errMsg);
      return { success: false, messageId: null, error: 'SEND_FAILED' };
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
        const ts = toEpochMs(event.clientTimestamp, event.serverTimestamp);
        const eventType = toMessageType(event.type);
        const isFileMsg = eventType !== 'text' && !!event.fileId;

        let decryptedMsg: DecryptedMessage;

        if (isFileMsg) {
          decryptedMsg = await decryptFileEvent(
            event, aesKey, sessionId, userId, ts, eventType,
          );
        } else {
          const plaintext = await decryptMessage(
            aesKey,
            event.encryptedContent,
            event.iv,
            sessionId,
          );

          decryptedMsg = {
            id: event.messageId,
            sessionId: event.sessionId,
            fromUserId: event.senderId,
            content: plaintext,
            timestamp: ts,
            status: 'delivered',
            isOwn: event.senderId === userId,
            type: 'text',
          };
        }

        setMessages(prev => {
          const exists = prev.some(m => m.id === event.messageId);
          if (exists) return prev;
          return [...prev, decryptedMsg].sort((a, b) => a.timestamp - b.timestamp);
        });

        onNewMessage?.(decryptedMsg);

      } catch (decryptErr) {
        console.error('[useMessages] Decryption failed:', decryptErr);
        handleError('DECRYPTION_FAILED', decryptErr instanceof Error ? decryptErr.message : 'Unknown error');
      }

    } catch (parseErr) {
      console.error('[useMessages] Failed to parse message:', parseErr);
    }
  }, [sessionId, userId, onNewMessage, handleError]);

  /**
   * Handle synced messages response (5.1.2).
   */
  const handleSyncMessages = useCallback(async (message: IMessage) => {
    try {
      const event: SyncMessagesEvent = JSON.parse(message.body);
      
      // Ignore events for other sessions
      if (event.sessionId !== sessionId) {
        return;
      }

      setIsSyncing(false);

      if (!event.success) {
        console.warn('[useMessages] Sync failed:', event.error);
        return;
      }

      if (event.count === 0) {
        console.log('[useMessages] No messages to sync');
        onSyncComplete?.(0);
        return;
      }

      // Get AES key for decryption
      const aesKey = getAESKey(sessionId);
      if (!aesKey) {
        handleError('NO_ENCRYPTION_KEY', 'Cannot decrypt synced messages - no AES key');
        return;
      }

      // Decrypt all synced messages
      const decryptedMessages: DecryptedMessage[] = [];
      
      for (const syncedMsg of event.messages) {
        try {
          const ts = toEpochMs(syncedMsg.clientTimestamp, syncedMsg.serverTimestamp);
          const msgType = toMessageType(syncedMsg.type);
          const isFileMsg = msgType !== 'text' && !!syncedMsg.fileId;

          if (isFileMsg) {
            const fileMsg = await decryptSyncedFileMessage(
              syncedMsg, aesKey, sessionId, userId, ts, msgType,
            );
            decryptedMessages.push(fileMsg);
          } else {
            const plaintext = await decryptMessage(
              aesKey,
              syncedMsg.encryptedContent,
              syncedMsg.iv,
              sessionId,
            );

            decryptedMessages.push({
              id: syncedMsg.messageId,
              sessionId,
              fromUserId: syncedMsg.senderId,
              content: plaintext,
              timestamp: ts,
              status: 'delivered',
              isOwn: syncedMsg.senderId === userId,
              type: 'text',
            });
          }
        } catch (decryptErr) {
          console.error('[useMessages] Failed to decrypt synced message:', decryptErr);
        }
      }

      // Add synced messages (avoid duplicates)
      if (decryptedMessages.length > 0) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMessages = decryptedMessages.filter(m => !existingIds.has(m.id));
          
          if (newMessages.length === 0) return prev;
          
          // Sort by timestamp
          const allMessages = [...prev, ...newMessages].sort((a, b) => a.timestamp - b.timestamp);
          return allMessages;
        });

        // Notify callbacks
        decryptedMessages.forEach(msg => onNewMessage?.(msg));
      }

      console.log(`[useMessages] Synced ${decryptedMessages.length} messages`);
      onSyncComplete?.(decryptedMessages.length);

    } catch (parseErr) {
      console.error('[useMessages] Failed to parse sync event:', parseErr);
      setIsSyncing(false);
    }
  }, [sessionId, userId, onNewMessage, onSyncComplete, handleError]);

  /**
   * Trigger message sync (5.1.2).
   */
  const syncMessages = useCallback(() => {
    if (!isConnected || !sessionId) {
      console.warn('[useMessages] Cannot sync - not connected or no session');
      return;
    }

    if (!isHandshakeComplete(sessionId)) {
      console.warn('[useMessages] Cannot sync - handshake not complete');
      return;
    }

    setIsSyncing(true);
    
    // Get timestamp of last message for incremental sync
    const lastMessage = messages[messages.length - 1];
    
    publish(SYNC_MESSAGES_DESTINATION, {
      sessionId,
      lastMessageTimestamp: lastMessage?.timestamp || null,
    });

    console.log('[useMessages] Sync request sent');
  }, [isConnected, sessionId, messages, publish]);

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

  // Keep handler refs up to date so subscription callbacks always use latest logic
  useEffect(() => {
    handleNewMessageRef.current = handleNewMessage;
    handleMessageSentRef.current = handleMessageSent;
    handleSyncMessagesRef.current = handleSyncMessages;
  });

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

    // Stable wrappers: call current handler from ref so we don't unsubscribe on handler identity change
    const onNewMessage = (message: IMessage) => handleNewMessageRef.current(message);
    const onMessageSent = (message: IMessage) => handleMessageSentRef.current(message);
    const onSyncResult = (message: IMessage) => handleSyncMessagesRef.current(message);

    subscribe(NEW_MESSAGE_DESTINATION, onNewMessage);
    subscribe(MESSAGE_SENT_DESTINATION, onMessageSent);
    subscribe(SYNC_MESSAGES_RESULT_DESTINATION, onSyncResult);

    return () => {
      unsubscribe(NEW_MESSAGE_DESTINATION);
      unsubscribe(MESSAGE_SENT_DESTINATION);
      unsubscribe(SYNC_MESSAGES_RESULT_DESTINATION);
    };
  }, [isConnected, sessionId, subscribe, unsubscribe]);

  // ============================================
  // Auto-sync on Reconnection (5.1.2)
  // ============================================

  useEffect(() => {
    if (!isConnected || !sessionId || !isReconnection) {
      return;
    }

    // Only sync once per reconnection
    if (syncTriggeredRef.current) {
      return;
    }

    // Check if handshake is complete before syncing
    if (!isHandshakeComplete(sessionId)) {
      console.log('[useMessages] Skipping auto-sync - handshake not complete');
      return;
    }

    console.log('[useMessages] Auto-syncing messages after reconnection');
    syncTriggeredRef.current = true;
    syncMessages();
  }, [isConnected, sessionId, isReconnection, syncMessages]);

  // Reset sync flag when session changes
  useEffect(() => {
    syncTriggeredRef.current = false;
  }, [sessionId]);

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
    isSyncing,
    sendMessage,
    sendFileMessage,
    clearMessages,
    retryMessage,
    syncMessages,
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
 * Normalize timestamp from backend: client (epoch ms) or server (ISO string) to epoch ms.
 */
function toEpochMs(clientTimestamp?: number | null, serverTimestamp?: string): number {
  if (typeof clientTimestamp === 'number' && Number.isFinite(clientTimestamp) && clientTimestamp >= 0) {
    return clientTimestamp;
  }
  if (serverTimestamp) {
    const ms = new Date(serverTimestamp).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

// ============================================
// File Message Helpers (P4-3-2-1)
// ============================================

/**
 * Safely cast server type string to MessageType.
 */
function toMessageType(raw?: string): MessageType {
  if (raw === 'image' || raw === 'video' || raw === 'file') return raw;
  return 'text';
}

/**
 * Generate a placeholder content string for file messages without a caption.
 */
function fileContentPlaceholder(type: MessageType, fileName?: string): string {
  const name = fileName || 'file';
  switch (type) {
    case 'image': return `📷 ${name}`;
    case 'video': return `🎬 ${name}`;
    case 'file':  return `📎 ${name}`;
    default:      return name;
  }
}

/**
 * Decrypt a file-type NewMessageEvent into a DecryptedMessage (with file metadata).
 */
async function decryptFileEvent(
  event: NewMessageEvent,
  aesKey: CryptoKey,
  sessionId: string,
  userId: number,
  timestamp: number,
  messageType: MessageType,
): Promise<DecryptedMessage> {
  let caption = '';
  try {
    caption = await decryptMessage(aesKey, event.encryptedContent, event.iv, sessionId);
  } catch {
    // Caption may be empty-encrypted — this is expected for no-caption files
  }

  let fileMeta: FileMetadata | undefined;
  if (event.encryptedMeta) {
    try {
      fileMeta = await decryptFileMetadata(event.encryptedMeta, aesKey);
    } catch (err) {
      console.error('[useMessages] Failed to decrypt file metadata:', err);
    }
  }

  let thumbnailUrl: string | undefined;
  if (event.thumbnailFileId) {
    try {
      thumbnailUrl = await downloadThumbnail(event.thumbnailFileId, aesKey);
    } catch (err) {
      console.error('[useMessages] Failed to download thumbnail:', err);
    }
  }

  const content = caption || fileContentPlaceholder(messageType, fileMeta?.fileName);

  const msg: DecryptedFileMessage = {
    id: event.messageId,
    sessionId: event.sessionId,
    fromUserId: event.senderId,
    content,
    timestamp,
    status: 'delivered',
    isOwn: event.senderId === userId,
    type: messageType as 'image' | 'video' | 'file',
    fileId: event.fileId!,
    fileSize: event.fileSize ?? 0,
    fileMeta: fileMeta ?? { fileName: 'unknown', mimeType: 'application/octet-stream' },
    thumbnailFileId: event.thumbnailFileId,
    thumbnailUrl,
  };

  return msg;
}

/**
 * Decrypt a synced file message.
 */
async function decryptSyncedFileMessage(
  syncedMsg: SyncedMessage,
  aesKey: CryptoKey,
  sessionId: string,
  userId: number,
  timestamp: number,
  messageType: MessageType,
): Promise<DecryptedMessage> {
  let caption = '';
  try {
    caption = await decryptMessage(aesKey, syncedMsg.encryptedContent, syncedMsg.iv, sessionId);
  } catch {
    // No caption
  }

  let fileMeta: FileMetadata | undefined;
  if (syncedMsg.encryptedMeta) {
    try {
      fileMeta = await decryptFileMetadata(syncedMsg.encryptedMeta, aesKey);
    } catch (err) {
      console.error('[useMessages] Failed to decrypt synced file metadata:', err);
    }
  }

  let thumbnailUrl: string | undefined;
  if (syncedMsg.thumbnailFileId) {
    try {
      thumbnailUrl = await downloadThumbnail(syncedMsg.thumbnailFileId, aesKey);
    } catch (err) {
      console.error('[useMessages] Failed to download synced thumbnail:', err);
    }
  }

  const content = caption || fileContentPlaceholder(messageType, fileMeta?.fileName);

  const msg: DecryptedFileMessage = {
    id: syncedMsg.messageId,
    sessionId,
    fromUserId: syncedMsg.senderId,
    content,
    timestamp,
    status: 'delivered',
    isOwn: syncedMsg.senderId === userId,
    type: messageType as 'image' | 'video' | 'file',
    fileId: syncedMsg.fileId!,
    fileSize: syncedMsg.fileSize ?? 0,
    fileMeta: fileMeta ?? { fileName: 'unknown', mimeType: 'application/octet-stream' },
    thumbnailFileId: syncedMsg.thumbnailFileId,
    thumbnailUrl,
  };

  return msg;
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
