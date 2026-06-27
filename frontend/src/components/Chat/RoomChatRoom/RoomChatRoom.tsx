import { memo, useCallback, useEffect, useState, useRef, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Home,
  Hourglass,
  Key,
  Lock,
  LogOut,
  MicOff,
  RefreshCw,
  Settings,
  Timer,
} from 'lucide-react';
import { buildCopyText } from '@/components/Chat/messageActions/copyMessage';
import { writeTextToClipboard } from '@/utils/clipboard';
import { MessageList } from '../MessageList';
import { MessageInput } from '../MessageInput';
import { makeReplyPreview, resolveReplyAuthor } from '@/utils/replyPreview';
import type { ReplyChipModel } from '../ReplyChip';
import type { SelectedFileInfo } from '../MessageInput';
import { FilePreview } from '../FilePreview';
import { ChatScreenHeader } from '../ChatScreenHeader';
import { ChatSelectionBar } from '../ChatSelectionBar';
import { useMessageSelection } from '@/hooks/useMessageSelection';
import { useAnnouncer } from '@/hooks/useAnnouncer';
import { MediaViewer } from '../MediaViewer';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { hasGroupKey } from '@/crypto/keyStore';
import { formatShortRoomId, resolveRoomDisplayName } from '@/crypto/groupKey';
import { useRoomMessages } from '@/hooks/useRoomMessages';
import { submitMessageEdit, showMessageEditErrorToast } from '@/hooks/useMessageCore';
import type {
  UseRoomMessagesWebSocket,
  SendRoomFileOptions,
  RoomMessageErrorCode,
} from '@/hooks/useRoomMessages';
import type { RoomModerationEvent } from '@/hooks/useRoomModeration';
import { useHaptics } from '@/hooks/useHaptics';
import { isFilesErrorI18nKey } from '@/services/fileTransferErrors';
import type { DecryptedFileMessage, DecryptedMessage } from '@/types';
import '@/styles/ChatScreen.css';
import './RoomChatRoom.css';

// ============================================
// Component Props
// ============================================

interface RoomChatRoomProps {
  roomId: string;
  epoch?: number;
  nameEncrypted?: string | null;
  nameIv?: string | null;
  /** Current user's stable internal id (IMP-WALLETID-07) */
  userId: string;
  /** Telegram numeric id when linked — room message wire still uses tg id until IMP-WALLETID-08 */
  userTelegramId?: number;
  ws: UseRoomMessagesWebSocket;
  memberCount?: number;
  /** Whether the current user is the room owner (delete-for-everyone, key UI). */
  isOwner?: boolean;
  /** Whether the current user can post when the room is read-only (owner or admin). */
  canBypassReadOnly?: boolean;
  /** Whether a key re-request is currently in flight (P2-3.2.3). */
  isRequestingKey?: boolean;
  /** Retry callback for manual key re-request (P2-3.2.3). */
  onRequestKey?: () => void;
  onBack?: () => void;
  onManage?: () => void;
  onLeave?: () => void;
  /**
   * Out-ref populated with the hook's `syncMessages` function so parents
   * (AppContent) can trigger an offline-queue sync from outside the component,
   * e.g. when the Mini App returns from background (FIX-SYNC-3).
   */
  syncMessagesRef?: MutableRefObject<(() => void) | null>;
  /** Whether the room is in read-only mode (IMP-ROOM-12) */
  roomReadOnly?: boolean;
  /** Whether the current user is muted in this room */
  isCurrentUserMuted?: boolean;
  /** Forward ROOM_MODERATION events from the room topic to App-level state */
  onRoomModeration?: (event: RoomModerationEvent) => void;
  /** Per-message auto-destruction window in seconds; 0 = disabled (IMP-ROOM-19) */
  messageTtlSeconds?: number;
}

// ============================================
// Component
// ============================================

/**
 * RoomChatRoom — full chat UI for encrypted group rooms (P2-4.2.2).
 */
