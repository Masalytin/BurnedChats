import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { encryptMessage } from '@/crypto/aes';
import { isWithinEditWindow } from '@/utils/editWindow';
import type { DecryptedMessage, DecryptedFileMessage, MessageStatus, MessageType } from '@/types';
import type { ChatWebSocketApi } from '@/hooks/useWebSocket';
import {
  useMessageCore,
  getEncryptionKey,
  toEpochMs,
  toMessageType,
  fileContentPlaceholder,
  editedAtFromServerIso,
  decryptWireFileMessage,
  decryptTextContent,
  sendEncryptedTextMessage,
  sendEncryptedFileMessage,
  createPendingDeletePromise,
  createPendingEditPromise,
  resolvePendingMessageAck,
  type FileMessageWireFields,
} from '@/hooks/useMessageCore';
import { serverFileRelayErrorI18nKey } from '@/services/fileTransferErrors';

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

const LOG_TAG = 'useRoomMessages';

// ============================================
// Types
// ============================================

interface RoomMessageOwnershipContext {
  userInternalId: string;
  userTelegramId: number | null;
}

function isOwnRoomMessage(
  ctx: RoomMessageOwnershipContext,
  senderInternalId?: string | null,
  senderTgId?: number | null,
): boolean {
  if (ctx.userInternalId && senderInternalId) {
    return senderInternalId === ctx.userInternalId;
  }
  if (ctx.userTelegramId != null && ctx.userTelegramId !== 0 && senderTgId != null) {
    return senderTgId === ctx.userTelegramId;
  }
  return false;
}

interface NewRoomMessageEvent extends FileMessageWireFields {
  roomId: string;
  senderInternalId?: string | null;
  senderTgId?: number | null;
  senderName?: string | null;
  clientTimestamp?: number | null;
  serverTimestamp?: string;
  eventType?: string;
}

interface RoomMessageSentEvent {
  success: boolean;
  roomId: string;
  messageId: string;
  serverTimestamp: string;
  error?: string;
}

