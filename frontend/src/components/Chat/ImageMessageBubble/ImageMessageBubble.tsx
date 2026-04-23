import { memo, useState, useCallback, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DecryptedFileMessage, ReplyToInfo } from '@/types';
import { useHaptics } from '@/hooks/useHaptics';
import { useLongPress } from '@/hooks/useLongPress';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import type { UseMessageSelectionReturn } from '@/hooks/useMessageSelection';
import { mergeMessagePointerHandlers } from '@/utils/messagePointerMerge';
import { ReplyQuote } from '../ReplyQuote';
import '../Message/Message.css';
import { downloadThumbnail, evictCachedFile } from '@/services/fileDownloadService';
import { enqueueDownload } from '@/services/transferQueue';
import { FileTransferError, fileTransferErrorI18nKey } from '@/services/fileTransferErrors';
import { resolveDecryptionKey } from '@/crypto/keyStore';
import { useDecryptionKey } from '@/hooks/useDecryptionKey';
import { formatLocalizedFileSize } from '@/utils/formatLocalizedFileSize';
import './ImageMessageBubble.css';

type MessageStatus = DecryptedFileMessage['status'];

interface ImageMessageBubbleProps {
  message: DecryptedFileMessage;
  onOpenViewer?: (message: DecryptedFileMessage) => void;
  selection?: UseMessageSelectionReturn;
  onOpenActionMenu?: (messageId: string, anchor: DOMRect) => void;
  replyTo?: ReplyToInfo;
  replySenderLabel?: string;
  onReplyQuoteClick?: (messageId: string) => void;
  onSwipeReply?: () => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Image message bubble: displays a thumbnail preview inside a chat bubble.
 * Tapping downloads the full-size image and opens the viewer (P4-4-2-4).
 */
export const ImageMessageBubble = memo(function ImageMessageBubble({
  message,
  onOpenViewer,
  selection,
  onOpenActionMenu,
  replyTo,
  replySenderLabel,
  onReplyQuoteClick,
  onSwipeReply,
}: ImageMessageBubbleProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const haptics = useHaptics();
  const menuEnabled = Boolean(onOpenActionMenu);
  const isSelecting = selection?.mode === 'selecting';
  const isSelected = selection ? selection.isSelected(message.id) : false;

  const handleOpenMenu = useCallback(() => {
    if (!onOpenActionMenu || !rootRef.current) return;
    haptics.selectionChanged();
    onOpenActionMenu(message.id, rootRef.current.getBoundingClientRect());
  }, [haptics, message.id, onOpenActionMenu]);

  const { handlers: longPress } = useLongPress({
    enabled: menuEnabled && !isSelecting,
    onLongPress: handleOpenMenu,
  });
  const swipe = useSwipeGesture({
    onSwipeRight: () => {
      haptics.selectionChanged();
      onSwipeReply?.();
    },
    enabled: menuEnabled && !isSelecting && Boolean(onSwipeReply),
  });
  const handlers = mergeMessagePointerHandlers(longPress, onSwipeReply ? swipe : null);

  const shouldInteract = menuEnabled || isSelecting;
  const decryptionKey = useDecryptionKey(message.sessionId);

  const [thumbnailState, setThumbnailState] = useState<'loading' | 'loaded' | 'error'>(
    message.thumbnailUrl ? 'loaded' : message.thumbnailFileId ? 'loading' : 'error',
  );
  const [thumbnailSrc, setThumbnailSrc] = useState<string | undefined>(message.thumbnailUrl);
  const [thumbnailErrorKey, setThumbnailErrorKey] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [fullDownloadErrorKey, setFullDownloadErrorKey] = useState<string | null>(null);

  const hasCaption = message.content && !message.content.startsWith('📷');
  const formattedTime = formatTime(message.timestamp);
  const formattedSize = formatLocalizedFileSize(message.fileSize, t);

  const handleThumbnailError = useCallback(() => {
    setThumbnailState('error');
  }, []);

  const handleThumbnailLoad = useCallback(() => {
    setThumbnailState('loaded');
  }, []);

  const handleRetryThumbnail = useCallback(async () => {
    if (!message.thumbnailFileId) return;
    setThumbnailState('loading');
    setThumbnailErrorKey(null);
    try {
      if (!decryptionKey) {
        resolveDecryptionKey(message.sessionId);
        setThumbnailErrorKey('files.error.decryptFailed');
        setThumbnailState('error');
        return;
      }
      const url = await downloadThumbnail(message.thumbnailFileId, decryptionKey);
      setThumbnailSrc(url);
      setThumbnailState('loaded');
    } catch (err) {
      if (err instanceof FileTransferError) {
        setThumbnailErrorKey(fileTransferErrorI18nKey(err));
      } else {
        setThumbnailErrorKey('files.error.serverError');
      }
      evictCachedFile(message.thumbnailFileId);
      setThumbnailState('error');
    }
  }, [message.thumbnailFileId, message.sessionId, decryptionKey]);

  const handleRetryFullImage = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setFullDownloadErrorKey(null);
      evictCachedFile(message.fileId);
    },
    [message.fileId],
  );

