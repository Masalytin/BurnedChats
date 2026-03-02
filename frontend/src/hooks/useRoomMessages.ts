import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { encryptMessage, decryptMessage } from '@/crypto/aes';
import { getGroupKey } from '@/crypto/keyStore';
import type { DecryptedMessage, MessageStatus } from '@/types';

// ============================================
// STOMP destinations
// ============================================

const SEND_ROOM_MESSAGE_DESTINATION = '/app/room.message.send';
const ROOM_MESSAGE_SENT_DESTINATION = '/user/queue/room-message-sent';
const SYNC_ROOM_MESSAGES_DESTINATION = '/app/room.message.sync';
const SYNC_ROOM_MESSAGES_RESULT_DESTINATION = '/user/queue/sync-room-messages';

function getRoomTopic(roomId: string): string {
  return `/topic/room/${roomId}`;
}

// ============================================
// Types
// ============================================

/** New room message event from server */
interface NewRoomMessageEvent {
  roomId: string;
  messageId: string;
  senderTgId: number;
  senderName?: string | null;
  encryptedContent: string;
  iv: string;
  clientTimestamp?: number | null;
  serverTimestamp?: string;
}

/** Room message sent acknowledgment from server */
interface RoomMessageSentEvent {
  success: boolean;
  roomId: string;
  messageId: string;
  serverTimestamp: string;
  error?: string;
}

/** Synced room message */
interface SyncedRoomMessage {
  messageId: string;
  senderTgId: number;
  senderName?: string | null;
  encryptedContent: string;
  iv: string;
  clientTimestamp?: number | null;
  serverTimestamp?: string;
}

/** Sync room messages response */
interface SyncRoomMessagesEvent {
  success: boolean;
  roomId: string;
  messages: SyncedRoomMessage[];
  count: number;
  serverTimestamp: string;
  error?: string;
}

/** Room message error codes */
export type RoomMessageErrorCode =
  | 'NOT_CONNECTED'
  | 'NO_ROOM'
  | 'NO_GROUP_KEY'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'SEND_FAILED'
  | 'INTERNAL_ERROR';

/** Send message result */
export interface SendRoomMessageResult {
  success: boolean;
  messageId: string | null;
  error: RoomMessageErrorCode | null;
}

