import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { encryptMessage, decryptMessage } from '@/crypto/aes';
import { encryptFileMetadata, decryptFileMetadata } from '@/crypto/fileEncryption';
import { resolveDecryptionKey, resolveDecryptionKeyForRoomMessage, getAESKey, hasGroupKey } from '@/crypto/keyStore';
import { downloadThumbnail } from '@/services/fileDownloadService';
import { enqueueUpload, cancelAll } from '@/services/transferQueue';
import { FileTransferError, fileTransferErrorI18nKey } from '@/services/fileTransferErrors';
import { validateFileForUpload } from '@/utils/fileValidation';
import { fileValidationToastParams } from '@/utils/fileValidationI18n';
import { enrichReplyTo } from '@/utils/replyPreview';
import i18n from '@/i18n';
import type {
  DecryptedMessage,
  DecryptedFileMessage,
  FileMetadata,
  MessageStatus,
  MessageType,
} from '@/types';
import { useMessageSync, type MessageSyncRequestSource } from '@/hooks/useMessageSync';
import { useHiddenMessages } from '@/hooks/useHiddenMessages';
import type { ChatWebSocketApi } from '@/hooks/useWebSocket';

// ============================================
// Shared utilities
// ============================================

export function generateMessageId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${timestamp}-${random}`;
}

export function toEpochMs(clientTimestamp?: number | null, serverTimestamp?: string): number {
  if (typeof clientTimestamp === 'number' && Number.isFinite(clientTimestamp) && clientTimestamp >= 0) {
    return clientTimestamp;
  }
  if (serverTimestamp) {
    const ms = new Date(serverTimestamp).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

export function toMessageType(raw?: string): MessageType {
  if (raw === 'image' || raw === 'video' || raw === 'file') return raw;
  return 'text';
}

export function fileContentPlaceholder(type: MessageType, fileName?: string): string {
  const name = fileName || 'file';
  switch (type) {
    case 'image': return `📷 ${name}`;
    case 'video': return `🎬 ${name}`;
    case 'file':  return `📎 ${name}`;
    default:      return name;
  }
}

export function editedAtFromServerIso(iso?: string | null): number | undefined {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/** Resolve AES key for DM session or room via unified keyStore lookup. */
export function getEncryptionKey(contextId: string): CryptoKey | undefined {
  return resolveDecryptionKey(contextId, { silent: true })?.key;
}

// ============================================
// File message wire shape (shared fields)
// ============================================

export interface FileMessageWireFields {
  messageId: string;
  encryptedContent: string;
  iv: string;
  type?: string;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
  replyToMessageId?: string;
}

export interface BuildFileMessageParams {
  wire: FileMessageWireFields;
  contextId: string;
  timestamp: number;
  messageType: MessageType;
  replyToMessageId?: string;
  editedAt?: number;
  logTag: string;
  buildBase: (base: Omit<DecryptedFileMessage, 'type'> & { type: 'image' | 'video' | 'file' }) => DecryptedMessage;
}

export async function decryptWireFileMessage(params: BuildFileMessageParams): Promise<DecryptedMessage> {
  const { wire, contextId, timestamp, messageType, replyToMessageId, editedAt, logTag, buildBase } = params;
  const aesKey = getEncryptionKey(contextId);
  if (!aesKey) {
    throw new Error(`[${logTag}] No encryption key for context ${contextId}`);
  }

  let caption = '';
  try {
    caption = await decryptMessage(aesKey, wire.encryptedContent, wire.iv, contextId);
  } catch {
    // Caption may be empty-encrypted — expected for no-caption files
  }

  let fileMeta: FileMetadata | undefined;
  if (wire.encryptedMeta) {
    try {
      fileMeta = await decryptFileMetadata(wire.encryptedMeta, aesKey);
    } catch (err) {
      console.error(`[${logTag}] Failed to decrypt file metadata:`, err);
    }
  }

  let thumbnailUrl: string | undefined;
  if (wire.thumbnailFileId) {
    try {
      thumbnailUrl = await downloadThumbnail(wire.thumbnailFileId, aesKey);
    } catch (err) {
      console.error(`[${logTag}] Failed to download thumbnail:`, err);
    }
  }

  const content = caption || fileContentPlaceholder(messageType, fileMeta?.fileName);

  return buildBase({
    id: wire.messageId,
    sessionId: contextId,
    fromUserId: 0,
    content,
    timestamp,
    status: 'delivered',
    isOwn: false,
    type: messageType as 'image' | 'video' | 'file',
    fileId: wire.fileId!,
    fileSize: wire.fileSize ?? 0,
    fileMeta: fileMeta ?? { fileName: 'unknown', mimeType: 'application/octet-stream' },
    thumbnailFileId: wire.thumbnailFileId,
    thumbnailUrl,
    replyToMessageId,
    ...(editedAt != null ? { editedAt } : {}),
  });
}

/** Placeholder shown when a room message cannot be decrypted (epoch mismatch, lost key). */
export const UNDECRYPTABLE_MESSAGE_PLACEHOLDER = '[encrypted]';

export async function decryptTextContent(
  contextId: string,
  encryptedContent: string,
  iv: string,
): Promise<string> {
  const sessionKey = getAESKey(contextId);
  if (sessionKey) {
    return decryptMessage(sessionKey, encryptedContent, iv, contextId);
  }

  if (hasGroupKey(contextId)) {
    return resolveDecryptionKeyForRoomMessage(contextId, encryptedContent, iv);
  }

  throw new Error(`No encryption key for context ${contextId}`);
}

// ============================================
// Send helpers (shared encrypt + publish flow)
// ============================================

export interface SendTextMessageCoreParams<TError extends string> {
  text: string;
  contextId: string;
  logTag: string;
  isConnected: boolean;
  replyToMessageId?: string;
  sendDestination: string;
  publish: ChatWebSocketApi['publish'];
  handleError: (code: TError, details?: string, i18nValues?: Record<string, string | number>) => void;
  setError: (v: TError | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<DecryptedMessage[]>>;
  pendingMessagesRef: React.MutableRefObject<Map<string, { text: string; timestamp: number }>>;
  buildLocalMessage: (messageId: string, timestamp: number, text: string, replyToMessageId?: string) => DecryptedMessage;
  buildPublishPayload: (payload: {
    messageId: string;
    encryptedContent: string;
    iv: string;
    timestamp: number;
    replyToMessageId?: string;
  }) => Record<string, unknown>;
  validateBeforeSend: () => TError | null;
  noKeyError: TError;
  encryptionFailedError: TError;
  messageIdPrefix?: string;
}

export async function sendEncryptedTextMessage<TError extends string>(
  params: SendTextMessageCoreParams<TError>,
): Promise<{ success: boolean; messageId: string | null; error: TError | null }> {
  const {
    text,
    contextId,
    logTag,
    replyToMessageId,
    sendDestination,
    publish,
    handleError,
    setError,
    setMessages,
    pendingMessagesRef,
    buildLocalMessage,
    buildPublishPayload,
    validateBeforeSend,
    noKeyError,
    encryptionFailedError,
    messageIdPrefix = 'msg',
  } = params;

  setError(null);

  const preflightError = validateBeforeSend();
  if (preflightError) {
    handleError(preflightError);
    return { success: false, messageId: null, error: preflightError };
  }

  const aesKey = getEncryptionKey(contextId);
  if (!aesKey) {
    handleError(noKeyError);
    return { success: false, messageId: null, error: noKeyError };
  }

  const messageId = generateMessageId(messageIdPrefix);
  const timestamp = Date.now();

  try {
    const encrypted = await encryptMessage(aesKey, text, contextId);
    pendingMessagesRef.current.set(messageId, { text, timestamp });

    const localMessage = buildLocalMessage(messageId, timestamp, text, replyToMessageId);
    setMessages(prev => [...prev, localMessage].sort((a, b) => a.timestamp - b.timestamp));

    publish(sendDestination, buildPublishPayload({
      messageId,
      encryptedContent: encrypted.ciphertext,
      iv: encrypted.iv,
      timestamp,
      replyToMessageId,
    }));

    return { success: true, messageId, error: null };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[${logTag}] Encryption failed:`, err);
    handleError(encryptionFailedError, errMsg);
    return { success: false, messageId: null, error: encryptionFailedError };
  }
}

