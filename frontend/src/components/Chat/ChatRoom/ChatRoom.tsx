import { memo, useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, Lock, Star, AlertCircle } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { buildCopyText } from '@/components/Chat/messageActions/copyMessage';
import { writeTextToClipboard } from '@/utils/clipboard';
import { MessageList } from '../MessageList';
import { MessageInput } from '../MessageInput';
import { makeReplyPreview, resolveReplyAuthor } from '@/utils/replyPreview';
import type { ReplyChipModel } from '../ReplyChip';
import type { SelectedFileInfo } from '../MessageInput';
import { FilePreview } from '../FilePreview';
import { MediaViewer } from '../MediaViewer';
import { ChatScreenHeader } from '../ChatScreenHeader';
import { ChatSelectionBar } from '../ChatSelectionBar';
import { useMessageSelection } from '@/hooks/useMessageSelection';
import { Avatar } from '@/components/Avatar';
import { useHaptics } from '@/hooks/useHaptics';
import type { UploadStage } from '../UploadProgressOverlay';
import type { DecryptedMessage, DecryptedFileMessage, UserInfo } from '@/types';
import '@/styles/ChatScreen.css';
import './ChatRoom.css';

export interface FileUploadState {
  progress: number;
  stage: UploadStage;
  fileName: string;
}

interface ChatRoomProps {
  /** Current user's Telegram id (IMP-MA-03 reply author labels) */
  userId: number;
  /** Session ID for the chat */
  sessionId: string;
  /** Information about the peer user */
  peer: UserInfo;
  /** Array of decrypted messages */
  messages: DecryptedMessage[];
  /** Whether the peer is currently typing */
  isPeerTyping?: boolean;
  /** Whether messages are loading */
  isLoading?: boolean;
  /** Whether peer is verified (fingerprint matched) */
  isVerified?: boolean;
  /** Callback when message is sent */
  onSendMessage: (text: string, options?: { replyToMessageId?: string }) => void;
  /** Callback when file is sent (P4-3-2-1) */
  onSendFile?: (file: File, caption?: string, options?: { replyToMessageId?: string }) => void;
  /** Callback when user typing status changes */
  onTypingChange?: (isTyping: boolean) => void;
  /** Callback when burn button is clicked */
  onBurn?: () => void;
  /** Callback to go back */
  onBack?: () => void;
  /** Whether the chat is disabled (e.g., during burn) */
  disabled?: boolean;
  /** Optional error message to show when disabled (e.g. "Chat temporarily unavailable") */
  errorMessage?: string;
  /** External upload state (driven by parent or hook) */
  uploadState?: FileUploadState | null;
  /** Cancel current upload */
  onCancelUpload?: () => void;
  /** Retry failed upload */
  onRetryUpload?: () => void;
  /** Optional CSS class name */
  className?: string;
  /** Locally hide messages (delete for me) */
  hideMessages?: (ids: string | string[]) => void;
  /** Edit own message (IMP-MA-04) */
  onEditMessage?: (
    messageId: string,
    newText: string,
    originalClientTimestamp: number,
  ) => Promise<{ success: boolean; errorCode?: string }>;
}

/**
 * ChatRoom component (4.3.1)
 *
 * Main chat container that combines:
 * - Chat header with peer info
 * - Message list with auto-scroll
 * - Message input with typing indicator
 * - Burn button for destroying the session
 * - File picker + preview + upload progress (P4-4-1-1 / P4-4-1-2 / P4-4-1-3)
 */