/** WebSocket interface (reused from useMessages pattern) */
export interface UseRoomMessagesWebSocket {
  isConnected: boolean;
  /** True when this is a reconnection (not the first connect) */
  isReconnection?: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

/** Hook options */
interface UseRoomMessagesOptions {
  roomId: string;
  userId: number;
  ws: UseRoomMessagesWebSocket;
  isReconnection?: boolean;
  onNewMessage?: (message: DecryptedMessage) => void;
  onError?: (error: RoomMessageErrorCode, details?: string) => void;
}

/** Hook return value */
export interface UseRoomMessagesReturn {
  messages: DecryptedMessage[];
  isLoading: boolean;
  isSyncing: boolean;
  sendMessage: (text: string) => Promise<SendRoomMessageResult>;
  clearMessages: () => void;
  error: RoomMessageErrorCode | null;
}

// ============================================
// Hook Implementation
// ============================================

/**
 * Hook for encrypted room message exchange (P2-4.2.2).
 *
 * Subscribes to the room's STOMP topic, handles encryption/decryption
 * using the group AES key stored in keyStore, and sends SEND_ROOM_MESSAGE.
 *
 * Encryption context: roomId is used as AAD (additional authenticated data),
 * consistent with how sessionId is used for 1-on-1 chats.
 */
export function useRoomMessages(options: UseRoomMessagesOptions): UseRoomMessagesReturn {
  const { roomId, userId, ws, onNewMessage, onError } = options;
  const { isConnected, isReconnection: wsIsReconnection, subscribe, unsubscribe, publish } = ws;
  // Accept isReconnection from top-level options (explicit) or from the ws object
  const isReconnection = options.isReconnection ?? wsIsReconnection;

  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [isLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<RoomMessageErrorCode | null>(null);

  const pendingMessagesRef = useRef<Map<string, { text: string; timestamp: number }>>(new Map());
  const syncTriggeredRef = useRef(false);

  // Stable handler refs to avoid re-subscriptions on callback identity changes
  const handleNewMessageRef = useRef<(message: IMessage) => void>(() => {});
  const handleMessageSentRef = useRef<(message: IMessage) => void>(() => {});
  const handleSyncMessagesRef = useRef<(message: IMessage) => void>(() => {});

  // ============================================
  // Error Handling
  // ============================================

  const handleError = useCallback((code: RoomMessageErrorCode, details?: string) => {
    setError(code);
    onError?.(code, details);
    console.error(`[useRoomMessages] Error: ${code}`, details);
  }, [onError]);

  // ============================================
  // Send Message
  // ============================================

  const sendMessage = useCallback(async (text: string): Promise<SendRoomMessageResult> => {
    setError(null);

    if (!isConnected) {
      handleError('NOT_CONNECTED');
      return { success: false, messageId: null, error: 'NOT_CONNECTED' };
    }

    if (!roomId) {
      handleError('NO_ROOM');
      return { success: false, messageId: null, error: 'NO_ROOM' };
    }

    const groupKey = getGroupKey(roomId);
    if (!groupKey) {
      handleError('NO_GROUP_KEY');
      return { success: false, messageId: null, error: 'NO_GROUP_KEY' };
    }

    const messageId = generateMessageId();
    const timestamp = Date.now();

    try {
      const encrypted = await encryptMessage(groupKey, text, roomId);

      pendingMessagesRef.current.set(messageId, { text, timestamp });

      const localMessage: DecryptedMessage = {
        id: messageId,
        sessionId: roomId,
        fromUserId: userId,
        content: text,
        timestamp,
        status: 'sending',
        isOwn: true,
      };
      // senderName is intentionally omitted for own messages (own messages don't show sender label)
      setMessages(prev => [...prev, localMessage].sort((a, b) => a.timestamp - b.timestamp));

      publish(SEND_ROOM_MESSAGE_DESTINATION, {
        roomId,
        messageId,
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        timestamp,
      });

      return { success: true, messageId, error: null };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      handleError('ENCRYPTION_FAILED', errMsg);
      return { success: false, messageId: null, error: 'ENCRYPTION_FAILED' };
    }
  }, [isConnected, roomId, userId, publish, handleError]);

  // ============================================
  // Receive Message Handler
  // ============================================

  const handleNewMessage = useCallback(async (message: IMessage) => {
    try {
      const event: NewRoomMessageEvent = JSON.parse(message.body);

      if (event.roomId !== roomId) return;

      const groupKey = getGroupKey(roomId);
      if (!groupKey) {
        handleError('NO_GROUP_KEY', 'Cannot decrypt room message — no group key');
        return;
      }

      try {
        const plaintext = await decryptMessage(groupKey, event.encryptedContent, event.iv, roomId);
        const ts = toEpochMs(event.clientTimestamp, event.serverTimestamp);

        const decryptedMessage: DecryptedMessage = {
          id: event.messageId,
          sessionId: roomId,
          fromUserId: event.senderTgId,
          senderName: event.senderName ?? undefined,
          content: plaintext,
          timestamp: ts,
          status: 'delivered',
          isOwn: event.senderTgId === userId,
        };

        setMessages(prev => {
          const exists = prev.some(m => m.id === event.messageId);
          if (exists) return prev;
          return [...prev, decryptedMessage].sort((a, b) => a.timestamp - b.timestamp);
        });

        onNewMessage?.(decryptedMessage);
      } catch (decryptErr) {
        console.error('[useRoomMessages] Decryption failed:', decryptErr);
        handleError('DECRYPTION_FAILED', decryptErr instanceof Error ? decryptErr.message : 'Unknown error');
      }
    } catch (parseErr) {
      console.error('[useRoomMessages] Failed to parse message:', parseErr);
    }
  }, [roomId, userId, onNewMessage, handleError]);

  // ============================================
  // Message Sent Acknowledgment Handler
  // ============================================

  const handleMessageSent = useCallback((message: IMessage) => {
    try {
      const event: RoomMessageSentEvent = JSON.parse(message.body);

      if (event.roomId !== roomId) return;

      pendingMessagesRef.current.delete(event.messageId);

      if (event.success) {
        setMessages(prev => prev.map(msg =>
          msg.id === event.messageId ? { ...msg, status: 'sent' as MessageStatus } : msg
        ));
      } else {
        console.error('[useRoomMessages] Room message send failed:', event.error);
        setMessages(prev => prev.map(msg =>
          msg.id === event.messageId ? { ...msg, status: 'failed' as MessageStatus } : msg
        ));
        handleError('SEND_FAILED', event.error);
      }
    } catch (parseErr) {
      console.error('[useRoomMessages] Failed to parse room-message-sent event:', parseErr);
    }
  }, [roomId, handleError]);

  // ============================================
  // Sync Messages Handler
  // ============================================

  const handleSyncMessages = useCallback(async (message: IMessage) => {
    try {
      const event: SyncRoomMessagesEvent = JSON.parse(message.body);

      if (event.roomId !== roomId) return;

      setIsSyncing(false);

      if (!event.success || event.count === 0) return;

      const groupKey = getGroupKey(roomId);
      if (!groupKey) {
        handleError('NO_GROUP_KEY', 'Cannot decrypt synced room messages — no group key');
        return;
      }

      const decryptedMessages: DecryptedMessage[] = [];
      for (const syncedMsg of event.messages) {
        try {
          const plaintext = await decryptMessage(groupKey, syncedMsg.encryptedContent, syncedMsg.iv, roomId);
          const ts = toEpochMs(syncedMsg.clientTimestamp, syncedMsg.serverTimestamp);
          decryptedMessages.push({
            id: syncedMsg.messageId,
            sessionId: roomId,
            fromUserId: syncedMsg.senderTgId,
            senderName: syncedMsg.senderName ?? undefined,
            content: plaintext,
            timestamp: ts,
            status: 'delivered',
            isOwn: syncedMsg.senderTgId === userId,
          });
        } catch (decryptErr) {
          console.error('[useRoomMessages] Failed to decrypt synced message:', decryptErr);
        }
      }

      if (decryptedMessages.length > 0) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMessages = decryptedMessages.filter(m => !existingIds.has(m.id));
          if (newMessages.length === 0) return prev;
          return [...prev, ...newMessages].sort((a, b) => a.timestamp - b.timestamp);
        });
      }
    } catch (parseErr) {
      console.error('[useRoomMessages] Failed to parse sync event:', parseErr);
      setIsSyncing(false);
    }
  }, [roomId, userId, handleError]);

  // Keep handler refs up to date
  useEffect(() => {
    handleNewMessageRef.current = handleNewMessage;
    handleMessageSentRef.current = handleMessageSent;
    handleSyncMessagesRef.current = handleSyncMessages;
  });

  // ============================================
  // Clear Messages
  // ============================================

  const clearMessages = useCallback(() => {
    setMessages([]);
    pendingMessagesRef.current.clear();
    setError(null);
  }, []);

  // ============================================
  // Subscriptions + Initial Sync
  // ============================================

  useEffect(() => {
    if (!isConnected || !roomId) return;

    const roomTopic = getRoomTopic(roomId);

    const onNewMsg = (msg: IMessage) => handleNewMessageRef.current(msg);
    const onMsgSent = (msg: IMessage) => handleMessageSentRef.current(msg);
    const onSyncResult = (msg: IMessage) => handleSyncMessagesRef.current(msg);

    subscribe(roomTopic, onNewMsg);
    subscribe(ROOM_MESSAGE_SENT_DESTINATION, onMsgSent);
    subscribe(SYNC_ROOM_MESSAGES_RESULT_DESTINATION, onSyncResult);

    // Request offline messages on subscribe
    const groupKey = getGroupKey(roomId);
    if (groupKey) {
      setIsSyncing(true);
      publish(SYNC_ROOM_MESSAGES_DESTINATION, {
        roomId,
        lastMessageTimestamp: null,
      });
    }

    return () => {
      unsubscribe(roomTopic);
      unsubscribe(ROOM_MESSAGE_SENT_DESTINATION);
      unsubscribe(SYNC_ROOM_MESSAGES_RESULT_DESTINATION);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, roomId]);

  // ============================================
  // Auto-sync on Reconnection
  // ============================================

  useEffect(() => {
    if (!isConnected || !roomId || !isReconnection) return;
    if (syncTriggeredRef.current) return;

    const groupKey = getGroupKey(roomId);
    if (!groupKey) return;

    syncTriggeredRef.current = true;
    setIsSyncing(true);

    const lastMessage = messages[messages.length - 1];
    publish(SYNC_ROOM_MESSAGES_DESTINATION, {
      roomId,
      lastMessageTimestamp: lastMessage?.timestamp ?? null,
    });
  }, [isConnected, roomId, isReconnection, messages, publish]);

  // Reset sync flag when room changes or when disconnected (so each reconnect can re-sync)
  useEffect(() => {
    syncTriggeredRef.current = false;
  }, [roomId]);

  useEffect(() => {
    if (!isConnected) {
      syncTriggeredRef.current = false;
    }
  }, [isConnected]);

  // Cleanup on room change
  useEffect(() => {
    return () => {
      clearMessages();
    };
  }, [roomId, clearMessages]);

  return { messages, isLoading, isSyncing, sendMessage, clearMessages, error };
}

// ============================================
// Utility Functions
// ============================================

function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `room-msg-${timestamp}-${random}`;
}

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