export interface SendFileMessageCoreParams<TError extends string> {
  file: File;
  caption: string | undefined;
  contextId: string;
  logTag: string;
  isConnected: boolean;
  uploadContext: { type: 'session' | 'room'; id: string };
  sendDestination: string;
  publish: ChatWebSocketApi['publish'];
  handleError: (code: TError, details?: string, i18nValues?: Record<string, string | number>) => void;
  setError: (v: TError | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<DecryptedMessage[]>>;
  pendingMessagesRef: React.MutableRefObject<Map<string, { text: string; timestamp: number }>>;
  buildLocalFileMessage: (
    messageId: string,
    timestamp: number,
    messageType: MessageType,
    uploadResult: { fileId: string; thumbnailFileId?: string; thumbnailDataUrl?: string; size: number },
    file: File,
    resolvedMime: string,
    caption: string,
    replyToMessageId?: string,
  ) => DecryptedMessage;
  buildPublishPayload: (payload: Record<string, unknown>) => Record<string, unknown>;
  validateBeforeSend: () => TError | null;
  noKeyError: TError;
  encryptionFailedError: TError;
  sendFailedError: TError;
  messageIdPrefix?: string;
  onProgress?: (percent: number) => void;
  onEncryptProgress?: (percent: number) => void;
  signal?: AbortSignal;
  replyToMessageId?: string;
}

export async function sendEncryptedFileMessage<TError extends string>(
  params: SendFileMessageCoreParams<TError>,
): Promise<{ success: boolean; messageId: string | null; error: TError | null }> {
  const {
    file,
    caption,
    contextId,
    uploadContext,
    sendDestination,
    publish,
    handleError,
    setError,
    setMessages,
    pendingMessagesRef,
    buildLocalFileMessage,
    buildPublishPayload,
    validateBeforeSend,
    noKeyError,
    sendFailedError,
    messageIdPrefix = 'msg',
    onProgress,
    onEncryptProgress,
    signal,
    replyToMessageId,
  } = params;

  setError(null);

  const preflightError = validateBeforeSend();
  if (preflightError) {
    handleError(preflightError);
    return { success: false, messageId: null, error: preflightError };
  }

  const aesKey = getEncryptionKey(contextId);
  if (!aesKey) {
    handleError(noKeyError);
    return { success: false, messageId: null, error: noKeyError };
  }

  const validated = validateFileForUpload(file);
  if (!validated.ok) {
    handleError(sendFailedError, validated.errorKey, fileValidationToastParams(validated));
    return { success: false, messageId: null, error: sendFailedError };
  }

  const messageId = generateMessageId(messageIdPrefix);
  const timestamp = Date.now();
  const messageType = validated.messageType;

  // Patch helper: update transient fields of the optimistic bubble in place.
  const patchMessage = (fields: Partial<DecryptedFileMessage>) => {
    setMessages(prev =>
      prev.map(m => (m.id === messageId ? ({ ...m, ...fields } as DecryptedMessage) : m)),
    );
  };

  // Insert the optimistic file bubble immediately (status 'sending', no fileId
  // yet) so the user sees a single message whose progress fills in place — no
  // separate placeholder, no swap. Real fileId/thumbnail are patched in once
  // the upload completes.
  const optimisticMessage = {
    ...buildLocalFileMessage(
      messageId,
      timestamp,
      messageType,
      { fileId: '', thumbnailFileId: undefined, thumbnailDataUrl: undefined, size: file.size },
      file,
      validated.resolvedMime,
      caption || '',
      replyToMessageId,
    ),
    uploadProgress: 0,
    uploadStage: 'encrypting' as const,
  } as DecryptedMessage;
  setMessages(prev => [...prev, optimisticMessage].sort((a, b) => a.timestamp - b.timestamp));

  try {
    const uploadHandle = enqueueUpload({
      file,
      key: aesKey,
      context: uploadContext,
      onProgress: (percent) => {
        patchMessage({ uploadStage: 'uploading', uploadProgress: percent });
        onProgress?.(percent);
      },
      onEncryptProgress: (percent) => {
        patchMessage({ uploadStage: 'encrypting', uploadProgress: percent });
        onEncryptProgress?.(percent);
      },
      signal,
    });
    const uploadResult = await uploadHandle.result;

    const encryptedMeta = await encryptFileMetadata(
      { fileName: file.name, mimeType: validated.resolvedMime },
      aesKey,
    );

    const encrypted = await encryptMessage(aesKey, caption || '', contextId);
    pendingMessagesRef.current.set(messageId, { text: caption || '', timestamp });

    // Upload done: fill in the real ids + local preview and clear progress.
    // Status stays 'sending' until the server ack flips it to sent/delivered.
    patchMessage({
      fileId: uploadResult.fileId,
      thumbnailFileId: uploadResult.thumbnailFileId,
      thumbnailUrl: uploadResult.thumbnailDataUrl,
      fileSize: file.size,
      uploadProgress: undefined,
      uploadStage: undefined,
    });

    publish(sendDestination, buildPublishPayload({
      messageId,
      encryptedContent: encrypted.ciphertext,
      iv: encrypted.iv,
      timestamp,
      type: messageType,
      fileId: uploadResult.fileId,
      thumbnailFileId: uploadResult.thumbnailFileId,
      encryptedMeta,
      fileSize: file.size,
      ...(replyToMessageId ? { replyToMessageId } : {}),
    }));

    return { success: true, messageId, error: null };
  } catch (err) {
    const aborted =
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof FileTransferError && err.kind === 'aborted');
    if (aborted) {
      // Cancelled by the user — drop the optimistic bubble entirely.
      setMessages(prev => prev.filter(m => m.id !== messageId));
      pendingMessagesRef.current.delete(messageId);
      return { success: false, messageId: null, error: sendFailedError };
    }

    // Encrypt/upload failed: keep the bubble but mark it failed so the user can
    // retry from the bubble itself.
    patchMessage({ status: 'failed', uploadProgress: undefined, uploadStage: undefined });
    pendingMessagesRef.current.delete(messageId);

    if (err instanceof FileTransferError) {
      handleError(sendFailedError, fileTransferErrorI18nKey(err));
      return { success: false, messageId: null, error: sendFailedError };
    }
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    handleError(sendFailedError, errMsg);
    return { success: false, messageId: null, error: sendFailedError };
  }
}