export const RoomChatRoom = memo(function RoomChatRoom({
  roomId,
  epoch = 0,
  nameEncrypted,
  nameIv,
  userId: userInternalId,
  userTelegramId,
  ws,
  memberCount,
  isOwner = false,
  canBypassReadOnly = false,
  isRequestingKey = false,
  onRequestKey,
  onBack,
  onManage,
  onLeave,
  syncMessagesRef,
  roomReadOnly = false,
  isCurrentUserMuted = false,
  onRoomModeration,
  messageTtlSeconds = 0,
}: RoomChatRoomProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const haptics = useHaptics();
  const messageSelection = useMessageSelection();
  const { announce, announcerRef } = useAnnouncer();
  const prevSelectionModeRef = useRef<'idle' | 'selecting'>('idle');
  const hasKey = hasGroupKey(roomId);
  const [displayTitle, setDisplayTitle] = useState(() => formatShortRoomId(roomId));
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null);
  const [deleteEveryoneIds, setDeleteEveryoneIds] = useState<string[] | null>(null);
  const [replyTarget, setReplyTarget] = useState<DecryptedMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DecryptedMessage | null>(null);
  const messageInputTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const roomPeerDisplayName = t('room.chat.fallbackPeer');
  const roomMessageUserId = userTelegramId ?? 0;

  useEffect(() => {
    let cancelled = false;
    void resolveRoomDisplayName(roomId, nameEncrypted, nameIv).then((label) => {
      if (!cancelled) {
        setDisplayTitle(label);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [roomId, nameEncrypted, nameIv]);

  useEffect(() => {
    if (messageSelection.mode !== 'selecting') {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        messageSelection.clear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [messageSelection.mode, messageSelection.clear]);

  useEffect(() => {
    const mode = messageSelection.mode;
    if (mode === 'selecting' && prevSelectionModeRef.current === 'idle') {
      announce(t('chat.a11y.selectionModeEntered'));
    }
    prevSelectionModeRef.current = mode;
  }, [messageSelection.mode, announce, t]);

  const selectCountDebounceRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  useEffect(() => {
    if (messageSelection.mode !== 'selecting' || messageSelection.count <= 1) {
      return;
    }
    if (selectCountDebounceRef.current) {
      clearTimeout(selectCountDebounceRef.current);
    }
    selectCountDebounceRef.current = globalThis.setTimeout(() => {
      announce(t('chat.a11y.selectedCount', { count: messageSelection.count }));
    }, 200);
    return () => {
      if (selectCountDebounceRef.current) {
        clearTimeout(selectCountDebounceRef.current);
      }
    };
  }, [messageSelection.count, messageSelection.mode, announce, t]);

  // P4-4-2-4: Full-screen media viewer
  const [viewerMessage, setViewerMessage] = useState<DecryptedFileMessage | null>(null);

  const handleOpenViewer = useCallback((msg: DecryptedFileMessage) => {
    setViewerMessage(msg);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setViewerMessage(null);
  }, []);

  // File selection / preview state
  const [pendingFile, setPendingFile] = useState<SelectedFileInfo | null>(null);
  const pendingCaptionRef = useRef<string | undefined>(undefined);

  // Upload in-flight tracking. Progress now lives on the optimistic message
  // bubble (Variant B); here we only track whether a send is active (to block
  // the composer + drive a single abort controller) and remember the last send
  // args so a failed bubble can be retried.
  const [isSendingFile, setIsSendingFile] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastSendRef = useRef<{ file: File; caption?: string; replyToMessageId?: string } | null>(null);

  const handleRoomMessageError = useCallback(
    (code: RoomMessageErrorCode, details?: string, i18nValues?: Record<string, string | number>) => {
      if (details === 'MUTED') {
        toast.error(t('room.chat.errorMuted'), { duration: 4000 });
        return;
      }
      if (details === 'ROOM_READ_ONLY') {
        toast.error(t('room.chat.errorReadOnly'), { duration: 4000 });
        return;
      }
      if (isFilesErrorI18nKey(details)) {
        toast.error(t(details!, i18nValues), { duration: 4000 });
        return;
      }
      if (code === 'DECRYPTION_FAILED') {
        toast.error(t('room.chat.decryptError'), { duration: 4000 });
        return;
      }
      toast.error(t('room.chat.sendError'), { duration: 4000 });
    },
    [t, toast],
  );

  const handleRoomEditError = useCallback(
    (code: string) => {
      if (code === 'WINDOW_EXPIRED') {
        toast.error(t('chat.edit.windowExpired'));
      } else {
        toast.error(t('chat.edit.failed'));
      }
    },
    [t, toast],
  );

  const onMessageDeletedByOwner = useCallback(() => {
    toast.info(t('chat.delete.removedByOwner'), { duration: 4000 });
  }, [t, toast]);

  const replyChip: ReplyChipModel | null = useMemo(() => {
    if (!replyTarget) {
      return null;
    }
    return {
      senderName: resolveReplyAuthor(replyTarget, userTelegramId, roomPeerDisplayName, t),
      preview: makeReplyPreview(replyTarget, t),
      type: replyTarget.type,
    };
  }, [replyTarget, userTelegramId, roomPeerDisplayName, t]);

  useEffect(() => {
    if (replyTarget) {
      messageInputTextAreaRef.current?.focus();
    }
  }, [replyTarget]);

  const { messages, sendMessage, sendFileMessage, isLoading, isSyncing, syncMessages, hideMessages, editMessage, deleteMessage } =
    useRoomMessages({
      roomId,
      userId: roomMessageUserId,
      userInternalId,
      ws,
      messageTtlSeconds,
      onError: handleRoomMessageError,
      onEditError: handleRoomEditError,
      onMessageDeletedByOwner,
      onRoomModeration,
    });

  const isEphemeralMode = messageTtlSeconds > 0;

  const isSendBlocked = isCurrentUserMuted || (roomReadOnly && !canBypassReadOnly);
  const moderationBannerKey = isCurrentUserMuted
    ? 'room.chat.mutedBanner'
    : roomReadOnly && !canBypassReadOnly
      ? 'room.chat.readOnlyBanner'
      : null;

  // Publish the hook's syncMessages up to AppContent via the ref so the
  // visibility-restore handler can invoke it (FIX-SYNC-3).
  useEffect(() => {
    if (!syncMessagesRef) return;
    syncMessagesRef.current = syncMessages;
    return () => {
      if (syncMessagesRef.current === syncMessages) {
        syncMessagesRef.current = null;
      }
    };
  }, [syncMessagesRef, syncMessages]);

  const handleCancelReply = useCallback(() => {
    setReplyTarget(null);
  }, []);

  const handleReplyToMessage = useCallback((message: DecryptedMessage) => {
    setReplyTarget(message);
  }, []);

  const handleStartEdit = useCallback((message: DecryptedMessage) => {
    setReplyTarget(null);
    setEditingMessage(message);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      haptics.success();
      if (editingMessage) {
        await submitMessageEdit({
          editMessage,
          editingMessage,
          text,
          showEditError: (errorCode) => showMessageEditErrorToast(errorCode, t, toast),
          onSuccess: () => {
            announce(t('chat.a11y.messageEdited'));
            setEditingMessage(null);
            messageInputTextAreaRef.current?.focus();
          },
        });
        return;
      }
      void sendMessage(text, { replyToMessageId: replyTarget?.id });
      setReplyTarget(null);
      messageInputTextAreaRef.current?.focus();
    },
    [sendMessage, haptics, replyTarget, editingMessage, editMessage, toast, t, announce],
  );

  const handleFileSelected = useCallback((info: SelectedFileInfo) => {
    setPendingFile(info);
  }, []);

  const runFileSend = useCallback(
    async (args: { file: File; caption?: string; replyToMessageId?: string }) => {
      lastSendRef.current = args;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsSendingFile(true);

      const options: SendRoomFileOptions = {
        signal: controller.signal,
        replyToMessageId: args.replyToMessageId,
      };

      const result = await sendFileMessage(args.file, args.caption, options);
      abortRef.current = null;
      setIsSendingFile(false);

      if (result.success) {
        setReplyTarget(null);
        messageInputTextAreaRef.current?.focus();
      }
    },
    [sendFileMessage],
  );

  const handlePreviewSend = useCallback(
    async (file: File, caption?: string) => {
      pendingCaptionRef.current = caption;
      setPendingFile(null);
      await runFileSend({ file, caption, replyToMessageId: replyTarget?.id });
    },
    [runFileSend, replyTarget],
  );

  const handlePreviewCancel = useCallback(() => {
    setPendingFile(null);
  }, []);

  const handleCancelUpload = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsSendingFile(false);
  }, []);

  const handleRetryUpload = useCallback(
    (messageId: string) => {
      const last = lastSendRef.current;
      hideMessages([messageId]);
      if (last) {
        void runFileSend(last);
      }
    },
    [hideMessages, runFileSend],
  );

  const isUploading = isSendingFile;

  const requestDeleteForMe = useCallback((ids: string[]) => {
    setDeleteConfirmIds(ids);
  }, []);

  const requestDeleteForEveryone = useCallback((ids: string[]) => {
    setDeleteEveryoneIds(ids);
  }, []);

  const selectionCanDeleteForEveryone = useMemo(() => {
    if (messageSelection.selectedIds.size === 0) {
      return false;
    }
    return Array.from(messageSelection.selectedIds).every(id => {
      const m = messages.find(x => x.id === id);
      return m && (m.isOwn || isOwner);
    });
  }, [messageSelection.selectedIds, messages, isOwner]);

  const everyoneConfirmDescription = useMemo(() => {
    if (!deleteEveryoneIds?.length) {
      return '';
    }
    const asOwner = deleteEveryoneIds.some(id => {
      const m = messages.find(x => x.id === id);
      return m && !m.isOwn;
    });
    return asOwner
      ? t('chat.delete.confirmDescriptionAsOwner')
      : t('chat.delete.confirmDescriptionForEveryone');
  }, [deleteEveryoneIds, messages, t]);

  const handleBulkCopy = useCallback(async () => {
    const selected = messages
      .filter((m) => messageSelection.selectedIds.has(m.id))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (selected.length === 0) return;
    const includeSenderName = selected.length > 1;
    const text = buildCopyText(selected, { includeSenderName });
    const ok = await writeTextToClipboard(text);
    if (ok) {
      toast.success(t('chat.actions.copyToast'));
      haptics.success();
    } else {
      toast.error(t('chat.actions.copyFailed'));
    }
  }, [messages, messageSelection.selectedIds, toast, t, haptics]);

  const handleConfirmDeleteForMe = useCallback(() => {
    if (deleteConfirmIds?.length) {
      hideMessages(deleteConfirmIds);
      toast.success(t('chat.delete.hidden'));
      announce(t('chat.a11y.messageDeleted'));
      haptics.destructive();
      messageSelection.clear();
    }
    setDeleteConfirmIds(null);
  }, [deleteConfirmIds, hideMessages, toast, t, haptics, messageSelection, announce]);

  const handleCancelDeleteForMe = useCallback(() => {
    setDeleteConfirmIds(null);
  }, []);

  const handleConfirmDeleteForEveryone = useCallback(async () => {
    if (!deleteEveryoneIds?.length) {
      setDeleteEveryoneIds(null);
      return;
    }
    for (const id of deleteEveryoneIds) {
      const r = await deleteMessage(id);
      if (!r.success) {
        toast.error(t('chat.delete.failed'));
        haptics.destructive();
        messageSelection.clear();
        setDeleteEveryoneIds(null);
        return;
      }
    }
    toast.success(t('chat.delete.forEveryoneDone'));
    announce(t('chat.a11y.messageDeleted'));
    haptics.destructive();
    messageSelection.clear();
    setDeleteEveryoneIds(null);
  }, [deleteEveryoneIds, deleteMessage, toast, t, haptics, messageSelection, announce]);

  const handleCancelDeleteForEveryone = useCallback(() => {
    setDeleteEveryoneIds(null);
  }, []);

  const handleLeaveClick = useCallback(() => {
    haptics.destructive();
    setShowLeaveConfirm(true);
  }, [haptics]);

  const handleLeaveConfirm = useCallback(() => {
    setShowLeaveConfirm(false);
    onLeave?.();
  }, [onLeave]);

  const handleLeaveCancel = useCallback(() => {
    setShowLeaveConfirm(false);
  }, []);

  const subtitle = hasKey
    ? memberCount != null
      ? t('room.chat.memberCount', { count: memberCount })
      : t('room.chat.epochSubtitle', { epoch })
    : t('room.chat.loadingKey');

  const placeholderIcon = isRequestingKey ? (
    <Key size={28} strokeWidth={1.75} aria-hidden />
  ) : isOwner ? (
    <RefreshCw size={28} strokeWidth={1.75} aria-hidden />
  ) : (
    <Hourglass size={28} strokeWidth={1.75} aria-hidden />
  );

  const headerLeft = (
    <div className="room-chat-room-info">
      <div className="room-chat-room-title">
        <span className="room-chat-room-icon" aria-hidden>
          <Home size={18} strokeWidth={2} />
        </span>
        <span className="room-chat-room-id">
          {displayTitle}
        </span>
        {hasKey && (
          <span
            className="room-chat-room-encrypted"
            title={t('room.chat.encryptedTitle')}
            aria-label={t('room.chat.encryptedTitle')}
          >
            <Lock size={16} strokeWidth={2} aria-hidden />
          </span>
        )}
        {isEphemeralMode && (
          <span
            className="room-chat-room-ephemeral-badge"
            title={t('room.chat.ephemeralBadge')}
            aria-label={t('room.chat.ephemeralBadge')}
          >
            <Timer size={14} strokeWidth={2} aria-hidden />
            <span className="room-chat-room-ephemeral-badge__label">
              {t('room.chat.ephemeralBadge')}
            </span>
          </span>
        )}
      </div>
      <div className="room-chat-room-subtitle">{subtitle}</div>
    </div>
  );

  const hasHeaderRight = onManage != null || onLeave != null;
  const headerRight = hasHeaderRight ? (
    <>
      {onManage && (
        <button
          type="button"
          className="chat-screen-icon-btn room-chat-room-manage"
          onClick={onManage}
          aria-label={t('room.manage.title')}
        >
          <Settings size={20} strokeWidth={2} aria-hidden />
        </button>
      )}
      {onLeave && (
        <button
          type="button"
          className="chat-screen-icon-btn room-chat-room-leave"
          onClick={handleLeaveClick}
          aria-label={t('room.manage.leaveButton')}
        >
          <LogOut size={20} strokeWidth={2} aria-hidden />
        </button>
      )}
    </>
  ) : undefined;

  return (
    <div className="chat-screen room-chat-room">
      <div ref={announcerRef} className="visually-hidden" role="status" />
      {messageSelection.mode === 'selecting' ? (
        <ChatSelectionBar
          count={messageSelection.count}
          onClose={messageSelection.clear}
          onCopy={handleBulkCopy}
          onRequestDeleteForMe={() => {
            requestDeleteForMe(Array.from(messageSelection.selectedIds));
          }}
          onRequestDeleteForEveryone={() => {
            if (selectionCanDeleteForEveryone) {
              requestDeleteForEveryone(Array.from(messageSelection.selectedIds));
            }
          }}
          deleteForEveryoneDisabled={!selectionCanDeleteForEveryone}
          deleteForEveryoneDisabledHint={t('chat.delete.mixedSelection')}
        />
      ) : (
        <ChatScreenHeader
          onBack={onBack}
          backAriaLabel={t('common.back')}
          left={headerLeft}
          right={headerRight}
        />
      )}

      {hasKey ? (
        <>
          <MessageList
            messages={messages}
            isLoading={isLoading || isSyncing}
            onCancelUpload={handleCancelUpload}
            onRetryUpload={handleRetryUpload}
            onOpenViewer={handleOpenViewer}
            selection={messageSelection}
            onRequestDeleteForMe={requestDeleteForMe}
            onRequestDeleteForEveryone={requestDeleteForEveryone}
            canDeleteForEveryone={m => m.isOwn || isOwner}
            userTelegramId={roomMessageUserId || undefined}
            peerDisplayName={roomPeerDisplayName}
            onReplyToMessage={handleReplyToMessage}
            onEditMessage={handleStartEdit}
            className="room-chat-room-messages chat-screen-messages"
          />
          {moderationBannerKey && (
            <div className="room-chat-room-moderation-banner" role="status">
              {isCurrentUserMuted ? (
                <MicOff size={16} className="room-chat-room-moderation-banner__icon" aria-hidden />
              ) : (
                <Lock size={16} className="room-chat-room-moderation-banner__icon" aria-hidden />
              )}
              <span>{t(moderationBannerKey)}</span>
            </div>
          )}
          {!isSendBlocked && (
            <div className="chat-screen-input">
              <MessageInput
                onSend={handleSend}
                onFileSelected={handleFileSelected}
                isUploading={isUploading}
                placeholder={t('room.chat.messagePlaceholder')}
                replyTo={editingMessage ? null : replyChip}
                onReplyCancel={editingMessage ? undefined : handleCancelReply}
                editMode={
                  editingMessage
                    ? { initialText: editingMessage.content, onCancel: handleCancelEdit }
                    : null
                }
                textAreaRef={messageInputTextAreaRef}
              />
            </div>
          )}
        </>
      ) : (
        <div className="room-chat-room-body">
          <div className="room-chat-room-placeholder">
            <div className="room-chat-room-placeholder-icon" aria-hidden>
              {placeholderIcon}
            </div>
            <div className="room-chat-room-placeholder-text">
              {isOwner
                ? t('room.chat.ownerRekeying')
                : isRequestingKey
                  ? t('room.chat.requestingKey')
                  : t('room.chat.loadingKey')}
            </div>
            <div className="room-chat-room-placeholder-hint">
              {isOwner
                ? t('room.chat.ownerRekeyingHint')
                : t('room.chat.ownerOfflineHint')}
            </div>
            {!isOwner && onRequestKey && (
              <button
                type="button"
                className={`room-chat-room-retry-btn${isRequestingKey ? ' room-chat-room-retry-btn--loading' : ''}`}
                onClick={onRequestKey}
                disabled={isRequestingKey}
                aria-busy={isRequestingKey}
              >
                {isRequestingKey && (
                  <span className="room-chat-room-retry-btn__spinner" aria-hidden />
                )}
                {isRequestingKey ? t('room.chat.requestingKey') : t('room.chat.retryKey')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pre-send file preview overlay */}
      {pendingFile && (
        <FilePreview
          file={pendingFile.file}
          messageType={pendingFile.messageType}
          onSend={handlePreviewSend}
          onCancel={handlePreviewCancel}
        />
      )}

      {/* P4-4-2-4: Full-screen media viewer */}
      {viewerMessage && (
        <MediaViewer message={viewerMessage} onClose={handleCloseViewer} />
      )}

      <ConfirmDialog
        isOpen={showLeaveConfirm}
        onClose={handleLeaveCancel}
        onConfirm={handleLeaveConfirm}
        title={t('room.leave.title')}
        description={t('room.leave.description')}
        warning={t('room.leave.warning')}
        confirmLabel={t('room.leave.confirmButton')}
        cancelLabel={t('common.cancel')}
        variant="destructive"
        iconType="leave"
      />

      <ConfirmDialog
        isOpen={!!deleteConfirmIds?.length}
        onClose={handleCancelDeleteForMe}
        onConfirm={handleConfirmDeleteForMe}
        title={t('chat.delete.confirmTitleForMe')}
        description={t('chat.delete.confirmDescriptionForMe', {
          context: t('chat.delete.contextRoom'),
        })}
        confirmLabel={t('chat.delete.deleteForMeLabel')}
        cancelLabel={t('common.cancel')}
        variant="destructive"
        iconType="delete"
      />

      <ConfirmDialog
        isOpen={!!deleteEveryoneIds?.length}
        onClose={handleCancelDeleteForEveryone}
        onConfirm={() => { void handleConfirmDeleteForEveryone(); }}
        title={t('chat.delete.confirmTitleForEveryone')}
        description={everyoneConfirmDescription}
        confirmLabel={t('chat.delete.deleteForEveryoneLabel')}
        cancelLabel={t('common.cancel')}
        variant="destructive"
        iconType="delete"
      />
    </div>
  );
});
