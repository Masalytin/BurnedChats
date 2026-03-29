import { memo, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DecryptedFileMessage } from '@/types';
import { downloadFile } from '@/services/fileDownloadService';
import { getAESKey } from '@/crypto/keyStore';
import { getFileIcon, formatFileSize } from '@/utils/fileIcons';
import './DocumentMessageBubble.css';

type MessageStatus = DecryptedFileMessage['status'];
type DocState = 'idle' | 'downloading' | 'downloaded' | 'error';

interface DocumentMessageBubbleProps {
  message: DecryptedFileMessage;
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
 * Document message bubble: displays a compact card with file icon,
 * name, size and a download button. Supports download → save/open flow.
 */
export const DocumentMessageBubble = memo(function DocumentMessageBubble({
  message,
}: DocumentMessageBubbleProps) {
  const { t } = useTranslation();

  const [docState, setDocState] = useState<DocState>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const downloadUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fileName = message.fileMeta?.fileName || t('chat.docUnknownFile', 'File');
  const mimeType = message.fileMeta?.mimeType || 'application/octet-stream';
  const iconInfo = getFileIcon(mimeType);
  const formattedSize = formatFileSize(message.fileSize);
  const formattedTime = formatTime(message.timestamp);
  const hasCaption = message.content && !message.content.startsWith('📎');

  const handleDownload = useCallback(async () => {
    if (docState === 'downloading') return;

    if (docState === 'downloaded' && downloadUrlRef.current) {
      triggerSave(downloadUrlRef.current, fileName);
      return;
    }

    setDocState('downloading');
    setDownloadProgress(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const key = getAESKey(message.sessionId);
      if (!key) {
        setDocState('error');
        return;
      }

      const result = await downloadFile(message.fileId, key, {
        onProgress: (percent) => setDownloadProgress(percent),
        signal: controller.signal,
      });

      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
      }
      downloadUrlRef.current = result.objectUrl;
      setDocState('downloaded');
    } catch {
      if (!controller.signal.aborted) {
        setDocState('error');
      }
    } finally {
      abortRef.current = null;
    }
  }, [docState, message.fileId, message.sessionId, fileName]);

  const handleRetry = useCallback(() => {
    setDocState('idle');
  }, []);

  const handleSave = useCallback(() => {
    if (downloadUrlRef.current) {
      triggerSave(downloadUrlRef.current, fileName);
    }
  }, [fileName]);

  return (
    <div
      className={`message ${message.isOwn ? 'message--own' : 'message--peer'}`}
      role="listitem"
    >
      <div className="doc-bubble">
        {!message.isOwn && message.senderName && (
          <span className="message-sender-name">{message.senderName}</span>
        )}

        <div className="doc-bubble__body" onClick={handleDownload}>
          <div className="doc-bubble__icon" style={{ color: iconInfo.color }}>
            <span className="doc-bubble__icon-emoji">{iconInfo.icon}</span>
            <span className="doc-bubble__icon-label">{iconInfo.label}</span>
          </div>

          <div className="doc-bubble__info">
            <span className="doc-bubble__filename" title={fileName}>
              {fileName}
            </span>
            <span className="doc-bubble__size">{formattedSize}</span>
          </div>

          <div className="doc-bubble__action">
            {docState === 'idle' && (
              <button
                className="doc-bubble__download-btn"
                aria-label={t('chat.docDownload', 'Download')}
                onClick={(e) => { e.stopPropagation(); handleDownload(); }}
              >
                <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                  <path d="M12 4v12m0 0l-4-4m4 4l4-4M6 20h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}

            {docState === 'downloading' && (
              <div className="doc-bubble__progress-ring">
                <svg viewBox="0 0 28 28" width="28" height="28">
                  <circle cx="14" cy="14" r="12" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
                  <circle
                    cx="14" cy="14" r="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 12}
                    strokeDashoffset={2 * Math.PI * 12 * (1 - downloadProgress / 100)}
                    transform="rotate(-90 14 14)"
                  />
                </svg>
                <span className="doc-bubble__progress-text">{downloadProgress}%</span>
              </div>
            )}

            {docState === 'downloaded' && (
              <button
                className="doc-bubble__save-btn"
                aria-label={t('chat.docSave', 'Save')}
                onClick={(e) => { e.stopPropagation(); handleSave(); }}
              >
                <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}

            {docState === 'error' && (
              <button
                className="doc-bubble__retry-btn"
                aria-label={t('chat.docRetry', 'Retry')}
                onClick={(e) => { e.stopPropagation(); handleRetry(); }}
              >
                <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                  <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20.49 9A9 9 0 005.64 5.64L4 4m16 16l-1.64-1.64A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {hasCaption && (
          <p className="doc-bubble__caption">{message.content}</p>
        )}

        <div className="doc-bubble__meta">
          <span className="doc-bubble__time">{formattedTime}</span>
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

function triggerSave(objectUrl: string, fileName: string) {
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

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