// ============================================
// Pending delete promise helper
// ============================================

export type PendingMessageResolver = (r: { success: boolean; errorCode?: string }) => void;

export type PendingMessageResolversRef = React.MutableRefObject<Map<string, PendingMessageResolver>>;

export function createPendingDeletePromise(
  messageId: string,
  pendingResolversRef: PendingMessageResolversRef,
  publishDelete: () => void,
  timeoutMs = 15_000,
): Promise<{ success: boolean; errorCode?: string }> {
  return new Promise(resolve => {
    pendingResolversRef.current.set(messageId, resolve);
    publishDelete();
    window.setTimeout(() => {
      if (pendingResolversRef.current.has(messageId)) {
        pendingResolversRef.current.delete(messageId);
        resolve({ success: false, errorCode: 'INTERNAL_ERROR' });
      }
    }, timeoutMs);
  });
}

// ============================================
// Pending edit promise helper
// ============================================

export function createPendingEditPromise(
  messageId: string,
  pendingResolversRef: PendingMessageResolversRef,
  pendingTimeoutsRef: React.MutableRefObject<Map<string, number>>,
  publishEdit: () => void,
  timeoutMs = 15_000,
): Promise<{ success: boolean; errorCode?: string }> {
  return new Promise(resolve => {
    const existingTimeout = pendingTimeoutsRef.current.get(messageId);
    if (existingTimeout !== undefined) {
      window.clearTimeout(existingTimeout);
      pendingTimeoutsRef.current.delete(messageId);
    }
    const superseded = pendingResolversRef.current.get(messageId);
    if (superseded) {
      superseded({ success: false, errorCode: 'SUPERSEDED' });
      pendingResolversRef.current.delete(messageId);
    }

    pendingResolversRef.current.set(messageId, resolve);
    publishEdit();
    const timeoutId = window.setTimeout(() => {
      if (pendingResolversRef.current.has(messageId)) {
        pendingResolversRef.current.delete(messageId);
        pendingTimeoutsRef.current.delete(messageId);
        resolve({ success: false, errorCode: 'TIMEOUT' });
      }
    }, timeoutMs);
    pendingTimeoutsRef.current.set(messageId, timeoutId);
  });
}

