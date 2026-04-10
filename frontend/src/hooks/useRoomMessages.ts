import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { encryptMessage, decryptMessage } from '@/crypto/aes';
import { encryptFileMetadata, decryptFileMetadata } from '@/crypto/fileEncryption';
import { getGroupKey } from '@/crypto/keyStore';
import { downloadThumbnail } from '@/services/fileDownloadService';
import { enqueueUpload, cancelAll } from '@/services/transferQueue';
import { FileTransferError, fileTransferErrorI18nKey } from '@/services/fileTransferErrors';
import { validateFileForUpload } from '@/utils/fileValidation';
import { fileValidationToastParams } from '@/utils/fileValidationI18n';
import type {
  DecryptedMessage,
  DecryptedFileMessage,
  FileMetadata,
  MessageStatus,
  MessageType,
} from '@/types';

// ============================================
// STOMP destinations
// ============================================

const SEND_ROOM_MESSAGE_DESTINATION = '/app/room.message.send';
const ROOM_MESSAGE_SENT_DESTINATION = '/user/queue/room-message-sent';
const SYNC_ROOM_MESSAGES_DESTINATION = '/app/room.message.sync';
const SYNC_ROOM_MESSAGES_RESULT_DESTINATION = '/user/queue/room-sync-messages';

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
  type?: string;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
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
  type?: string;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
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

/** Options for file message sending */
export interface SendRoomFileOptions {
  onProgress?: (percent: number) => void;
  onEncryptProgress?: (percent: number) => void;
  signal?: AbortSignal;
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
  onError?: (error: RoomMessageErrorCode, details?: string, i18nValues?: Record<string, string | number>) => void;
}

/** Hook return value */
export interface UseRoomMessagesReturn {
  messages: DecryptedMessage[];
  isLoading: boolean;
  isSyncing: boolean;
  sendMessage: (text: string) => Promise<SendRoomMessageResult>;
  sendFileMessage: (file: File, caption?: string, options?: SendRoomFileOptions) => Promise<SendRoomMessageResult>;
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

