import { memo, useState, useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DecryptedFileMessage } from '@/types';
import { downloadFile, downloadThumbnail, evictCachedFile } from '@/services/fileDownloadService';
import { FileTransferError, fileTransferErrorI18nKey } from '@/services/fileTransferErrors';
import { getAESKey } from '@/crypto/keyStore';
import { formatLocalizedFileSize } from '@/utils/formatLocalizedFileSize';
import './ImageMessageBubble.css';

type MessageStatus = DecryptedFileMessage['status'];

interface ImageMessageBubbleProps {
  message: DecryptedFileMessage;
  onOpenViewer?: (message: DecryptedFileMessage) => void;
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
}: ImageMessageBubbleProps) {
  const { t } = useTranslation();

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
      const key = getAESKey(message.sessionId);
      if (!key) {
        setThumbnailErrorKey('files.error.decryptFailed');
        setThumbnailState('error');
        return;
      }
      const url = await downloadThumbnail(message.thumbnailFileId, key);
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
  }, [message.thumbnailFileId, message.sessionId]);

  const handleRetryFullImage = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setFullDownloadErrorKey(null);
      evictCachedFile(message.fileId);
    },
    [message.fileId],
  );

  const handleTap = useCallback(async () => {
    if (downloadProgress !== null) return;

    if (onOpenViewer) {
      setDownloadProgress(0);
      setFullDownloadErrorKey(null);
      try {
        const key = getAESKey(message.sessionId);
        if (!key) {
          setDownloadProgress(null);
          setFullDownloadErrorKey('files.error.decryptFailed');
          return;
        }
        await downloadFile(message.fileId, key, {
          onProgress: (percent) => setDownloadProgress(percent),
          mimeType: message.fileMeta?.mimeType,
        });
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
  }, [message, onOpenViewer, downloadProgress]);

  return (
    <div
      className={`message ${message.isOwn ? 'message--own' : 'message--peer'}`}
      role="listitem"
    >
      <div className="image-bubble" onClick={handleTap}>
        {!message.isOwn && message.senderName && (
          <span className="message-sender-name">{message.senderName}</span>
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
