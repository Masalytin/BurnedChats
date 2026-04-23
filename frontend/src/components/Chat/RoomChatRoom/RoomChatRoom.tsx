import { memo, useCallback, useEffect, useState, useRef, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
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
import { MediaViewer } from '../MediaViewer';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { hasGroupKey } from '@/crypto/keyStore';
import { useRoomMessages } from '@/hooks/useRoomMessages';
import type {
  UseRoomMessagesWebSocket,
  SendRoomFileOptions,
  RoomMessageErrorCode,
} from '@/hooks/useRoomMessages';
import { useHaptics } from '@/hooks/useHaptics';
import { isFilesErrorI18nKey } from '@/services/fileTransferErrors';
import type { UploadStage } from '../UploadProgressOverlay';
import type { DecryptedFileMessage, DecryptedMessage } from '@/types';
import '@/styles/ChatScreen.css';
import './RoomChatRoom.css';

// ============================================
// Icons (room-specific, not in header)
// ============================================

function LeaveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13 14l4-4-4-4M17 10H7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 3H5a1 1 0 00-1 1v12a1 1 0 001 1h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10 2v2m0 12v2M2 10h2m12 0h2m-3.172-4.828-1.414 1.414M4.586 15.414l1.414-1.414m0-8.414L4.586 4.586m11.828 11.828-1.414-1.414"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ============================================
// Component Props
// ============================================

interface RoomChatRoomProps {
  roomId: string;
  epoch?: number;
  userId: number;
  ws: UseRoomMessagesWebSocket;
  memberCount?: number;
  isOwner?: boolean;
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
  userId,
  ws,
  memberCount,
  isOwner = false,
  isRequestingKey = false,
  onRequestKey,
  onBack,
  onManage,
  onLeave,
  syncMessagesRef,
}: RoomChatRoomProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const haptics = useHaptics();
  const messageSelection = useMessageSelection();
  const hasKey = hasGroupKey(roomId);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null);
  const [deleteEveryoneIds, setDeleteEveryoneIds] = useState<string[] | null>(null);
  const [replyTarget, setReplyTarget] = useState<DecryptedMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DecryptedMessage | null>(null);
  const messageInputTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const roomPeerDisplayName = t('room.chat.fallbackPeer');

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

  // Upload progress tracking
  const [uploadState, setUploadState] = useState<{
    progress: number;
    stage: UploadStage;
    fileName: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleRoomMessageError = useCallback(
    (_code: RoomMessageErrorCode, details?: string, i18nValues?: Record<string, string | number>) => {
      const msg = isFilesErrorI18nKey(details)
        ? t(details!, i18nValues)
        : t('room.chat.sendError');
      toast.error(msg, { duration: 4000 });
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
      senderName: resolveReplyAuthor(replyTarget, userId, roomPeerDisplayName, t),
      preview: makeReplyPreview(replyTarget, t),
      type: replyTarget.type,
    };
  }, [replyTarget, userId, roomPeerDisplayName, t]);

  useEffect(() => {
    if (replyTarget) {
      messageInputTextAreaRef.current?.focus();
    }
  }, [replyTarget]);

  const { messages, sendMessage, sendFileMessage, isLoading, isSyncing, syncMessages, hideMessages, editMessage, deleteMessage } =
    useRoomMessages({
      roomId,
      userId,
      ws,
      onError: handleRoomMessageError,
      onEditError: handleRoomEditError,
      onMessageDeletedByOwner,
    });

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
        const result = await editMessage(
          editingMessage.id,
          text,
          editingMessage.timestamp,
        );
        if (!result.success) {
          if (result.errorCode === 'WINDOW_EXPIRED') {
            toast.error(t('chat.edit.windowExpired'));
          } else {
            toast.error(t('chat.edit.failed'));
          }
          return;
        }
        setEditingMessage(null);
        messageInputTextAreaRef.current?.focus();
        return;
      }
      void sendMessage(text, { replyToMessageId: replyTarget?.id });
      setReplyTarget(null);
      messageInputTextAreaRef.current?.focus();
    },
    [sendMessage, haptics, replyTarget, editingMessage, editMessage, toast, t],
  );

  const handleFileSelected = useCallback((info: SelectedFileInfo) => {
    setPendingFile(info);
  }, []);

  const handlePreviewSend = useCallback(async (file: File, caption?: string) => {
    pendingCaptionRef.current = caption;
    setPendingFile(null);

    const controller = new AbortController();
    abortRef.current = controller;

    setUploadState({ progress: 0, stage: 'encrypting', fileName: file.name });

    const options: SendRoomFileOptions = {
      onEncryptProgress: (percent) => {
        setUploadState(prev =>
          prev ? { ...prev, progress: percent, stage: 'encrypting' } : null,
        );
      },
      onProgress: (percent) => {
        setUploadState(prev => prev ? { ...prev, progress: percent, stage: 'uploading' } : null);
      },
      signal: controller.signal,
      replyToMessageId: replyTarget?.id,
    };

    const result = await sendFileMessage(file, caption, options);
    abortRef.current = null;

    if (result.success) {
      setReplyTarget(null);
      messageInputTextAreaRef.current?.focus();
      setUploadState(null);
    } else {
      setUploadState(prev => prev ? { ...prev, stage: 'failed' } : null);
    }
  }, [sendFileMessage]);

  const handlePreviewCancel = useCallback(() => {
    setPendingFile(null);
  }, []);

  const handleCancelUpload = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setUploadState(null);
  }, []);

  const handleRetryUpload = useCallback(() => {
    setUploadState(null);
  }, []);

  const isUploading = !!uploadState && uploadState.stage !== 'failed';

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
      haptics.destructive();
      messageSelection.clear();
    }
    setDeleteConfirmIds(null);
  }, [deleteConfirmIds, hideMessages, toast, t, haptics, messageSelection]);

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
    haptics.destructive();
    messageSelection.clear();
    setDeleteEveryoneIds(null);
  }, [deleteEveryoneIds, deleteMessage, toast, t, haptics, messageSelection]);

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
      : `E2EE · epoch ${epoch}`
    : t('room.chat.loadingKey');

  const headerLeft = (
    <div className="room-chat-room-info">
      <div className="room-chat-room-title">
        <span className="room-chat-room-icon">🏠</span>
        <span className="room-chat-room-id">
          {roomId.length > 12 ? `${roomId.slice(0, 8)}…` : roomId}
        </span>
        {hasKey && (
          <span className="room-chat-room-encrypted" title="End-to-End Encrypted">
            🔒
          </span>
        )}
      </div>
      <div className="room-chat-room-subtitle">{subtitle}</div>
    </div>
  );

  const hasHeaderRight = (isOwner && onManage) || (!isOwner && onLeave);
  const headerRight = hasHeaderRight ? (
    <>
      {isOwner && onManage && (
        <button
          type="button"
          className="room-chat-room-manage"
          onClick={onManage}
          aria-label={t('room.manage.title')}
        >
          <SettingsIcon />
        </button>
      )}
      {!isOwner && onLeave && (
        <button
          type="button"
          className="room-chat-room-leave"
          onClick={handleLeaveClick}
          aria-label={t('room.manage.leaveButton')}
        >
          <LeaveIcon />
        </button>
      )}
    </>
  ) : undefined;

  return (
    <div className="chat-screen room-chat-room">
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
            uploadState={uploadState ?? undefined}
            onCancelUpload={handleCancelUpload}
            onRetryUpload={handleRetryUpload}
            onOpenViewer={handleOpenViewer}
            selection={messageSelection}
            onRequestDeleteForMe={requestDeleteForMe}
            onRequestDeleteForEveryone={requestDeleteForEveryone}
            canDeleteForEveryone={m => m.isOwn || isOwner}
            userId={userId}
            peerDisplayName={roomPeerDisplayName}
            onReplyToMessage={handleReplyToMessage}
            onEditMessage={handleStartEdit}
            className="room-chat-room-messages chat-screen-messages"
          />
          <div className="chat-screen-input">
            <MessageInput
              onSend={handleSend}
              onFileSelected={handleFileSelected}
              isUploading={isUploading}
              placeholder={t('chat.messagePlaceholder', { name: '🏠' })}
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
        </>
      ) : (
        <div className="room-chat-room-body">
          <div className="room-chat-room-placeholder">
            <div className="room-chat-room-placeholder-icon">
              {isRequestingKey ? '🔑' : isOwner ? '🔄' : '⏳'}
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
                className="room-chat-room-retry-btn"
                onClick={onRequestKey}
                disabled={isRequestingKey}
              >
                {t('room.chat.retryKey')}
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
        icon={<span role="img" aria-hidden>🚪</span>}
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
        icon={<span role="img" aria-hidden>🗑️</span>}
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
        icon={<span role="img" aria-hidden>🗑️</span>}
      />
    </div>
  );
});