/** Resolve a pending edit/delete ack; returns true if a resolver was found. */
export function resolvePendingMessageAck(
  pendingResolversRef: PendingMessageResolversRef,
  messageId: string,
  result: { success: boolean; errorCode?: string },
  pendingTimeoutsRef?: React.MutableRefObject<Map<string, number>>,
): boolean {
  const finish = pendingResolversRef.current.get(messageId);
  if (!finish) return false;
  pendingResolversRef.current.delete(messageId);
  if (pendingTimeoutsRef) {
    const timeoutId = pendingTimeoutsRef.current.get(messageId);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      pendingTimeoutsRef.current.delete(messageId);
    }
  }
  finish(result);
  return true;
}

export interface SubmitMessageEditParams {
  editMessage: (
    messageId: string,
    newText: string,
    originalClientTimestamp: number,
  ) => Promise<{ success: boolean; errorCode?: string }>;
  editingMessage: { id: string; timestamp: number };
  text: string;
  showEditError: (errorCode?: string) => void;
  onSuccess: () => void;
}

/** Shared edit-submit flow for DM and room chat containers. */
export async function submitMessageEdit(params: SubmitMessageEditParams): Promise<void> {
  const result = await params.editMessage(
    params.editingMessage.id,
    params.text,
    params.editingMessage.timestamp,
  );
  if (!result.success) {
    params.showEditError(result.errorCode);
    return;
  }
  params.onSuccess();
}

