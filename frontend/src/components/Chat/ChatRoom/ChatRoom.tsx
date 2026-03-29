import { memo, useCallback, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, Lock, Star, AlertCircle } from 'lucide-react';
import { MessageList } from '../MessageList';
import { MessageInput } from '../MessageInput';
import type { SelectedFileInfo } from '../MessageInput';
import { FilePreview } from '../FilePreview';
import { MediaViewer } from '../MediaViewer';
import { ChatScreenHeader } from '../ChatScreenHeader';
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
  onSendMessage: (text: string) => void;
  /** Callback when file is sent (P4-3-2-1) */
  onSendFile?: (file: File, caption?: string) => void;
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
}: ChatRoomProps) {
  const { t } = useTranslation();
  const haptics = useHaptics();
  const displayName = peer?.displayName?.trim() || `User ${peer?.id ?? ''}`.trim() || t('common.unknown');

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

  const handleSend = useCallback((text: string) => {
    haptics.success();
    onSendMessage(text);
  }, [onSendMessage, haptics]);

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
  const handlePreviewSend = useCallback((file: File, caption?: string) => {
    pendingCaptionRef.current = caption;
    setPendingFile(null);
    onSendFile?.(file, caption);
  }, [onSendFile]);

  const handlePreviewCancel = useCallback(() => {
    setPendingFile(null);
  }, []);

  const isUploading = !!uploadState && uploadState.stage !== 'failed';

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
      <ChatScreenHeader
        onBack={onBack}
        backAriaLabel={t('common.back')}
        left={headerLeft}
        right={headerRight}
      />

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
    </div>
  );
});
