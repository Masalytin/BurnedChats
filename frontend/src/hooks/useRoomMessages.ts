import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { encryptMessage, decryptMessage } from '@/crypto/aes';
import { encryptFileMetadata, decryptFileMetadata } from '@/crypto/fileEncryption';
import { getGroupKey } from '@/crypto/keyStore';
import { downloadThumbnail } from '@/services/fileDownloadService';
import { enqueueUpload, cancelAll } from '@/services/transferQueue';
import { FileTransferError, fileTransferErrorI18nKey } from '@/services/fileTransferErrors';
import { validateFileForUpload } from '@/utils/fileValidation';
import { fileValidationToastParams } from '@/utils/fileValidationI18n';
import { enrichReplyTo } from '@/utils/replyPreview';
import { isWithinEditWindow } from '@/utils/editWindow';
import i18n from '@/i18n';
import type {
  DecryptedMessage,
  DecryptedFileMessage,
  FileMetadata,
  MessageStatus,
  MessageType,
} from '@/types';
import { useMessageSync } from '@/hooks/useMessageSync';
import { useHiddenMessages } from '@/hooks/useHiddenMessages';
import type { ChatWebSocketApi } from '@/hooks/useWebSocket';

// ============================================
// STOMP destinations
// ============================================

const SEND_ROOM_MESSAGE_DESTINATION = '/app/room.message.send';
const ROOM_MESSAGE_SENT_DESTINATION = '/user/queue/room-message-sent';
const SYNC_ROOM_MESSAGES_DESTINATION = '/app/room.message.sync';
const SYNC_ROOM_MESSAGES_RESULT_DESTINATION = '/user/queue/room-sync-messages';
const ROOM_MESSAGE_EDITED_USER_DESTINATION = '/user/queue/room-message-edited';
const EDIT_ROOM_MESSAGE_DESTINATION = '/app/room.message.edit';
const DELETE_ROOM_MESSAGE_DESTINATION = '/app/room.message.delete';
const ROOM_MESSAGE_DELETED_USER_DESTINATION = '/user/queue/room-message-deleted';

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
  replyToMessageId?: string;
  eventType?: string;
}

/** Room message sent acknowledgment from server */
interface RoomMessageSentEvent {
  success: boolean;
  roomId: string;
  messageId: string;
  serverTimestamp: string;
  error?: string;
}

/** Room message edit broadcast / user-queue error */
interface RoomMessageEditedEventPayload {
  eventType?: string;
  success: boolean;
  roomId: string;
  messageId: string;
  senderTgId?: number;
  senderName?: string | null;
  encryptedContent?: string;
  iv?: string;
  editedAt?: string;
  type?: string;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
  errorCode?: string;
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
  replyToMessageId?: string;
  editedAt?: string | null;
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
  replyToMessageId?: string;
}

/** WebSocket interface (same shape as DM — see {@link ChatWebSocketApi}) */
export type UseRoomMessagesWebSocket = ChatWebSocketApi;

/** Hook options */
interface UseRoomMessagesOptions {
  roomId: string;
  userId: number;
  ws: UseRoomMessagesWebSocket;
  isReconnection?: boolean;
  onNewMessage?: (message: DecryptedMessage) => void;
  onError?: (error: RoomMessageErrorCode, details?: string, i18nValues?: Record<string, string | number>) => void;
  onEditError?: (errorCode: string) => void;
  /** Another member's message was removed by the room owner. */
  onMessageDeletedByOwner?: () => void;
}