export function showMessageEditErrorToast(
  errorCode: string | undefined,
  t: (key: string) => string,
  toast: { error: (msg: string) => void },
): void {
  if (errorCode === 'WINDOW_EXPIRED') {
    toast.error(t('chat.edit.windowExpired'));
  } else {
    toast.error(t('chat.edit.failed'));
  }
}

// ============================================
// Core hook scaffold
// ============================================

export interface MessageSubscriptionSpec {
  destination: string;
  handlerRef: React.MutableRefObject<(message: IMessage) => void>;
}

export interface UseMessageCoreOptions<TError extends string> {
  contextId: string;
  hiddenScope: 'dm' | 'room';
  logTag: string;
  ws: ChatWebSocketApi;
  isReconnection?: boolean;
  canSync: () => boolean;
  doPublishSync: () => void;
  onInitialSyncRequest?: (source: MessageSyncRequestSource) => void;
  onError?: (code: TError, details?: string, i18nValues?: Record<string, string | number>) => void;
  subscriptions: MessageSubscriptionSpec[];
  canAutoReconnectSync?: () => boolean;
}

export interface UseMessageCoreReturn<TError extends string> {
  messages: DecryptedMessage[];
  setMessages: React.Dispatch<React.SetStateAction<DecryptedMessage[]>>;
  visibleMessages: DecryptedMessage[];
  isLoading: boolean;
  error: TError | null;
  setError: React.Dispatch<React.SetStateAction<TError | null>>;
  handleError: (code: TError, details?: string, i18nValues?: Record<string, string | number>) => void;
  pendingMessagesRef: React.MutableRefObject<Map<string, { text: string; timestamp: number }>>;
  pendingDeleteResolversRef: PendingMessageResolversRef;
  pendingEditResolversRef: PendingMessageResolversRef;
  pendingEditTimeoutsRef: React.MutableRefObject<Map<string, number>>;
  hideMessages: (ids: string | string[]) => void;
  clearMessages: () => void;
  isSyncing: boolean;
  setSyncing: (v: boolean) => void;
  triggerSyncIfReady: (source?: MessageSyncRequestSource) => void;
  runReconnectIfNeeded: () => void;
  syncMessages: (extraGuard?: () => boolean) => void;
  isConnected: boolean;
  publish: ChatWebSocketApi['publish'];
  subscribe: ChatWebSocketApi['subscribe'];
  unsubscribe: ChatWebSocketApi['unsubscribe'];
  effectiveIsReconnection: boolean;
  getEncryptionKey: () => CryptoKey | undefined;
}

/**
 * Shared scaffold for DM and room message hooks: state, hidden messages, sync,
 * subscriptions lifecycle, and unified key resolution via {@link resolveDecryptionKey}.
 */