interface RoomMessageEditedEventPayload {
  eventType?: string;
  success: boolean;
  roomId: string;
  messageId: string;
  senderInternalId?: string | null;
  senderTgId?: number | null;
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

interface SyncedRoomMessage extends FileMessageWireFields {
  senderInternalId?: string | null;
  senderTgId?: number | null;
  senderName?: string | null;
  clientTimestamp?: number | null;
  serverTimestamp?: string;
  editedAt?: string | null;
}

interface SyncRoomMessagesEvent {
  success: boolean;
  roomId: string;
  messages: SyncedRoomMessage[];
  count: number;
  serverTimestamp: string;
  error?: string;
}

export type RoomMessageErrorCode =
  | 'NOT_CONNECTED'
  | 'NO_ROOM'
  | 'NO_GROUP_KEY'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'SEND_FAILED'
  | 'INTERNAL_ERROR';

export interface SendRoomMessageResult {
  success: boolean;
  messageId: string | null;
  error: RoomMessageErrorCode | null;
}

export interface SendRoomFileOptions {
  onProgress?: (percent: number) => void;
  onEncryptProgress?: (percent: number) => void;
  signal?: AbortSignal;
  replyToMessageId?: string;
}

export type UseRoomMessagesWebSocket = ChatWebSocketApi;

interface UseRoomMessagesOptions {
  roomId: string;
  userId: number;
  userInternalId: string;
  ws: UseRoomMessagesWebSocket;
  isReconnection?: boolean;
  onNewMessage?: (message: DecryptedMessage) => void;
  onError?: (error: RoomMessageErrorCode, details?: string, i18nValues?: Record<string, string | number>) => void;
  onEditError?: (errorCode: string) => void;
  onMessageDeletedByOwner?: () => void;
}

export interface UseRoomMessagesReturn {
  messages: DecryptedMessage[];
  isLoading: boolean;
  isSyncing: boolean;
  sendMessage: (text: string, options?: { replyToMessageId?: string }) => Promise<SendRoomMessageResult>;
  sendFileMessage: (file: File, caption?: string, options?: SendRoomFileOptions) => Promise<SendRoomMessageResult>;
  clearMessages: () => void;
  hideMessages: (ids: string | string[]) => void;
  syncMessages: () => void;
  error: RoomMessageErrorCode | null;
  editMessage: (
    messageId: string,
    newText: string,
    originalClientTimestamp: number,
  ) => Promise<{ success: boolean; errorCode?: string }>;
  deleteMessage: (messageId: string) => Promise<{ success: boolean; errorCode?: string }>;
}

// ============================================
// Hook Implementation
// ============================================

export function useRoomMessages(options: UseRoomMessagesOptions): UseRoomMessagesReturn {
  const { roomId, userId, userInternalId, ws, onNewMessage, onError, onEditError, onMessageDeletedByOwner } = options;
  const ownershipCtx = useMemo(
    (): RoomMessageOwnershipContext => ({
      userInternalId,
      userTelegramId: userId !== 0 ? userId : null,
    }),
    [userInternalId, userId],
  );

  const { publish: wsPublish } = ws;

  const canSyncRoom = useCallback(
    () => Boolean(getEncryptionKey(roomId)),
    [roomId],
  );

  const doPublishSync = useCallback(() => {
    wsPublish(SYNC_ROOM_MESSAGES_DESTINATION, { roomId });
  }, [roomId, wsPublish]);

  const handleNewMessageRef = useRef<(message: IMessage) => void>(() => {});
  const handleMessageSentRef = useRef<(message: IMessage) => void>(() => {});
  const handleSyncMessagesRef = useRef<(message: IMessage) => void>(() => {});
  const handleRoomMessageEditedUserRef = useRef<(message: IMessage) => void>(() => {});
  const handleRoomMessageDeleteUserRef = useRef<(message: IMessage) => void>(() => {});

  const roomTopic = useMemo(() => getRoomTopic(roomId), [roomId]);

  const core = useMessageCore<RoomMessageErrorCode>({
    contextId: roomId,
    hiddenScope: 'room',
    logTag: LOG_TAG,
    ws,
    isReconnection: options.isReconnection,
    canSync: canSyncRoom,
    doPublishSync,
    onError,
    subscriptions: [
      { destination: roomTopic, handlerRef: handleNewMessageRef },
      { destination: ROOM_MESSAGE_SENT_DESTINATION, handlerRef: handleMessageSentRef },
      { destination: SYNC_ROOM_MESSAGES_RESULT_DESTINATION, handlerRef: handleSyncMessagesRef },
      { destination: ROOM_MESSAGE_EDITED_USER_DESTINATION, handlerRef: handleRoomMessageEditedUserRef },
      { destination: ROOM_MESSAGE_DELETED_USER_DESTINATION, handlerRef: handleRoomMessageDeleteUserRef },
    ],
    canAutoReconnectSync: () => Boolean(getEncryptionKey(roomId)),
  });

  const {
    messages,
    setMessages,
    visibleMessages,
    isLoading,
    error,
    setError,
    handleError,
    pendingMessagesRef,
    pendingDeleteResolversRef,
    pendingEditResolversRef,
    pendingEditTimeoutsRef,
    hideMessages,
    clearMessages,
    isSyncing,
    setSyncing,
    syncMessages: coreSyncMessages,
    isConnected,
    publish,
    getEncryptionKey: getRoomEncryptionKey,
  } = core;

  const buildFileMessage = useCallback((
    wire: FileMessageWireFields & { senderInternalId?: string | null; senderTgId?: number | null; senderName?: string | null },
    timestamp: number,
    messageType: MessageType,
    replyToMessageId?: string,
    editedAt?: number,
  ): Promise<DecryptedMessage> => {
    return decryptWireFileMessage({
      wire,
      contextId: roomId,
      timestamp,
      messageType,
      replyToMessageId,
      editedAt,
      logTag: LOG_TAG,
      buildBase: (base) => ({
        ...base,
        fromUserId: wire.senderTgId ?? 0,
        senderName: wire.senderName ?? undefined,
        isOwn: isOwnRoomMessage(ownershipCtx, wire.senderInternalId, wire.senderTgId),
      }),
    });
  }, [roomId, ownershipCtx]);

  const validateBeforeSend = useCallback((): RoomMessageErrorCode | null => {
    if (!isConnected) return 'NOT_CONNECTED';
    if (!roomId) return 'NO_ROOM';
    if (!getRoomEncryptionKey()) return 'NO_GROUP_KEY';
    return null;
  }, [isConnected, roomId, getRoomEncryptionKey]);

  const sendMessage = useCallback(async (
    text: string,
    sendOptions?: { replyToMessageId?: string },
  ): Promise<SendRoomMessageResult> => {
    return sendEncryptedTextMessage({
      text,
      contextId: roomId,
      logTag: LOG_TAG,
      isConnected,
      replyToMessageId: sendOptions?.replyToMessageId,
      sendDestination: SEND_ROOM_MESSAGE_DESTINATION,
      publish,
      handleError,
      setError,
      setMessages,
      pendingMessagesRef,
      buildLocalMessage: (messageId, timestamp, content, replyToMessageId) => ({
        id: messageId,
        sessionId: roomId,
        fromUserId: userId,
        content,
        timestamp,
        status: 'sending',
        isOwn: true,
        type: 'text',
        replyToMessageId,
      }),
      buildPublishPayload: ({ messageId, encryptedContent, iv, timestamp, replyToMessageId }) => ({
        roomId,
        messageId,
        encryptedContent,
        iv,
        timestamp,
        ...(replyToMessageId ? { replyToMessageId } : {}),
      }),
      validateBeforeSend,
      noKeyError: 'NO_GROUP_KEY',
      encryptionFailedError: 'ENCRYPTION_FAILED',
      messageIdPrefix: 'room-msg',
    });
  }, [
    roomId, isConnected, publish, handleError, setError, setMessages,
    pendingMessagesRef, userId, validateBeforeSend,
  ]);

  const sendFileMessage = useCallback(async (
    file: File,
    caption?: string,
    sendOptions?: SendRoomFileOptions,
  ): Promise<SendRoomMessageResult> => {
    return sendEncryptedFileMessage({
      file,
      caption,
      contextId: roomId,
      logTag: LOG_TAG,
      isConnected,
      uploadContext: { type: 'room', id: roomId },
      sendDestination: SEND_ROOM_MESSAGE_DESTINATION,
      publish,
      handleError,
      setError,
      setMessages,
      pendingMessagesRef,
      buildLocalFileMessage: (messageId, timestamp, messageType, uploadResult, f, resolvedMime, cap, replyToMessageId) => ({
        id: messageId,
        sessionId: roomId,
        fromUserId: userId,
        content: cap || fileContentPlaceholder(messageType, f.name),
        timestamp,
        status: 'sending',
        isOwn: true,
        type: messageType,
        fileId: uploadResult.fileId,
        thumbnailFileId: uploadResult.thumbnailFileId,
        thumbnailUrl: uploadResult.thumbnailDataUrl,
        fileSize: uploadResult.size,
        fileMeta: { fileName: f.name, mimeType: resolvedMime },
        replyToMessageId,
      } as DecryptedFileMessage),
      buildPublishPayload: (payload) => ({ roomId, ...payload }),
      validateBeforeSend,
      noKeyError: 'NO_GROUP_KEY',
      encryptionFailedError: 'ENCRYPTION_FAILED',
      sendFailedError: 'SEND_FAILED',
      messageIdPrefix: 'room-msg',
      onProgress: sendOptions?.onProgress,
      onEncryptProgress: sendOptions?.onEncryptProgress,
      signal: sendOptions?.signal,
      replyToMessageId: sendOptions?.replyToMessageId,
    });
  }, [
    roomId, isConnected, publish, handleError, setError, setMessages,
    pendingMessagesRef, userId, validateBeforeSend,
  ]);

  const applyRoomEditFromBroadcast = useCallback(async (edit: RoomMessageEditedEventPayload) => {
    if (!edit.success || !edit.messageId) return;
    if (!getRoomEncryptionKey() || !edit.encryptedContent || !edit.iv) {
      const resolved = resolvePendingMessageAck(
        pendingEditResolversRef,
        edit.messageId,
        { success: false, errorCode: 'NO_GROUP_KEY' },
        pendingEditTimeoutsRef,
      );
      if (!resolved) {
        handleError('NO_GROUP_KEY', 'Cannot apply room message edit');
      }
      return;
    }
    const editedAtMs = edit.editedAt ? new Date(edit.editedAt).getTime() : Date.now();
    const eventType = toMessageType(edit.type);
    const isFileMsg = eventType !== 'text' && !!edit.fileId;
    try {
      if (isFileMsg) {
        const existing = messages.find(m => m.id === edit.messageId);
        const keepTs = existing?.timestamp ?? Date.now();
        const fileMsg = await buildFileMessage(
          {
            messageId: edit.messageId,
            senderInternalId: edit.senderInternalId,
            senderTgId: edit.senderTgId ?? null,
            senderName: edit.senderName,
            encryptedContent: edit.encryptedContent,
            iv: edit.iv,
            type: edit.type,
            fileId: edit.fileId,
            thumbnailFileId: edit.thumbnailFileId,
            encryptedMeta: edit.encryptedMeta,
            fileSize: edit.fileSize,
          },
          keepTs,
          eventType,
        );
        setMessages(p => p.map(m =>
          m.id === edit.messageId
            ? { ...fileMsg, timestamp: m.timestamp, editedAt: editedAtMs }
            : m
        ));
      } else {
        const plaintext = await decryptTextContent(roomId, edit.encryptedContent, edit.iv);
        setMessages(p => p.map(m =>
          m.id === edit.messageId
            ? { ...m, content: plaintext, editedAt: editedAtMs }
            : m
        ));
      }
      resolvePendingMessageAck(
        pendingEditResolversRef,
        edit.messageId,
        { success: true },
        pendingEditTimeoutsRef,
      );
    } catch (e) {
      console.error('[useRoomMessages] room edit decrypt:', e);
      const resolved = resolvePendingMessageAck(
        pendingEditResolversRef,
        edit.messageId,
        { success: false, errorCode: 'INTERNAL_ERROR' },
        pendingEditTimeoutsRef,
      );
      if (!resolved) {
        handleError('DECRYPTION_FAILED', e instanceof Error ? e.message : 'Unknown error');
      }
    }
  }, [
    roomId, messages, getRoomEncryptionKey, handleError, setMessages,
    pendingEditResolversRef, pendingEditTimeoutsRef, buildFileMessage,
  ]);

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
        if (!del.messageId || del.success === false) return;
        setMessages(prev => prev.filter(m => m.id !== del.messageId));
        const finish = pendingDeleteResolversRef.current.get(del.messageId);
        if (finish) {
          pendingDeleteResolversRef.current.delete(del.messageId);
          finish({ success: true });
        }
        if (del.deletedByOwner && del.deletedByTgId !== userId && userId !== 0) {
          onMessageDeletedByOwner?.();
        }
        return;
      }