/** Hook return value */
export interface UseRoomMessagesReturn {
  messages: DecryptedMessage[];
  isLoading: boolean;
  isSyncing: boolean;
  sendMessage: (text: string, options?: { replyToMessageId?: string }) => Promise<SendRoomMessageResult>;
  sendFileMessage: (file: File, caption?: string, options?: SendRoomFileOptions) => Promise<SendRoomMessageResult>;
  clearMessages: () => void;
  hideMessages: (ids: string | string[]) => void;
  /** Manually trigger sync of offline/missed room messages (FIX-SYNC-3). */
  syncMessages: () => void;
  error: RoomMessageErrorCode | null;
  editMessage: (
    messageId: string,
    newText: string,
    originalClientTimestamp: number,
  ) => Promise<{ success: boolean; errorCode?: string }>;
  /** Delete for everyone (own message, or room owner can delete any). */
  deleteMessage: (messageId: string) => Promise<{
    success: boolean;
    errorCode?: string;
  }>;
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
  const { roomId, userId, ws, onNewMessage, onError, onEditError, onMessageDeletedByOwner } = options;
  const { hiddenIds, hide: hideMessages } = useHiddenMessages('room', roomId);
  const { isConnected, isReconnection: wsIsReconnection, subscribe, unsubscribe, publish } = ws;
  // Accept isReconnection from top-level options (explicit) or from the ws object
  const effectiveIsReconnection = options.isReconnection ?? wsIsReconnection ?? false;

  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const visibleMessages = useMemo(
    () =>
      messages
        .filter((m) => !hiddenIds.has(m.id))
        .map((m) => enrichReplyTo(m, messages, i18n.t.bind(i18n))),
    [messages, hiddenIds],
  );
  const [isLoading] = useState(false);
  const [error, setError] = useState<RoomMessageErrorCode | null>(null);

  const pendingMessagesRef = useRef<Map<string, { text: string; timestamp: number }>>(new Map());

  // Stable handler refs to avoid re-subscriptions on callback identity changes
  const handleNewMessageRef = useRef<(message: IMessage) => void>(() => {});
  const handleMessageSentRef = useRef<(message: IMessage) => void>(() => {});
  const handleSyncMessagesRef = useRef<(message: IMessage) => void>(() => {});
  const handleRoomMessageEditedUserRef = useRef<(message: IMessage) => void>(() => {});
  const handleRoomMessageDeleteUserRef = useRef<(message: IMessage) => void>(() => {});
  const pendingRoomDeleteResolversRef = useRef(
    new Map<string, (r: { success: boolean; errorCode?: string }) => void>(),
  );

  // ============================================
  // Error Handling
  // ============================================

  const handleError = useCallback((code: RoomMessageErrorCode, details?: string, i18nValues?: Record<string, string | number>) => {
    setError(code);
    onError?.(code, details, i18nValues);
    console.error(`[useRoomMessages] Error: ${code}`, details);
  }, [onError]);

  const canSyncRoom = useCallback(() => Boolean(getGroupKey(roomId)), [roomId]);

  const doPublishInitialSync = useCallback(() => {
    publish(SYNC_ROOM_MESSAGES_DESTINATION, {
      roomId,
    });
  }, [roomId, publish]);

  const doPublishReconnectSync = useCallback(() => {
    publish(SYNC_ROOM_MESSAGES_DESTINATION, {
      roomId,
    });
  }, [roomId, publish]);

  const messageSync = useMessageSync({
    scopeId: roomId,
    isConnected,
    isReconnection: effectiveIsReconnection,
    canSync: canSyncRoom,
    doPublishInitialSync,
    doPublishReconnectSync,
  });
  const { isSyncing, setSyncing, triggerSyncIfReady, runReconnectIfNeeded } = messageSync;

  // ============================================
  // Send Message
  // ============================================