  const handleError = useCallback((code: RoomMessageErrorCode, details?: string, i18nValues?: Record<string, string | number>) => {
    setError(code);
    onError?.(code, details, i18nValues);
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
        type: 'text',
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
  // File Message Sending (P4-3-2-2)
  // ============================================

  const sendFileMessage = useCallback(async (
    file: File,
    caption?: string,
    options?: SendRoomFileOptions,
  ): Promise<SendRoomMessageResult> => {
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

    const validated = validateFileForUpload(file);
    if (!validated.ok) {
      handleError('SEND_FAILED', validated.errorKey, fileValidationToastParams(validated));
      return { success: false, messageId: null, error: 'SEND_FAILED' };
    }

    const messageId = generateMessageId();
    const timestamp = Date.now();
    const messageType = validated.messageType;

    try {
      const uploadHandle = enqueueUpload({
        file,
        key: groupKey,
        context: { type: 'room', id: roomId },
        onProgress: options?.onProgress,
        onEncryptProgress: options?.onEncryptProgress,
        signal: options?.signal,
      });
      const uploadResult = await uploadHandle.result;

      const encryptedMeta = await encryptFileMetadata(
        { fileName: file.name, mimeType: validated.resolvedMime },
        groupKey,
      );

      const encrypted = await encryptMessage(groupKey, caption || '', roomId);

      pendingMessagesRef.current.set(messageId, { text: caption || '', timestamp });

      const localMessage: DecryptedFileMessage = {
        id: messageId,
        sessionId: roomId,
        fromUserId: userId,
        content: caption || fileContentPlaceholder(messageType, file.name),
        timestamp,
        status: 'sending',
        isOwn: true,
        type: messageType,
        fileId: uploadResult.fileId,
        thumbnailFileId: uploadResult.thumbnailFileId,
        thumbnailUrl: uploadResult.thumbnailDataUrl,
        fileSize: uploadResult.size,
        fileMeta: { fileName: file.name, mimeType: validated.resolvedMime },
      };
      setMessages(prev => [...prev, localMessage].sort((a, b) => a.timestamp - b.timestamp));

      publish(SEND_ROOM_MESSAGE_DESTINATION, {
        roomId,
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

      return { success: true, messageId, error: null };

    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { success: false, messageId: null, error: 'SEND_FAILED' };
      }
      if (err instanceof FileTransferError && err.kind === 'aborted') {
        return { success: false, messageId: null, error: 'SEND_FAILED' };
      }
      if (err instanceof FileTransferError) {
        handleError('SEND_FAILED', fileTransferErrorI18nKey(err));
        return { success: false, messageId: null, error: 'SEND_FAILED' };
      }
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      handleError('SEND_FAILED', errMsg);
      return { success: false, messageId: null, error: 'SEND_FAILED' };
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
        const ts = toEpochMs(event.clientTimestamp, event.serverTimestamp);
        const eventType = toMessageType(event.type);
        const isFileMsg = eventType !== 'text' && !!event.fileId;

        let decryptedMsg: DecryptedMessage;

        if (isFileMsg) {
          decryptedMsg = await decryptRoomFileEvent(
            event, groupKey, roomId, userId, ts, eventType,
          );
        } else {
          const plaintext = await decryptMessage(groupKey, event.encryptedContent, event.iv, roomId);
          decryptedMsg = {
            id: event.messageId,
            sessionId: roomId,
            fromUserId: event.senderTgId,
            senderName: event.senderName ?? undefined,
            content: plaintext,
            timestamp: ts,
            status: 'delivered',
            isOwn: event.senderTgId === userId,
            type: 'text',
          };
        }

        setMessages(prev => {
          const existingIndex = prev.findIndex(m => m.id === event.messageId);
          if (existingIndex !== -1) {
            const existing = prev[existingIndex];
            if (existing.status === 'sending') {
              const updated = [...prev];
              updated[existingIndex] = { ...existing, status: 'sent' as MessageStatus };
              return updated;
            }
            return prev;
          }
          return [...prev, decryptedMsg].sort((a, b) => a.timestamp - b.timestamp);
        });

        onNewMessage?.(decryptedMsg);
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
          const ts = toEpochMs(syncedMsg.clientTimestamp, syncedMsg.serverTimestamp);
          const msgType = toMessageType(syncedMsg.type);
          const isFileMsg = msgType !== 'text' && !!syncedMsg.fileId;

          if (isFileMsg) {
            const fileMsg = await decryptSyncedRoomFileMessage(
              syncedMsg, groupKey, roomId, userId, ts, msgType,
            );
            decryptedMessages.push(fileMsg);
          } else {
            const plaintext = await decryptMessage(groupKey, syncedMsg.encryptedContent, syncedMsg.iv, roomId);
            decryptedMessages.push({
              id: syncedMsg.messageId,
              sessionId: roomId,
              fromUserId: syncedMsg.senderTgId,
              senderName: syncedMsg.senderName ?? undefined,
              content: plaintext,
              timestamp: ts,
              status: 'delivered',
              isOwn: syncedMsg.senderTgId === userId,
              type: 'text',
            });
          }
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
    cancelAll();
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

  return { messages, isLoading, isSyncing, sendMessage, sendFileMessage, clearMessages, error };
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

// ============================================
// File Message Helpers (P4-3-2-2 / P4-3-2-3)
// ============================================

function toMessageType(raw?: string): MessageType {
  if (raw === 'image' || raw === 'video' || raw === 'file') return raw;
  return 'text';
}

function fileContentPlaceholder(type: MessageType, fileName?: string): string {
  const name = fileName || 'file';
  switch (type) {
    case 'image': return `📷 ${name}`;
    case 'video': return `🎬 ${name}`;
    case 'file':  return `📎 ${name}`;
    default:      return name;
  }
}

async function decryptRoomFileEvent(
  event: NewRoomMessageEvent,
  groupKey: CryptoKey,
  roomId: string,
  userId: number,
  timestamp: number,
  messageType: MessageType,
): Promise<DecryptedMessage> {
  let caption = '';
  try {
    caption = await decryptMessage(groupKey, event.encryptedContent, event.iv, roomId);
  } catch {
    // Caption may be empty-encrypted
  }

  let fileMeta: FileMetadata | undefined;
  if (event.encryptedMeta) {
    try {
      fileMeta = await decryptFileMetadata(event.encryptedMeta, groupKey);
    } catch (err) {
      console.error('[useRoomMessages] Failed to decrypt file metadata:', err);
    }
  }

  let thumbnailUrl: string | undefined;
  if (event.thumbnailFileId) {
    try {
      thumbnailUrl = await downloadThumbnail(event.thumbnailFileId, groupKey);
    } catch (err) {
      console.error('[useRoomMessages] Failed to download thumbnail:', err);
    }
  }

  const content = caption || fileContentPlaceholder(messageType, fileMeta?.fileName);

  const msg: DecryptedFileMessage = {
    id: event.messageId,
    sessionId: roomId,
    fromUserId: event.senderTgId,
    senderName: event.senderName ?? undefined,
    content,
    timestamp,
    status: 'delivered',
    isOwn: event.senderTgId === userId,
    type: messageType as 'image' | 'video' | 'file',
    fileId: event.fileId!,
    fileSize: event.fileSize ?? 0,
    fileMeta: fileMeta ?? { fileName: 'unknown', mimeType: 'application/octet-stream' },
    thumbnailFileId: event.thumbnailFileId,
    thumbnailUrl,
  };

  return msg;
}

async function decryptSyncedRoomFileMessage(
  syncedMsg: SyncedRoomMessage,
  groupKey: CryptoKey,
  roomId: string,
  userId: number,
  timestamp: number,
  messageType: MessageType,
): Promise<DecryptedMessage> {
  let caption = '';
  try {
    caption = await decryptMessage(groupKey, syncedMsg.encryptedContent, syncedMsg.iv, roomId);
  } catch {
    // No caption
  }

  let fileMeta: FileMetadata | undefined;
  if (syncedMsg.encryptedMeta) {
    try {
      fileMeta = await decryptFileMetadata(syncedMsg.encryptedMeta, groupKey);
    } catch (err) {
      console.error('[useRoomMessages] Failed to decrypt synced file metadata:', err);
    }
  }

  let thumbnailUrl: string | undefined;
  if (syncedMsg.thumbnailFileId) {
    try {
      thumbnailUrl = await downloadThumbnail(syncedMsg.thumbnailFileId, groupKey);
    } catch (err) {
      console.error('[useRoomMessages] Failed to download synced thumbnail:', err);
    }
  }

  const content = caption || fileContentPlaceholder(messageType, fileMeta?.fileName);

  const msg: DecryptedFileMessage = {
    id: syncedMsg.messageId,
    sessionId: roomId,
    fromUserId: syncedMsg.senderTgId,
    senderName: syncedMsg.senderName ?? undefined,
    content,
    timestamp,
    status: 'delivered',
    isOwn: syncedMsg.senderTgId === userId,
    type: messageType as 'image' | 'video' | 'file',
    fileId: syncedMsg.fileId!,
    fileSize: syncedMsg.fileSize ?? 0,
    fileMeta: fileMeta ?? { fileName: 'unknown', mimeType: 'application/octet-stream' },
    thumbnailFileId: syncedMsg.thumbnailFileId,
    thumbnailUrl,
  };

  return msg;
}