export function useMessageCore<TError extends string>(
  options: UseMessageCoreOptions<TError>,
): UseMessageCoreReturn<TError> {
  const {
    contextId,
    hiddenScope,
    logTag,
    ws,
    isReconnection,
    canSync,
    doPublishSync,
    onInitialSyncRequest,
    onError,
    subscriptions,
    canAutoReconnectSync,
  } = options;

  const { hiddenIds, hide: hideMessages } = useHiddenMessages(hiddenScope, contextId);
  const { isConnected, isReconnection: wsIsReconnection, subscribe, unsubscribe, publish } = ws;
  const effectiveIsReconnection = isReconnection ?? wsIsReconnection ?? false;

  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const visibleMessages = useMemo(
    () =>
      messages
        .filter((m) => !hiddenIds.has(m.id))
        .map((m) => enrichReplyTo(m, messages, i18n.t.bind(i18n))),
    [messages, hiddenIds],
  );
  const [isLoading] = useState(false);
  const [error, setError] = useState<TError | null>(null);

  const pendingMessagesRef = useRef<Map<string, { text: string; timestamp: number }>>(new Map());
  const pendingDeleteResolversRef = useRef(new Map<string, PendingMessageResolver>());
  const pendingEditResolversRef = useRef(new Map<string, PendingMessageResolver>());
  const pendingEditTimeoutsRef = useRef(new Map<string, number>());

  const handleError = useCallback((
    code: TError,
    details?: string,
    i18nValues?: Record<string, string | number>,
  ) => {
    setError(code);
    onError?.(code, details, i18nValues);
    console.error(`[${logTag}] Error: ${code}`, details);
  }, [logTag, onError]);

  const messageSync = useMessageSync({
    scopeId: contextId,
    isConnected,
    isReconnection: effectiveIsReconnection,
    canSync,
    doPublishInitialSync: doPublishSync,
    doPublishReconnectSync: doPublishSync,
    onInitialSyncRequest,
  });
  const { isSyncing, setSyncing, triggerSyncIfReady, runReconnectIfNeeded } = messageSync;

  const getEncryptionKeyForContext = useCallback(
    () => getEncryptionKey(contextId),
    [contextId],
  );

  const clearMessages = useCallback(() => {
    cancelAll();
    setMessages([]);
    pendingMessagesRef.current.clear();
    setError(null);
  }, []);

  const syncMessages = useCallback((extraGuard?: () => boolean) => {
    if (!isConnected || !contextId) {
      console.warn(`[${logTag}] Cannot sync - not connected or no context`);
      return;
    }
    if (extraGuard && !extraGuard()) {
      console.warn(`[${logTag}] Cannot sync - guard failed`);
      return;
    }
    if (!canSync()) {
      console.warn(`[${logTag}] Cannot sync - sync prerequisites not met`);
      return;
    }
    setSyncing(true);
    doPublishSync();
  }, [isConnected, contextId, logTag, canSync, doPublishSync, setSyncing]);

  // Subscriptions + initial sync
  useEffect(() => {
    if (!isConnected || !contextId) {
      return;
    }

    const wrappers = subscriptions.map(({ destination, handlerRef }) => ({
      destination,
      wrapper: (message: IMessage) => handlerRef.current(message),
    }));

    for (const { destination, wrapper } of wrappers) {
      subscribe(destination, wrapper);
    }

    triggerSyncIfReady('subscription');

    return () => {
      for (const { destination } of wrappers) {
        unsubscribe(destination);
      }
    };
  // Intentionally exclude subscribe/unsubscribe/publish so effect only re-runs when
  // connection state or context identity actually changes (avoids duplicate syncs).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, contextId, triggerSyncIfReady]);

  // Auto-sync on reconnection — declared after subscription effect (FIX-SYNC-1 ordering).
  useEffect(() => {
    if (!isConnected || !contextId || !effectiveIsReconnection) {
      return;
    }
    if (canAutoReconnectSync && !canAutoReconnectSync()) {
      return;
    }
    if (!canSync()) {
      console.log(`[${logTag}] Skipping auto-sync - sync prerequisites not met`);
      return;
    }
    console.log(`[${logTag}] Auto-syncing messages after reconnection`);
    runReconnectIfNeeded();
  }, [isConnected, contextId, effectiveIsReconnection, canSync, canAutoReconnectSync, runReconnectIfNeeded, logTag]);

  // Cleanup on context change
  useEffect(() => {
    return () => {
      clearMessages();
    };
  }, [contextId, clearMessages]);

  return {
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
    triggerSyncIfReady,
    runReconnectIfNeeded,
    syncMessages,
    isConnected,
    publish,
    subscribe,
    unsubscribe,
    effectiveIsReconnection,
    getEncryptionKey: getEncryptionKeyForContext,
  };
}

/** Merge incoming messages without duplicates, sorted by timestamp. */
export function mergeMessagesSorted(
  prev: DecryptedMessage[],
  incoming: DecryptedMessage[],
): DecryptedMessage[] {
  const existingIds = new Set(prev.map(m => m.id));
  const newMessages = incoming.filter(m => !existingIds.has(m.id));
  if (newMessages.length === 0) return prev;
  return [...prev, ...newMessages].sort((a, b) => a.timestamp - b.timestamp);
}

/** Update message status by id. */
export function updateMessageStatus(
  prev: DecryptedMessage[],
  messageId: string,
  status: MessageStatus,
): DecryptedMessage[] {
  return prev.map(msg =>
    msg.id === messageId ? { ...msg, status } : msg
  );
}