  const sendMessage = useCallback(async (
    text: string,
    options?: { replyToMessageId?: string },
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

    const messageId = generateMessageId();
    const timestamp = Date.now();
    const replyToMessageId = options?.replyToMessageId;

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
        replyToMessageId,
      };
      // senderName is intentionally omitted for own messages (own messages don't show sender label)
      setMessages(prev => [...prev, localMessage].sort((a, b) => a.timestamp - b.timestamp));

      publish(SEND_ROOM_MESSAGE_DESTINATION, {
        roomId,
        messageId,
        encryptedContent: encrypted.ciphertext,
        iv: encrypted.iv,
        timestamp,
        ...(replyToMessageId ? { replyToMessageId } : {}),
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
    const replyToMessageId = options?.replyToMessageId;

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
        replyToMessageId,
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
        ...(replyToMessageId ? { replyToMessageId } : {}),
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

  const deleteMessage = useCallback(
    (messageId: string) => {
      if (!isConnected || !roomId) {
        return Promise.resolve({ success: false, errorCode: 'NOT_CONNECTED' });
      }
      return new Promise<{ success: boolean; errorCode?: string }>(resolve => {
        pendingRoomDeleteResolversRef.current.set(messageId, resolve);
        publish(DELETE_ROOM_MESSAGE_DESTINATION, { roomId, messageId });
        window.setTimeout(() => {
          if (pendingRoomDeleteResolversRef.current.has(messageId)) {
            pendingRoomDeleteResolversRef.current.delete(messageId);
            resolve({ success: false, errorCode: 'INTERNAL_ERROR' });
          }
        }, 15_000);
      });
    },
    [isConnected, roomId, publish],
  );

  const editMessage = useCallback(
    async (
      messageId: string,
      newText: string,
      originalClientTimestamp: number,
    ): Promise<{ success: boolean; errorCode?: string }> => {
      setError(null);
      if (!isConnected) {
        return { success: false, errorCode: 'NOT_CONNECTED' };
      }
      if (!roomId) {
        return { success: false, errorCode: 'NO_ROOM' };
      }
      const groupKey = getGroupKey(roomId);
      if (!groupKey) {
        return { success: false, errorCode: 'NO_GROUP_KEY' };
      }
      if (!isWithinEditWindow(originalClientTimestamp)) {
        return { success: false, errorCode: 'WINDOW_EXPIRED' };
      }
      try {
        const encrypted = await encryptMessage(groupKey, newText, roomId);
        publish(EDIT_ROOM_MESSAGE_DESTINATION, {
          roomId,
          messageId,
          encryptedContent: encrypted.ciphertext,
          iv: encrypted.iv,
          editedAt: Date.now(),
          originalClientTimestamp,
        });
        return { success: true };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        handleError('ENCRYPTION_FAILED', errMsg);
        return { success: false, errorCode: 'ENCRYPTION_FAILED' };
      }
    },
    [isConnected, roomId, publish, handleError],
  );

  // ============================================
  // Receive Message Handler
  // ============================================

  const handleNewMessage = useCallback(async (message: IMessage) => {
    try {
      const event = JSON.parse(message.body) as NewRoomMessageEvent & Partial<RoomMessageEditedEventPayload>;
      if (event.roomId !== roomId) return;

      if (event.eventType === 'ROOM_MESSAGE_DELETED') {
        const del = event as unknown as {
          success?: boolean;
          messageId: string;
          deletedByTgId?: number;
          deletedByOwner?: boolean;
        };
        if (!del.messageId || del.success === false) {
          return;
        }
        setMessages(prev => prev.filter(m => m.id !== del.messageId));
        const finish = pendingRoomDeleteResolversRef.current.get(del.messageId);
        if (finish) {
          pendingRoomDeleteResolversRef.current.delete(del.messageId);
          finish({ success: true });
        }
        if (del.deletedByOwner && del.deletedByTgId !== userId) {
          onMessageDeletedByOwner?.();
        }
        return;
      }

      if (event.eventType === 'ROOM_MESSAGE_EDITED') {
        const edit = event as unknown as RoomMessageEditedEventPayload;
        if (!edit.success || !edit.messageId) {
          return;
        }
        const groupKey = getGroupKey(roomId);
        const encContent = edit.encryptedContent;
        const encIv = edit.iv;
        if (!groupKey || !encContent || !encIv) {
          handleError('NO_GROUP_KEY', 'Cannot apply room message edit');
          return;
        }
        const editedAtMs = edit.editedAt
          ? new Date(edit.editedAt).getTime()
          : Date.now();
        setMessages((prev) => {
          const existing = prev.find(m => m.id === edit.messageId);
          const keepTs = existing?.timestamp ?? Date.now();
          const eventType = toMessageType(edit.type);
          const isFileMsg = eventType !== 'text' && !!edit.fileId;
          void (async () => {
            try {
              if (isFileMsg) {
                const fileMsg = await decryptRoomFileEvent(
                  {
                    roomId: edit.roomId,
                    messageId: edit.messageId,
                    senderTgId: edit.senderTgId ?? 0,
                    senderName: edit.senderName,
                    encryptedContent: encContent,
                    iv: encIv,
                    clientTimestamp: keepTs,
                    type: edit.type,
                    fileId: edit.fileId,
                    thumbnailFileId: edit.thumbnailFileId,
                    encryptedMeta: edit.encryptedMeta,
                    fileSize: edit.fileSize,
                  } as NewRoomMessageEvent,
                  groupKey,
                  roomId,
                  userId,
                  keepTs,
                  eventType,
                  undefined,
                );
                setMessages(p => p.map(m =>
                  m.id === edit.messageId
                    ? { ...fileMsg, timestamp: m.timestamp, editedAt: editedAtMs }
                    : m
                ));
              } else {
                const plaintext = await decryptMessage(
                  groupKey,
                  encContent,
                  encIv,
                  roomId,
                );
                setMessages(p => p.map(m =>
                  m.id === edit.messageId
                    ? { ...m, content: plaintext, editedAt: editedAtMs }
                    : m
                ));
              }
            } catch (e) {
              console.error('[useRoomMessages] room edit decrypt:', e);
              handleError('DECRYPTION_FAILED', e instanceof Error ? e.message : 'Unknown error');
            }
          })();
          return prev;
        });
        return;
      }

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
            event, groupKey, roomId, userId, ts, eventType, event.replyToMessageId || undefined,
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
            replyToMessageId: event.replyToMessageId || undefined,
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
  }, [roomId, userId, onNewMessage, handleError, onMessageDeletedByOwner]);

  const handleRoomMessageEditedUser = useCallback(
    (message: IMessage) => {
      try {
        const event: RoomMessageEditedEventPayload = JSON.parse(message.body);
        if (event.roomId !== roomId) {
          return;
        }
        if (event.success === false) {
          onEditError?.(event.errorCode ?? 'INTERNAL_ERROR');
        }
      } catch (e) {
        console.error('[useRoomMessages] room-message-edited user queue', e);
      }
    },
    [roomId, onEditError],
  );

  const handleRoomMessageDeleteUser = useCallback(
    (message: IMessage) => {
      try {
        const event = JSON.parse(message.body) as {
          roomId: string;
          messageId: string;
          success: boolean;
          errorCode?: string;
        };
        if (event.roomId !== roomId) {
          return;
        }
        if (event.success) {
          return;
        }
        const finish = pendingRoomDeleteResolversRef.current.get(event.messageId);
        if (finish) {
          pendingRoomDeleteResolversRef.current.delete(event.messageId);
          finish({ success: false, errorCode: event.errorCode ?? 'NOT_ALLOWED' });
        }
      } catch (e) {
        console.error('[useRoomMessages] room-message-deleted user queue', e);
      }
    },
    [roomId],
  );

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

      setSyncing(false);

      if (!event.success) return;

      const serverList = event.messages ?? [];
      const groupKey = getGroupKey(roomId);
      if (serverList.length > 0 && !groupKey) {
        handleError('NO_GROUP_KEY', 'Cannot decrypt synced room messages — no group key');
        return;
      }

      // Full server list for the room: replace delivered messages, keep only local in-flight (sending / failed)
      if (serverList.length === 0) {
        setMessages(prev => prev
          .filter(m => m.status === 'sending' || m.status === 'failed')
          .sort((a, b) => a.timestamp - b.timestamp),
        );
        return;
      }

      const decryptedMessages: DecryptedMessage[] = [];
      for (const syncedMsg of serverList) {
        try {
          const ts = toEpochMs(syncedMsg.clientTimestamp, syncedMsg.serverTimestamp);
          const msgType = toMessageType(syncedMsg.type);
          const isFileMsg = msgType !== 'text' && !!syncedMsg.fileId;

          if (isFileMsg) {
            const fileMsg = await decryptSyncedRoomFileMessage(
              syncedMsg, groupKey!, roomId, userId, ts, msgType, editedAtFromServerIso(syncedMsg.editedAt),
            );
            decryptedMessages.push(fileMsg);
          } else {
            const plaintext = await decryptMessage(groupKey!, syncedMsg.encryptedContent, syncedMsg.iv, roomId);
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
              replyToMessageId: syncedMsg.replyToMessageId || undefined,
              editedAt: editedAtFromServerIso(syncedMsg.editedAt),
            });
          }
        } catch (decryptErr) {
          console.error('[useRoomMessages] Failed to decrypt synced message:', decryptErr);
        }
      }

      if (serverList.length > 0 && decryptedMessages.length === 0) {
        return;
      }

      const serverIdSet = new Set(decryptedMessages.map(m => m.id));
      setMessages(prev => {
        const localInFlight = prev.filter(
          m => (m.status === 'sending' || m.status === 'failed') && !serverIdSet.has(m.id),
        );
        return [...decryptedMessages, ...localInFlight].sort((a, b) => a.timestamp - b.timestamp);
      });
    } catch (parseErr) {
      console.error('[useRoomMessages] Failed to parse sync event:', parseErr);
      setSyncing(false);
    }
  }, [roomId, userId, handleError, setSyncing]);

  // Keep handler refs up to date
  useEffect(() => {
    handleNewMessageRef.current = handleNewMessage;
    handleMessageSentRef.current = handleMessageSent;
    handleSyncMessagesRef.current = handleSyncMessages;
    handleRoomMessageEditedUserRef.current = handleRoomMessageEditedUser;
    handleRoomMessageDeleteUserRef.current = handleRoomMessageDeleteUser;
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
    const onRoomEditUser = (msg: IMessage) => handleRoomMessageEditedUserRef.current(msg);
    const onRoomDeleteUser = (msg: IMessage) => handleRoomMessageDeleteUserRef.current(msg);

    subscribe(roomTopic, onNewMsg);
    subscribe(ROOM_MESSAGE_SENT_DESTINATION, onMsgSent);
    subscribe(SYNC_ROOM_MESSAGES_RESULT_DESTINATION, onSyncResult);
    subscribe(ROOM_MESSAGE_EDITED_USER_DESTINATION, onRoomEditUser);
    subscribe(ROOM_MESSAGE_DELETED_USER_DESTINATION, onRoomDeleteUser);

    triggerSyncIfReady('subscription');

    return () => {
      unsubscribe(roomTopic);
      unsubscribe(ROOM_MESSAGE_SENT_DESTINATION);
      unsubscribe(SYNC_ROOM_MESSAGES_RESULT_DESTINATION);
      unsubscribe(ROOM_MESSAGE_EDITED_USER_DESTINATION);
      unsubscribe(ROOM_MESSAGE_DELETED_USER_DESTINATION);
    };
  // Intentionally exclude subscribe/unsubscribe/publish (stable from parent); re-run on room connection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, roomId, triggerSyncIfReady]);

  useEffect(() => {
    if (!isConnected || !roomId || !effectiveIsReconnection) {
      return;
    }
    if (!getGroupKey(roomId)) {
      return;
    }
    runReconnectIfNeeded();
  }, [isConnected, roomId, effectiveIsReconnection, runReconnectIfNeeded]);

  // Cleanup on room change
  useEffect(() => {
    return () => {
      clearMessages();
    };
  }, [roomId, clearMessages]);

  // ============================================
  // Manual sync (FIX-SYNC-3)
  // ============================================

  /**
   * Request offline/missed room messages from the server.
   *
   * Used by AppContent to re-sync when the Mini App returns from background.
   * Safe to call multiple times — server returns an empty list once the queue
   * is drained (queue is deleted on sync).
   */
  const syncMessages = useCallback(() => {
    if (!isConnected || !roomId) return;
    if (!getGroupKey(roomId)) return;

    setSyncing(true);
    // Full offline queue drain — server returns all pending room messages and clears the queue.
    publish(SYNC_ROOM_MESSAGES_DESTINATION, {
      roomId,
    });
  }, [isConnected, roomId, publish, setSyncing]);

  return {
    messages: visibleMessages,
    isLoading,
    isSyncing,
    sendMessage,
    sendFileMessage,
    clearMessages,
    hideMessages,
    syncMessages,
    error,
    editMessage,
    deleteMessage,
  };
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

function editedAtFromServerIso(iso?: string | null): number | undefined {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : undefined;
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
  replyToMessageId?: string,
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
    replyToMessageId,
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
  editedAt?: number,
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
    replyToMessageId: syncedMsg.replyToMessageId || undefined,
    ...(editedAt != null ? { editedAt } : {}),
  };

  return msg;
}