      if (event.eventType === 'ROOM_MESSAGE_EDITED') {
        void applyRoomEditFromBroadcast(event as RoomMessageEditedEventPayload);
        return;
      }

      if (!getRoomEncryptionKey()) {
        handleError('NO_GROUP_KEY', 'Cannot decrypt room message — no group key');
        return;
      }

      try {
        const ts = toEpochMs(event.clientTimestamp, event.serverTimestamp);
        const eventType = toMessageType(event.type);
        const isFileMsg = eventType !== 'text' && !!event.fileId;

        let decryptedMsg: DecryptedMessage;

        if (isFileMsg) {
          decryptedMsg = await buildFileMessage(event, ts, eventType, event.replyToMessageId || undefined);
        } else {
          const plaintext = await decryptTextContent(roomId, event.encryptedContent, event.iv);
          decryptedMsg = {
            id: event.messageId,
            sessionId: roomId,
            fromUserId: event.senderTgId ?? 0,
            senderName: event.senderName ?? undefined,
            content: plaintext,
            timestamp: ts,
            status: 'delivered',
            isOwn: isOwnRoomMessage(ownershipCtx, event.senderInternalId, event.senderTgId),
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
  }, [
    roomId, ownershipCtx, onNewMessage, handleError, onMessageDeletedByOwner,
    userId, getRoomEncryptionKey, setMessages, pendingDeleteResolversRef, buildFileMessage,
    applyRoomEditFromBroadcast,
  ]);

  const handleRoomMessageEditedUser = useCallback(
    (message: IMessage) => {
      try {
        const event: RoomMessageEditedEventPayload = JSON.parse(message.body);
        if (event.roomId !== roomId) return;
        if (event.success === false && event.messageId) {
          const resolved = resolvePendingMessageAck(
            pendingEditResolversRef,
            event.messageId,
            { success: false, errorCode: event.errorCode ?? 'INTERNAL_ERROR' },
            pendingEditTimeoutsRef,
          );
          if (!resolved) {
            onEditError?.(event.errorCode ?? 'INTERNAL_ERROR');
          }
        }
      } catch (e) {
        console.error('[useRoomMessages] room-message-edited user queue', e);
      }
    },
    [roomId, onEditError, pendingEditResolversRef, pendingEditTimeoutsRef],
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
        if (event.roomId !== roomId) return;
        if (event.success) return;
        const finish = pendingDeleteResolversRef.current.get(event.messageId);
        if (finish) {
          pendingDeleteResolversRef.current.delete(event.messageId);
          finish({ success: false, errorCode: event.errorCode ?? 'NOT_ALLOWED' });
        }
      } catch (e) {
        console.error('[useRoomMessages] room-message-deleted user queue', e);
      }
    },
    [roomId, pendingDeleteResolversRef],
  );

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
        const fileErrorKey = serverFileRelayErrorI18nKey(event.error);
        handleError('SEND_FAILED', fileErrorKey ?? event.error);
      }
    } catch (parseErr) {
      console.error('[useRoomMessages] Failed to parse room-message-sent event:', parseErr);
    }
  }, [roomId, handleError, setMessages, pendingMessagesRef]);

  const handleSyncMessages = useCallback(async (message: IMessage) => {
    try {
      const event: SyncRoomMessagesEvent = JSON.parse(message.body);
      if (event.roomId !== roomId) return;

      setSyncing(false);
      if (!event.success) return;

      const serverList = event.messages ?? [];
      if (serverList.length > 0 && !getRoomEncryptionKey()) {
        handleError('NO_GROUP_KEY', 'Cannot decrypt synced room messages — no group key');
        return;
      }

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
            const fileMsg = await buildFileMessage(
              syncedMsg,
              ts,
              msgType,
              syncedMsg.replyToMessageId || undefined,
              editedAtFromServerIso(syncedMsg.editedAt),
            );
            decryptedMessages.push(fileMsg);
          } else {
            const plaintext = await decryptTextContent(roomId, syncedMsg.encryptedContent, syncedMsg.iv);
            decryptedMessages.push({
              id: syncedMsg.messageId,
              sessionId: roomId,
              fromUserId: syncedMsg.senderTgId ?? 0,
              senderName: syncedMsg.senderName ?? undefined,
              content: plaintext,
              timestamp: ts,
              status: 'delivered',
              isOwn: isOwnRoomMessage(ownershipCtx, syncedMsg.senderInternalId, syncedMsg.senderTgId),
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
  }, [roomId, ownershipCtx, handleError, setSyncing, getRoomEncryptionKey, setMessages, buildFileMessage]);

  const editMessage = useCallback(
    async (
      messageId: string,
      newText: string,
      originalClientTimestamp: number,
    ): Promise<{ success: boolean; errorCode?: string }> => {
      setError(null);
      if (!isConnected) return { success: false, errorCode: 'NOT_CONNECTED' };
      if (!roomId) return { success: false, errorCode: 'NO_ROOM' };
      const groupKey = getRoomEncryptionKey();
      if (!groupKey) return { success: false, errorCode: 'NO_GROUP_KEY' };
      if (!isWithinEditWindow(originalClientTimestamp)) return { success: false, errorCode: 'WINDOW_EXPIRED' };
      try {
        const encrypted = await encryptMessage(groupKey, newText, roomId);
        return createPendingEditPromise(
          messageId,
          pendingEditResolversRef,
          pendingEditTimeoutsRef,
          () => {
          publish(EDIT_ROOM_MESSAGE_DESTINATION, {
            roomId,
            messageId,
            encryptedContent: encrypted.ciphertext,
            iv: encrypted.iv,
            editedAt: Date.now(),
            originalClientTimestamp,
          });
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        handleError('ENCRYPTION_FAILED', errMsg);
        return { success: false, errorCode: 'ENCRYPTION_FAILED' };
      }
    },
    [isConnected, roomId, publish, handleError, setError, getRoomEncryptionKey, pendingEditResolversRef, pendingEditTimeoutsRef],
  );

  const deleteMessage = useCallback(
    (messageId: string) => {
      if (!isConnected || !roomId) {
        return Promise.resolve({ success: false, errorCode: 'NOT_CONNECTED' });
      }
      return createPendingDeletePromise(
        messageId,
        pendingDeleteResolversRef,
        () => publish(DELETE_ROOM_MESSAGE_DESTINATION, { roomId, messageId }),
      );
    },
    [isConnected, roomId, publish, pendingDeleteResolversRef],
  );

  useEffect(() => {
    handleNewMessageRef.current = handleNewMessage;
    handleMessageSentRef.current = handleMessageSent;
    handleSyncMessagesRef.current = handleSyncMessages;
    handleRoomMessageEditedUserRef.current = handleRoomMessageEditedUser;
    handleRoomMessageDeleteUserRef.current = handleRoomMessageDeleteUser;
  });

  const syncMessages = useCallback(() => {
    coreSyncMessages(() => Boolean(getRoomEncryptionKey()));
  }, [coreSyncMessages, getRoomEncryptionKey]);

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
