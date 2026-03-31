import { memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DecryptedFileMessage } from '@/types';
import { downloadFile, downloadThumbnail } from '@/services/fileDownloadService';
import { getAESKey } from '@/crypto/keyStore';
import './ImageMessageBubble.css';

type MessageStatus = DecryptedFileMessage['status'];

interface ImageMessageBubbleProps {
  message: DecryptedFileMessage;
  onOpenViewer?: (message: DecryptedFileMessage) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  const hasCaption = message.content && !message.content.startsWith('📷');
  const formattedTime = formatTime(message.timestamp);
  const formattedSize = formatFileSize(message.fileSize);

  const handleThumbnailError = useCallback(() => {
    setThumbnailState('error');
  }, []);

  const handleThumbnailLoad = useCallback(() => {
    setThumbnailState('loaded');
  }, []);

  const handleRetryThumbnail = useCallback(async () => {
    if (!message.thumbnailFileId) return;
    setThumbnailState('loading');
    try {
      const key = getAESKey(message.sessionId);
      if (!key) {
        setThumbnailState('error');
        return;
      }
      const url = await downloadThumbnail(message.thumbnailFileId, key);
      setThumbnailSrc(url);
      setThumbnailState('loaded');
    } catch {
      setThumbnailState('error');
    }
  }, [message.thumbnailFileId, message.sessionId]);

  const handleTap = useCallback(async () => {
    if (downloadProgress !== null) return;

    if (onOpenViewer) {
      setDownloadProgress(0);
      try {
        const key = getAESKey(message.sessionId);
        if (!key) {
          setDownloadProgress(null);
          return;
        }
        await downloadFile(message.fileId, key, {
          onProgress: (percent) => setDownloadProgress(percent),
          mimeType: message.fileMeta?.mimeType,
        });
        setDownloadProgress(null);
        onOpenViewer(message);
      } catch {
        setDownloadProgress(null);
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
              <button
                className="image-bubble__retry-btn"
                onClick={(e) => { e.stopPropagation(); handleRetryThumbnail(); }}
              >
                {t('chat.imageRetry', 'Retry')}
              </button>
            </div>
          )}

          {thumbnailState === 'loaded' && thumbnailSrc && (
            <img
              className="image-bubble__thumbnail"
              src={thumbnailSrc}
              alt={message.fileMeta?.fileName || 'Image'}
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
