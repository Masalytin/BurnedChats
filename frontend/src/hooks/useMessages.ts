import { useCallback, useEffect, useRef } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { encryptMessage } from '@/crypto/aes';
import { isHandshakeComplete, getDebugInfo } from '@/crypto/keyStore';
import type { DecryptedMessage, DecryptedFileMessage, MessageStatus } from '@/types';
import { debugLog } from '@/components/DebugPanel';
import type { ChatWebSocketApi } from '@/hooks/useWebSocket';
import {
  useMessageCore,
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
  mergeMessagesSorted,
  updateMessageStatus,
  runUndeliveredResendAfterRekey,
  type FileMessageWireFields,
} from '@/hooks/useMessageCore';
import { isOwnDmMessage, type DmMessageOwnershipContext } from '@/hooks/dmMessageOwnership';
import { serverFileRelayErrorI18nKey } from '@/services/fileTransferErrors';

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
  | 'NOT_CONNECTED'
  | 'NO_SESSION'
  | 'NOT_VERIFIED'
  | 'NO_ENCRYPTION_KEY'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'SEND_FAILED'
  | 'SESSION_NOT_ACTIVE'
  | 'SESSION_BURNED'
  | 'INTERNAL_ERROR';

/** New message event from server (matches backend NewMessageEvent) */
interface NewMessageEvent extends FileMessageWireFields {
  success: boolean;
  sessionId: string;
  senderId: number;
  senderInternalId?: string | null;
  clientTimestamp?: number | null;
  serverTimestamp?: string;
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

/** Message edit relay / ACK (DM). */
interface MessageEditedEvent {
  success: boolean;
  sessionId: string;
  messageId: string;
  encryptedContent?: string;
  iv?: string;
  editedAt?: string;
  errorCode?: string;
}

/** Delete for everyone (DM). */
interface MessageDeletedEvent {
  success: boolean;
  sessionId: string;
  messageId: string;
  deletedByTgId?: number;
  deletedByOwner?: boolean;
  errorCode?: string;
}

/** Synced message from server (5.1.2) */
interface SyncedMessage extends FileMessageWireFields {
  senderId: number;
  senderInternalId?: string | null;
  clientTimestamp?: number | null;
  serverTimestamp?: string;
  editedAt?: string | null;
}

/** Tombstone edit in sync */
interface SyncedEditPayload {
  messageId: string;
  encryptedContent: string;
  iv: string;
  editedAt?: string;
}

/** Sync messages event from server (5.1.2) */
interface SyncMessagesEvent {
  success: boolean;
  sessionId: string;
  messages: SyncedMessage[];
  count: number;
  serverTimestamp: string;
  error?: string;
  deletedIds?: string[];
  deletedMessageIds?: string[];
  edits?: SyncedEditPayload[];
}

export type UseMessagesWebSocket = ChatWebSocketApi;

export interface SendFileOptions {
  onProgress?: (percent: number) => void;
  onEncryptProgress?: (percent: number) => void;
  signal?: AbortSignal;
  replyToMessageId?: string;
}

interface UseMessagesOptions {
  sessionId: string;
  userId: string;
  userTelegramId?: number;
  ws: UseMessagesWebSocket;
  isReconnection?: boolean;
  onNewMessage?: (message: DecryptedMessage) => void;
  onStatusChange?: (messageId: string, status: MessageStatus) => void;
  onError?: (error: MessageErrorCode, details?: string, i18nValues?: Record<string, string | number>) => void;
  onEditError?: (errorCode: string) => void;
  onSyncComplete?: (count: number, failedCount?: number) => void;
  bothVerified?: boolean;
  /** Incremented when DM rekey completes — triggers resend of queued own messages (IMP-OQR-02). */
  rekeyResendNonce?: number;
}

interface UseMessagesReturn {
  messages: DecryptedMessage[];
  isLoading: boolean;
  isSyncing: boolean;
  sendMessage: (text: string, options?: { replyToMessageId?: string }) => Promise<SendMessageResult>;
  sendFileMessage: (file: File, caption?: string, options?: SendFileOptions) => Promise<SendMessageResult>;
  clearMessages: () => void;
  hideMessages: (ids: string | string[]) => void;
  retryMessage: (messageId: string) => Promise<SendMessageResult>;
  syncMessages: () => void;
  error: MessageErrorCode | null;
  editMessage: (
    messageId: string,
    newText: string,
    originalClientTimestamp: number,
  ) => Promise<{ success: boolean; errorCode?: string }>;
  deleteMessage: (messageId: string) => Promise<{
    success: boolean;
    errorCode?: 'NOT_ALLOWED' | 'NOT_FOUND' | 'NOT_PARTICIPANT' | 'INTERNAL_ERROR' | string;
  }>;
}

// ============================================
// STOMP destinations
// ============================================

const NEW_MESSAGE_DESTINATION = '/user/queue/new-message';
const MESSAGE_SENT_DESTINATION = '/user/queue/message-sent';
const SEND_MESSAGE_DESTINATION = '/app/message.send';
const SYNC_MESSAGES_DESTINATION = '/app/message.sync';
const SYNC_MESSAGES_RESULT_DESTINATION = '/user/queue/sync-messages';
const MESSAGE_EDITED_DESTINATION = '/user/queue/message-edited';
const EDIT_MESSAGE_DESTINATION = '/app/message.edit';
const DELETE_MESSAGE_DESTINATION = '/app/message.delete';
const MESSAGE_DELETED_DESTINATION = '/user/queue/message-deleted';

const LOG_TAG = 'useMessages';

// ============================================
// Hook Implementation
// ============================================

export function useMessages(options: UseMessagesOptions): UseMessagesReturn {
  const {
    sessionId,
    userId: userInternalId,
    userTelegramId,
    ws,
    onNewMessage,
    onStatusChange,
    onError,
    onSyncComplete,
    onEditError,
    bothVerified = false,
    rekeyResendNonce = 0,
  } = options;

  const ownershipCtx: DmMessageOwnershipContext = {
    userInternalId,
    userTelegramId,
  };

  const isOwnWireSender = useCallback((
    senderInternalId?: string | null,
    senderId?: number | null,
  ): boolean => isOwnDmMessage(ownershipCtx, senderInternalId, senderId), [userInternalId, userTelegramId]);

  const { publish: wsPublish } = ws;

  const canSyncDm = useCallback(() => isHandshakeComplete(sessionId), [sessionId]);

  const doPublishSync = useCallback(() => {
    wsPublish(SYNC_MESSAGES_DESTINATION, { sessionId });
  }, [sessionId, wsPublish]);

  const onInitialSyncRequest = useCallback(
    (source: 'subscription' | 'late-handshake') => {
      if (source === 'subscription') {
        debugLog('info', 'Initial sync on chat open', { sessionId });
      } else {
        debugLog('info', 'Initial sync triggered after late handshake completion', { sessionId });
      }
    },
    [sessionId],
  );

  const handleNewMessageRef = useRef<(message: IMessage) => void>(() => {});
  const handleMessageSentRef = useRef<(message: IMessage) => void>(() => {});
  const handleSyncMessagesRef = useRef<(message: IMessage) => void>(() => {});
  const handleMessageEditedRef = useRef<(message: IMessage) => void>(() => {});
  const handleMessageDeletedRef = useRef<(message: IMessage) => void>(() => {});

  const core = useMessageCore<MessageErrorCode>({
    contextId: sessionId,
    hiddenScope: 'dm',
    logTag: LOG_TAG,
    ws,
    isReconnection: options.isReconnection,
    canSync: canSyncDm,
    doPublishSync,
    onInitialSyncRequest,
    onError,
    subscriptions: [
      { destination: NEW_MESSAGE_DESTINATION, handlerRef: handleNewMessageRef },
      { destination: MESSAGE_SENT_DESTINATION, handlerRef: handleMessageSentRef },
      { destination: SYNC_MESSAGES_RESULT_DESTINATION, handlerRef: handleSyncMessagesRef },
      { destination: MESSAGE_EDITED_DESTINATION, handlerRef: handleMessageEditedRef },
      { destination: MESSAGE_DELETED_DESTINATION, handlerRef: handleMessageDeletedRef },
    ],
    canAutoReconnectSync: () => isHandshakeComplete(sessionId),
  });

  const {
    setMessages,
    visibleMessages,
    messages,
    hiddenIds,
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
    getEncryptionKey,
  } = core;

  const validateBeforeSend = useCallback((): MessageErrorCode | null => {
    const keyStoreInfo = getDebugInfo();
    const handshakeComplete = isHandshakeComplete(sessionId);
    debugLog('info', 'sendMessage called', {
      sessionId,
      isConnected,
      handshakeComplete,
      keyStoreSessionCount: keyStoreInfo.sessionCount,
    });

    if (!isConnected) {
      debugLog('error', 'Send blocked: not connected to WebSocket');
      return 'NOT_CONNECTED';
    }
    if (!sessionId) {
      debugLog('error', 'Send blocked: no session ID');
      return 'NO_SESSION';
    }
    if (!handshakeComplete) {
      debugLog('error', 'Send blocked: handshake not complete', { sessionId });
      return 'NO_ENCRYPTION_KEY';
    }
    if (!bothVerified) {
      debugLog('error', 'Send blocked: verification not complete', { sessionId });
      return 'NOT_VERIFIED';
    }
    if (!getEncryptionKey()) {
      debugLog('error', 'Send blocked: no AES key for session', { sessionId });
      return 'NO_ENCRYPTION_KEY';
    }
    return null;
  }, [isConnected, sessionId, bothVerified, getEncryptionKey]);

  const lastRekeyResendNonceRef = useRef(0);

  const resendUndeliveredAfterRekey = useCallback(async () => {
    if (!isConnected || !sessionId) return;
    if (!isHandshakeComplete(sessionId)) return;
    if (!bothVerified) return;

    const { textResent, filesMarkedFailed } = await runUndeliveredResendAfterRekey({
      messages,
      hiddenIds,
      contextId: sessionId,
      logTag: LOG_TAG,
      sendDestination: SEND_MESSAGE_DESTINATION,
      publish,
      handleError,
      setMessages,
      pendingMessagesRef,
      buildPublishPayload: ({ messageId, encryptedContent, iv, timestamp, replyToMessageId }) => ({
        sessionId,
        messageId,
        encryptedContent,
        iv,
        timestamp,
        ...(replyToMessageId ? { replyToMessageId } : {}),
      }),
      validateBeforeSend,
      noKeyError: 'NO_ENCRYPTION_KEY',
      encryptionFailedError: 'ENCRYPTION_FAILED',
    });

    if (textResent > 0 || filesMarkedFailed > 0) {
      debugLog('info', 'Rekey resend after DM key refresh', {
        sessionId,
        textResent,
        filesMarkedFailed,
      });
    }
  }, [
    isConnected,
    sessionId,
    bothVerified,
    messages,
    hiddenIds,
    publish,
    handleError,
    setMessages,
    pendingMessagesRef,
    validateBeforeSend,
  ]);

  useEffect(() => {
    if (rekeyResendNonce === 0) return;
    if (lastRekeyResendNonceRef.current === rekeyResendNonce) return;
    lastRekeyResendNonceRef.current = rekeyResendNonce;
    void resendUndeliveredAfterRekey();
  }, [rekeyResendNonce, resendUndeliveredAfterRekey]);

  const sendMessage = useCallback(async (
    text: string,
    sendOptions?: { replyToMessageId?: string },
  ): Promise<SendMessageResult> => {
    return sendEncryptedTextMessage({
      text,
      contextId: sessionId,
      logTag: LOG_TAG,
      isConnected,
      replyToMessageId: sendOptions?.replyToMessageId,
      sendDestination: SEND_MESSAGE_DESTINATION,
      publish,
      handleError,
      setError,
      setMessages,
      pendingMessagesRef,
      buildLocalMessage: (messageId, timestamp, content, replyToMessageId) => ({
        id: messageId,
        sessionId,
        fromUserId: userTelegramId,
        content,
        timestamp,
        status: 'sending',
        isOwn: true,
        type: 'text',
        replyToMessageId,
      }),
      buildPublishPayload: ({ messageId, encryptedContent, iv, timestamp, replyToMessageId }) => ({
        sessionId,
        messageId,
        encryptedContent,
        iv,
        timestamp,
        ...(replyToMessageId ? { replyToMessageId } : {}),
      }),
      validateBeforeSend,
      noKeyError: 'NO_ENCRYPTION_KEY',
      encryptionFailedError: 'ENCRYPTION_FAILED',
    });
  }, [
    sessionId, isConnected, publish, handleError, setError, setMessages,
    pendingMessagesRef, userTelegramId, validateBeforeSend,
  ]);

  const sendFileMessage = useCallback(async (
    file: File,
    caption?: string,
    sendOptions?: SendFileOptions,
  ): Promise<SendMessageResult> => {
    return sendEncryptedFileMessage({
      file,
      caption,
      contextId: sessionId,
      logTag: LOG_TAG,
      isConnected,
      uploadContext: { type: 'session', id: sessionId },
      sendDestination: SEND_MESSAGE_DESTINATION,
      publish,
      handleError,
      setError,
      setMessages,
      pendingMessagesRef,
      buildLocalFileMessage: (messageId, timestamp, messageType, uploadResult, f, resolvedMime, cap, replyToMessageId) => ({
        id: messageId,
        sessionId,
        fromUserId: userTelegramId,
        content: cap || fileContentPlaceholder(messageType, f.name),
        timestamp,
        status: 'sending',
        isOwn: true,
        type: messageType,
        fileId: uploadResult.fileId,
        thumbnailFileId: uploadResult.thumbnailFileId,
        thumbnailUrl: uploadResult.thumbnailDataUrl,
        fileSize: f.size,
        fileMeta: { fileName: f.name, mimeType: resolvedMime },
        replyToMessageId,
      } as DecryptedFileMessage),
      buildPublishPayload: (payload) => ({ sessionId, ...payload }),
      validateBeforeSend,
      noKeyError: 'NO_ENCRYPTION_KEY',
      encryptionFailedError: 'ENCRYPTION_FAILED',
      sendFailedError: 'SEND_FAILED',
      onProgress: sendOptions?.onProgress,
      onEncryptProgress: sendOptions?.onEncryptProgress,
      signal: sendOptions?.signal,
      replyToMessageId: sendOptions?.replyToMessageId,
    });
  }, [
    sessionId, isConnected, publish, handleError, setError, setMessages,
    pendingMessagesRef, userTelegramId, validateBeforeSend,
  ]);

  const handleNewMessage = useCallback(async (message: IMessage) => {
    try {
      const event: NewMessageEvent = JSON.parse(message.body);
      if (!event.success || event.sessionId !== sessionId) return;

      if (!bothVerified) {
        debugLog('info', 'Skipping DM decrypt until bothVerified', { sessionId });
        return;
      }

      if (!getEncryptionKey()) {
        handleError('NO_ENCRYPTION_KEY', 'Cannot decrypt message - no AES key');
        return;
      }

      try {
        const ts = toEpochMs(event.clientTimestamp, event.serverTimestamp);
        const eventType = toMessageType(event.type);
        const isFileMsg = eventType !== 'text' && !!event.fileId;

        let decryptedMsg: DecryptedMessage;

        if (isFileMsg) {
          decryptedMsg = await decryptWireFileMessage({
            wire: event,
            contextId: sessionId,
            timestamp: ts,
            messageType: eventType,
            replyToMessageId: event.replyToMessageId || undefined,
            logTag: LOG_TAG,
            buildBase: (base) => ({
              ...base,
              fromUserId: event.senderId,
              isOwn: isOwnWireSender(event.senderInternalId, event.senderId),
            }),
          });
        } else {
          const plaintext = await decryptTextContent(sessionId, event.encryptedContent, event.iv);
          decryptedMsg = {
            id: event.messageId,
            sessionId: event.sessionId,
            fromUserId: event.senderId,
            content: plaintext,
            timestamp: ts,
            status: 'delivered',
            isOwn: isOwnWireSender(event.senderInternalId, event.senderId),
            type: 'text',
            replyToMessageId: event.replyToMessageId || undefined,
          };
        }

        setMessages(prev => {
          if (prev.some(m => m.id === event.messageId)) return prev;
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
  }, [sessionId, bothVerified, isOwnWireSender, onNewMessage, handleError, getEncryptionKey, setMessages]);

  const handleSyncMessages = useCallback(async (message: IMessage) => {
    try {
      const event: SyncMessagesEvent = JSON.parse(message.body);
      if (event.sessionId !== sessionId) return;

      if (!bothVerified) {
        setSyncing(false);
        debugLog('info', 'Skipping DM sync decrypt until bothVerified', { sessionId });
        return;
      }

      setSyncing(false);
      if (!event.success) {
        console.warn('[useMessages] Sync failed:', event.error);
        return;
      }

      const toDecrypt = event.messages ?? [];
      const editPayloads = event.edits ?? [];
      const tombstoneDeleteIds = event.deletedIds ?? event.deletedMessageIds ?? [];
      const needsKey = toDecrypt.length > 0 || editPayloads.length > 0;
      let newMessageCount = 0;
      let decryptFailedCount = 0;

      if (needsKey) {
        if (!getEncryptionKey()) {
          handleError('NO_ENCRYPTION_KEY', 'Cannot decrypt synced messages - no AES key');
          return;
        }

        const decryptedMessages: DecryptedMessage[] = [];
        for (const syncedMsg of toDecrypt) {
          try {
            const ts = toEpochMs(syncedMsg.clientTimestamp, syncedMsg.serverTimestamp);
            const msgType = toMessageType(syncedMsg.type);
            const isFileMsg = msgType !== 'text' && !!syncedMsg.fileId;

            if (isFileMsg) {
              const fileMsg = await decryptWireFileMessage({
                wire: syncedMsg,
                contextId: sessionId,
                timestamp: ts,
                messageType: msgType,
                editedAt: editedAtFromServerIso(syncedMsg.editedAt),
                logTag: LOG_TAG,
                buildBase: (base) => ({
                  ...base,
                  fromUserId: syncedMsg.senderId,
                  isOwn: isOwnWireSender(syncedMsg.senderInternalId, syncedMsg.senderId),
                }),
              });
              decryptedMessages.push(fileMsg);
            } else {
              const plaintext = await decryptTextContent(sessionId, syncedMsg.encryptedContent, syncedMsg.iv);
              decryptedMessages.push({
                id: syncedMsg.messageId,
                sessionId,
                fromUserId: syncedMsg.senderId,
                content: plaintext,
                timestamp: ts,
                status: 'delivered',
                isOwn: isOwnWireSender(syncedMsg.senderInternalId, syncedMsg.senderId),
                type: 'text',
                replyToMessageId: syncedMsg.replyToMessageId || undefined,
                editedAt: editedAtFromServerIso(syncedMsg.editedAt),
              });
            }
          } catch (decryptErr) {
            decryptFailedCount += 1;
            console.error('[useMessages] Failed to decrypt synced message:', decryptErr);
          }
        }

        newMessageCount = decryptedMessages.length;
        if (decryptedMessages.length > 0) {
          setMessages(prev => mergeMessagesSorted(prev, decryptedMessages));
          decryptedMessages.forEach(msg => onNewMessage?.(msg));
        }

        for (const edit of editPayloads) {
          try {
            const plaintext = await decryptTextContent(sessionId, edit.encryptedContent, edit.iv);
            const editedAtMs = edit.editedAt ? new Date(edit.editedAt).getTime() : Date.now();
            setMessages(prev => prev.map(m =>
              m.id === edit.messageId ? { ...m, content: plaintext, editedAt: editedAtMs } : m
            ));
          } catch (e) {
            console.error('[useMessages] Failed to apply sync edit:', e);
          }
        }
      }

      if (tombstoneDeleteIds.length > 0) {
        const idSet = new Set(tombstoneDeleteIds);
        setMessages(prev => prev.filter(m => !idSet.has(m.id)));
      }

      const failedCount = decryptFailedCount;
      console.log(
        `[useMessages] Sync batch: ${newMessageCount} message(s), ${editPayloads.length} edit(s), ${tombstoneDeleteIds.length} delete(s)`,
        failedCount > 0 ? `, ${failedCount} decrypt failure(s)` : '',
      );
      onSyncComplete?.(newMessageCount, failedCount > 0 ? failedCount : undefined);
    } catch (parseErr) {
      console.error('[useMessages] Failed to parse sync event:', parseErr);
      setSyncing(false);
    }
  }, [sessionId, bothVerified, isOwnWireSender, onNewMessage, onSyncComplete, handleError, setSyncing, getEncryptionKey, setMessages]);

  const syncMessages = useCallback(() => {
    coreSyncMessages(() => isHandshakeComplete(sessionId));
  }, [coreSyncMessages, sessionId]);

  const handleMessageSent = useCallback((message: IMessage) => {
    try {
      const event: MessageSentEvent = JSON.parse(message.body);
      if (event.sessionId !== sessionId) return;

      pendingMessagesRef.current.delete(event.messageId);

      if (event.success) {
        const newStatus: MessageStatus = event.delivered ? 'delivered' : 'sent';
        setMessages(prev => updateMessageStatus(prev, event.messageId, newStatus));
        onStatusChange?.(event.messageId, newStatus);
      } else {
        console.error('[useMessages] Message send failed:', event.error);
        setMessages(prev => updateMessageStatus(prev, event.messageId, 'failed'));
        onStatusChange?.(event.messageId, 'failed');
        const fileErrorKey = serverFileRelayErrorI18nKey(event.error);
        handleError(mapServerError(event.error), fileErrorKey ?? event.error);
      }
    } catch (parseErr) {
      console.error('[useMessages] Failed to parse message-sent event:', parseErr);
    }
  }, [sessionId, onStatusChange, handleError, setMessages, pendingMessagesRef]);

  const handleMessageEdited = useCallback(async (message: IMessage) => {
    try {
      const event: MessageEditedEvent = JSON.parse(message.body);
      if (event.sessionId !== sessionId) return;
      if (event.success === false) {
        const resolved = resolvePendingMessageAck(
          pendingEditResolversRef,
          event.messageId,
          { success: false, errorCode: event.errorCode ?? 'INTERNAL_ERROR' },
          pendingEditTimeoutsRef,
        );
        if (!resolved) {
          onEditError?.(event.errorCode ?? 'INTERNAL_ERROR');
        }
        return;
      }
      if (!getEncryptionKey() || !event.encryptedContent || !event.iv) {
        const resolved = resolvePendingMessageAck(
          pendingEditResolversRef,
          event.messageId,
          { success: false, errorCode: 'INTERNAL_ERROR' },
          pendingEditTimeoutsRef,
        );
        if (!resolved) {
          onEditError?.('INTERNAL_ERROR');
        }
        return;
      }
      try {
        const plaintext = await decryptTextContent(sessionId, event.encryptedContent, event.iv);
        const editedAtMs = event.editedAt ? new Date(event.editedAt).getTime() : Date.now();
        setMessages(prev => prev.map(m =>
          m.id === event.messageId ? { ...m, content: plaintext, editedAt: editedAtMs } : m
        ));
        resolvePendingMessageAck(
          pendingEditResolversRef,
          event.messageId,
          { success: true },
          pendingEditTimeoutsRef,
        );
      } catch (e) {
        console.error('[useMessages] message-edited handler:', e);
        const resolved = resolvePendingMessageAck(
          pendingEditResolversRef,
          event.messageId,
          { success: false, errorCode: 'INTERNAL_ERROR' },
          pendingEditTimeoutsRef,
        );
        if (!resolved) {
          onEditError?.('INTERNAL_ERROR');
        }
      }
    } catch (e) {
      console.error('[useMessages] message-edited parse:', e);
    }
  }, [sessionId, onEditError, getEncryptionKey, setMessages, pendingEditResolversRef, pendingEditTimeoutsRef]);

  const editMessage = useCallback(
    async (
      messageId: string,
      newText: string,
      originalClientTimestamp: number,
    ): Promise<{ success: boolean; errorCode?: string }> => {
      setError(null);
      if (!isConnected) return { success: false, errorCode: 'NOT_CONNECTED' };
      if (!sessionId) return { success: false, errorCode: 'NO_SESSION' };
      if (!isHandshakeComplete(sessionId)) return { success: false, errorCode: 'NO_ENCRYPTION_KEY' };
      const aesKey = getEncryptionKey();
      if (!aesKey) return { success: false, errorCode: 'NO_ENCRYPTION_KEY' };
      try {
        const encrypted = await encryptMessage(aesKey, newText, sessionId);
        return createPendingEditPromise(
          messageId,
          pendingEditResolversRef,
          pendingEditTimeoutsRef,
          () => {
          publish(EDIT_MESSAGE_DESTINATION, {
            sessionId,
            messageId,
            encryptedContent: encrypted.ciphertext,
            iv: encrypted.iv,
            editedAt: Date.now(),
            originalClientTimestamp,
          });
        });
      } catch {
        handleError('ENCRYPTION_FAILED');
        return { success: false, errorCode: 'ENCRYPTION_FAILED' };
      }
    },
    [isConnected, sessionId, publish, handleError, setError, getEncryptionKey, pendingEditResolversRef, pendingEditTimeoutsRef],
  );

  const handleMessageDeleted = useCallback(
    (message: IMessage) => {
      try {
        const event: MessageDeletedEvent = JSON.parse(message.body);
        if (event.sessionId !== sessionId) return;
        const finish = pendingDeleteResolversRef.current.get(event.messageId);
        if (finish) {
          pendingDeleteResolversRef.current.delete(event.messageId);
          finish({ success: !!event.success, errorCode: event.errorCode });
        }
        if (event.success) {
          setMessages(prev => prev.filter(m => m.id !== event.messageId));
        }
      } catch (e) {
        console.error('[useMessages] message-deleted handler:', e);
      }
    },
    [sessionId, setMessages, pendingDeleteResolversRef],
  );

  const deleteMessage = useCallback(
    (messageId: string) => {
      if (!isConnected || !sessionId) {
        return Promise.resolve({ success: false, errorCode: 'NOT_CONNECTED' as const });
      }
      return createPendingDeletePromise(
        messageId,
        pendingDeleteResolversRef,
        () => publish(DELETE_MESSAGE_DESTINATION, { sessionId, messageId }),
      );
    },
    [isConnected, sessionId, publish, pendingDeleteResolversRef],
  );

  useEffect(() => {
    handleNewMessageRef.current = handleNewMessage;
    handleMessageSentRef.current = handleMessageSent;
    handleSyncMessagesRef.current = handleSyncMessages;
    handleMessageEditedRef.current = handleMessageEdited;
    handleMessageDeletedRef.current = handleMessageDeleted;
  });

  const retryMessage = useCallback(async (messageId: string): Promise<SendMessageResult> => {
    const message = visibleMessages.find(m => m.id === messageId);
    if (!message || message.status !== 'failed') {
      return { success: false, messageId, error: 'INTERNAL_ERROR' };
    }
    setMessages(prev => prev.filter(m => m.id !== messageId));
    return sendMessage(message.content, { replyToMessageId: message.replyToMessageId });
  }, [visibleMessages, sendMessage, setMessages]);

  return {
    messages: visibleMessages,
    isLoading,
    isSyncing,
    sendMessage,
    sendFileMessage,
    clearMessages,
    hideMessages,
    retryMessage,
    syncMessages,
    error,
    editMessage,
    deleteMessage,
  };
}

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
