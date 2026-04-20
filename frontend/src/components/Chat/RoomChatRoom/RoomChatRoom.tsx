import { memo, useCallback, useEffect, useState, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageList } from '../MessageList';
import { MessageInput } from '../MessageInput';
import type { SelectedFileInfo } from '../MessageInput';
import { FilePreview } from '../FilePreview';
import { ChatScreenHeader } from '../ChatScreenHeader';
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
import type { DecryptedFileMessage } from '@/types';
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
  const hasKey = hasGroupKey(roomId);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

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

  const { messages, sendMessage, sendFileMessage, isLoading, isSyncing, syncMessages } = useRoomMessages({
    roomId,
    userId,
    ws,
    onError: handleRoomMessageError,
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

  const handleSend = useCallback((text: string) => {
    haptics.success();
    sendMessage(text);
  }, [sendMessage, haptics]);

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
    };

    const result = await sendFileMessage(file, caption, options);
    abortRef.current = null;

    if (result.success) {
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
      <ChatScreenHeader
        onBack={onBack}
        backAriaLabel={t('common.back')}
        left={headerLeft}
        right={headerRight}
      />

      {hasKey ? (
        <>
          <MessageList
            messages={messages}
            isLoading={isLoading || isSyncing}
            uploadState={uploadState ?? undefined}
            onCancelUpload={handleCancelUpload}
            onRetryUpload={handleRetryUpload}
            onOpenViewer={handleOpenViewer}
            className="room-chat-room-messages chat-screen-messages"
          />
          <div className="chat-screen-input">
            <MessageInput
              onSend={handleSend}
              onFileSelected={handleFileSelected}
              isUploading={isUploading}
              placeholder={t('chat.messagePlaceholder', { name: '🏠' })}
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
    </div>
  );
});