export const ChatRoom = memo(function ChatRoom({
  userId,
  sessionId: _sessionId,
  peer,
  messages,
  isPeerTyping = false,
  isLoading = false,
  isVerified = false,
  onSendMessage,
  onSendFile,
  onTypingChange,
  onBurn,
  onBack,
  disabled = false,
  errorMessage,
  uploadState,
  onCancelUpload,
  onRetryUpload,
  className = '',
  hideMessages,
  onEditMessage,
}: ChatRoomProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const haptics = useHaptics();
  const messageSelection = useMessageSelection();
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null);
  const [replyTarget, setReplyTarget] = useState<DecryptedMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DecryptedMessage | null>(null);
  const messageInputTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const displayName = peer?.displayName?.trim() || `User ${peer?.id ?? ''}`.trim() || t('common.unknown');

  const replyChip: ReplyChipModel | null = useMemo(() => {
    if (!replyTarget) {
      return null;
    }
    return {
      senderName: resolveReplyAuthor(replyTarget, userId, displayName, t),
      preview: makeReplyPreview(replyTarget, t),
      type: replyTarget.type,
    };
  }, [replyTarget, userId, displayName, t]);

  useEffect(() => {
    if (replyTarget) {
      messageInputTextAreaRef.current?.focus();
    }
  }, [replyTarget]);

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

  // P4-4-1-2: File selected but not yet confirmed
  const [pendingFile, setPendingFile] = useState<SelectedFileInfo | null>(null);
  const pendingCaptionRef = useRef<string | undefined>(undefined);

  // P4-4-2-4: Full-screen media viewer
  const [viewerMessage, setViewerMessage] = useState<DecryptedFileMessage | null>(null);

  const handleOpenViewer = useCallback((msg: DecryptedFileMessage) => {
    setViewerMessage(msg);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setViewerMessage(null);
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      haptics.success();
      if (editingMessage) {
        if (!onEditMessage) {
          setEditingMessage(null);
          return;
        }
        const result = await onEditMessage(
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
      onSendMessage(text, { replyToMessageId: replyTarget?.id });
      setReplyTarget(null);
      messageInputTextAreaRef.current?.focus();
    },
    [onSendMessage, haptics, replyTarget, editingMessage, onEditMessage, toast, t],
  );

  const handleCancelReply = useCallback(() => {
    setReplyTarget(null);
  }, []);

  const handleReplyToMessage = useCallback(
    (message: DecryptedMessage) => {
      setReplyTarget(message);
    },
    [],
  );

  const handleStartEdit = useCallback((message: DecryptedMessage) => {
    setReplyTarget(null);
    setEditingMessage(message);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
  }, []);

  const handleTypingChange = useCallback((isTyping: boolean) => {
    onTypingChange?.(isTyping);
  }, [onTypingChange]);

  const handleBurnClick = useCallback(() => {
    haptics.destructive();
    onBurn?.();
  }, [onBurn, haptics]);

  // P4-4-1-1: File selected from picker → show preview
  const handleFileSelected = useCallback((info: SelectedFileInfo) => {
    setPendingFile(info);
  }, []);

  // P4-4-1-2: Confirmed send from preview
  const handlePreviewSend = useCallback(
    (file: File, caption?: string) => {
      pendingCaptionRef.current = caption;
      setPendingFile(null);
      onSendFile?.(file, caption, { replyToMessageId: replyTarget?.id });
      setReplyTarget(null);
      messageInputTextAreaRef.current?.focus();
    },
    [onSendFile, replyTarget],
  );

  const handlePreviewCancel = useCallback(() => {
    setPendingFile(null);
  }, []);

  const isUploading = !!uploadState && uploadState.stage !== 'failed';

  const requestDeleteForMe = useCallback((ids: string[]) => {
    setDeleteConfirmIds(ids);
  }, []);

  const handleBulkCopy = useCallback(async () => {
    const selected = messages
      .filter((m) => messageSelection.selectedIds.has(m.id))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (selected.length === 0) return;
    const text = buildCopyText(selected, { includeSenderName: false });
    const ok = await writeTextToClipboard(text);
    if (ok) {
      toast.success(t('chat.actions.copyToast'));
      haptics.success();
    } else {
      toast.error(t('chat.actions.copyFailed'));
    }
  }, [messages, messageSelection.selectedIds, toast, t, haptics]);

  const handleConfirmDeleteForMe = useCallback(() => {
    if (deleteConfirmIds?.length && hideMessages) {
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

  const headerLeft = (
    <>
      <Avatar
        name={displayName}
        src={peer.photoUrl}
        size="sm"
      />
      <div className="chat-room-peer-info">
        <div className="chat-room-peer-name">
          {displayName}
          {peer.premium && (
            <span
              className="chat-room-premium"
              title={t('chat.premiumTitle')}
              aria-label={t('chat.premiumTitle')}
            >
              <Star size={16} aria-hidden />
            </span>
          )}
          {isVerified && (
            <span
              className="chat-room-verified"
              title={t('chat.verifiedTitle')}
              aria-label={t('chat.verifiedTitle')}
            >
              <Lock size={16} aria-hidden />
            </span>
          )}
        </div>
        <div className="chat-room-peer-status">
          {isPeerTyping ? (
            <span className="chat-room-typing">{t('status.typing')}</span>
          ) : peer.online ? (
            <span className="chat-room-online">{t('status.online')}</span>
          ) : (
            <span className="chat-room-offline">{t('status.offline')}</span>
          )}
        </div>
      </div>
    </>
  );

  const headerRight = onBurn ? (
    <button
      type="button"
      className="chat-room-burn"
      onClick={handleBurnClick}
      disabled={disabled}
      aria-label={t('chat.burnButtonLabel')}
      title={t('chat.burnButtonTitle')}
    >
      <Flame size={22} aria-hidden />
    </button>
  ) : undefined;

  return (
    <div className={`chat-screen chat-room ${className}`}>
      {messageSelection.mode === 'selecting' ? (
        <ChatSelectionBar
          count={messageSelection.count}
          onClose={messageSelection.clear}
          onCopy={handleBulkCopy}
          onRequestDeleteForMe={() => {
            requestDeleteForMe(Array.from(messageSelection.selectedIds));
          }}
        />
      ) : (
        <ChatScreenHeader
          onBack={onBack}
          backAriaLabel={t('common.back')}
          left={headerLeft}
          right={headerRight}
        />
      )}

      {errorMessage && disabled && (
        <div
          className="chat-room-error-banner"
          role="alert"
          aria-label={t('chat.errorBannerLabel')}
        >
          <AlertCircle size={18} className="chat-room-error-banner-icon" aria-hidden />
          <span>{errorMessage}</span>
        </div>
      )}

      <MessageList
        messages={messages}
        isPeerTyping={isPeerTyping}
        peerName={displayName}
        isLoading={isLoading}
        uploadState={uploadState ?? undefined}
        onCancelUpload={onCancelUpload}
        onRetryUpload={onRetryUpload}
        onOpenViewer={handleOpenViewer}
        selection={messageSelection}
        onRequestDeleteForMe={requestDeleteForMe}
        userId={userId}
        peerDisplayName={displayName}
        onReplyToMessage={handleReplyToMessage}
        onEditMessage={onEditMessage ? handleStartEdit : undefined}
        className="chat-room-messages chat-screen-messages"
      />

      <div className="chat-screen-input">
        <MessageInput
          onSend={handleSend}
          onFileSelected={onSendFile ? handleFileSelected : undefined}
          onTypingChange={handleTypingChange}
          disabled={disabled}
          isUploading={isUploading}
          placeholder={t('chat.messagePlaceholder', { name: displayName })}
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

      {/* P4-4-1-2: Pre-send preview overlay */}
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
        isOpen={!!deleteConfirmIds?.length}
        onClose={handleCancelDeleteForMe}
        onConfirm={handleConfirmDeleteForMe}
        title={t('chat.delete.confirmTitleForMe')}
        description={t('chat.delete.confirmDescriptionForMe', {
          context: t('chat.delete.contextPeer'),
        })}
        confirmLabel={t('chat.delete.deleteForMeLabel')}
        cancelLabel={t('common.cancel')}
        variant="destructive"
        icon={<span role="img" aria-hidden>🗑️</span>}
      />
    </div>
  );
});