  const handleTap = useCallback(async () => {
    if (isSelecting) {
      selection?.toggle(message.id);
      return;
    }
    if (downloadProgress !== null) return;

    if (onOpenViewer) {
      setDownloadProgress(0);
      setFullDownloadErrorKey(null);
      try {
        if (!decryptionKey) {
          resolveDecryptionKey(message.sessionId);
          setDownloadProgress(null);
          setFullDownloadErrorKey('files.error.decryptFailed');
          return;
        }
        await enqueueDownload(message.fileId, decryptionKey, {
          onProgress: (percent) => setDownloadProgress(percent),
          mimeType: message.fileMeta?.mimeType,
        }).result;
        setDownloadProgress(null);
        onOpenViewer(message);
      } catch (err) {
        setDownloadProgress(null);
        if (err instanceof FileTransferError) {
          setFullDownloadErrorKey(fileTransferErrorI18nKey(err));
        } else {
          setFullDownloadErrorKey('files.error.serverError');
        }
        evictCachedFile(message.fileId);
      }
    }
  }, [isSelecting, message, onOpenViewer, downloadProgress, decryptionKey, selection]);

  return (
    <div
      ref={rootRef}
      className={`message ${message.isOwn ? 'message--own' : 'message--peer'} ${
        isSelecting ? 'message--selectable' : ''
      }`.trim()}
      data-selected={isSelecting ? (isSelected ? 'true' : 'false') : undefined}
      role="listitem"
      data-message-id={message.id}
      {...(shouldInteract ? handlers : {})}
    >
      {isSelecting && (
        <span
          className="message__select-checkbox"
          aria-hidden
          data-checked={isSelected ? 'true' : 'false'}
        />
      )}
      <div className="image-bubble" onClick={handleTap}>
        {!message.isOwn && message.senderName && (
          <span className="message-sender-name">{message.senderName}</span>
        )}
        {replyTo && replySenderLabel && onReplyQuoteClick && (
          <ReplyQuote
            reply={replyTo}
            senderLabel={replySenderLabel}
            onJumpToMessage={onReplyQuoteClick}
          />
        )}

        <div className="image-bubble__thumbnail-wrap">
          {thumbnailState === 'loading' && (
            <div className="image-bubble__placeholder">
              <span className="image-bubble__placeholder-icon">🖼️</span>
            </div>
          )}

          {thumbnailState === 'error' && (
            <div className="image-bubble__placeholder image-bubble__placeholder--error">
              <span className="image-bubble__placeholder-icon">🖼️</span>
              {thumbnailErrorKey && (
                <span className="image-bubble__error-hint">{t(thumbnailErrorKey)}</span>
              )}
              <button
                className="image-bubble__retry-btn"
                onClick={(e) => { e.stopPropagation(); handleRetryThumbnail(); }}
              >
                {t('files.bubble.retry')}
              </button>
            </div>
          )}

          {thumbnailState === 'loaded' && thumbnailSrc && (
            <img
              className="image-bubble__thumbnail"
              src={thumbnailSrc}
              alt={message.fileMeta?.fileName || t('files.bubble.photo')}
              onError={handleThumbnailError}
              onLoad={handleThumbnailLoad}
              draggable={false}
            />
          )}

          {downloadProgress !== null && (
            <div className="image-bubble__download-overlay">
              <div
                className="image-bubble__download-progress"
                style={{ width: `${downloadProgress}%` }}
              />
              <span className="image-bubble__download-text">{downloadProgress}%</span>
            </div>
          )}

          {fullDownloadErrorKey && (
            <div className="image-bubble__error-overlay">
              <span className="image-bubble__error-hint">{t(fullDownloadErrorKey)}</span>
              <button
                type="button"
                className="image-bubble__retry-btn"
                onClick={handleRetryFullImage}
              >
                {t('files.bubble.retry')}
              </button>
            </div>
          )}
        </div>

        {hasCaption && (
          <p className="image-bubble__caption">{message.content}</p>
        )}

        <div className="image-bubble__meta">
          <span className="image-bubble__size">{formattedSize}</span>
          <span className="image-bubble__time">{formattedTime}</span>
          {message.isOwn && (
            <span className="message-status" aria-label={getStatusLabel(message.status)}>
              <StatusIcon status={message.status} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

function StatusIcon({ status }: { status: MessageStatus }) {
  switch (status) {
    case 'sending':
      return <span className="status-icon status-icon--sending">⏳</span>;
    case 'sent':
      return <span className="status-icon status-icon--sent">✓</span>;
    case 'delivered':
      return <span className="status-icon status-icon--delivered">✓✓</span>;
    case 'read':
      return <span className="status-icon status-icon--read">✓✓</span>;
    case 'failed':
      return <span className="status-icon status-icon--failed">!</span>;
    default:
      return null;
  }
}

function getStatusLabel(status: MessageStatus): string {
  const labels: Record<MessageStatus, string> = {
    sending: 'Sending',
    sent: 'Sent',
    delivered: 'Delivered',
    read: 'Read',
    failed: 'Failed to send',
  };
  return labels[status];
}
