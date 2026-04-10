import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { DecryptedFileMessage } from '@/types';
import { downloadFile, downloadThumbnail, evictCachedFile } from '@/services/fileDownloadService';
import { FileTransferError, fileTransferErrorI18nKey } from '@/services/fileTransferErrors';
import { resolveDecryptionKey } from '@/crypto/keyStore';
import { formatLocalizedFileSize } from '@/utils/formatLocalizedFileSize';
import './VideoMessageBubble.css';

type MessageStatus = DecryptedFileMessage['status'];

type VideoState = 'idle' | 'downloading' | 'playing' | 'error';

interface VideoMessageBubbleProps {
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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Video message bubble: displays a poster frame with play button.
 * Tapping downloads the encrypted video, decrypts it, and plays inline.
 */
export const VideoMessageBubble = memo(function VideoMessageBubble({
  message,
  onOpenViewer,
}: VideoMessageBubbleProps) {
  const { t } = useTranslation();

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrlRef = useRef<string | null>(null);

  const [thumbnailState, setThumbnailState] = useState<'loading' | 'loaded' | 'error'>(
    message.thumbnailUrl ? 'loaded' : message.thumbnailFileId ? 'loading' : 'error',
  );
  const [thumbnailSrc, setThumbnailSrc] = useState<string | undefined>(message.thumbnailUrl);
  const [thumbnailErrorKey, setThumbnailErrorKey] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoState>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [videoErrorKey, setVideoErrorKey] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
    };
  }, []);

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
      const key = resolveDecryptionKey(message.sessionId);
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

  const handlePlay = useCallback(async () => {
    if (videoState === 'downloading' || videoState === 'playing') return;

    if (onOpenViewer) {
      setVideoState('downloading');
      setDownloadProgress(0);
      setVideoErrorKey(null);
      try {
        const key = resolveDecryptionKey(message.sessionId);
        if (!key) {
          setVideoErrorKey('files.error.decryptFailed');
          setVideoState('error');
          return;
        }
        await downloadFile(message.fileId, key, {
          onProgress: (percent) => setDownloadProgress(percent),
        });
        setVideoState('idle');
        setDownloadProgress(0);
        onOpenViewer(message);
      } catch (err) {
        if (err instanceof FileTransferError) {
          setVideoErrorKey(fileTransferErrorI18nKey(err));
        } else {
          setVideoErrorKey('files.error.serverError');
        }
        evictCachedFile(message.fileId);
        setVideoState('error');
      }
      return;
    }

    setVideoState('downloading');
    setDownloadProgress(0);
    setVideoErrorKey(null);

    try {
      const key = resolveDecryptionKey(message.sessionId);
      if (!key) {
        setVideoErrorKey('files.error.decryptFailed');
        setVideoState('error');
        return;
      }

      const result = await downloadFile(message.fileId, key, {
        onProgress: (percent) => setDownloadProgress(percent),
      });

      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
      }
      videoUrlRef.current = result.objectUrl;
      setVideoState('playing');
    } catch (err) {
      if (err instanceof FileTransferError) {
        setVideoErrorKey(fileTransferErrorI18nKey(err));
      } else {
        setVideoErrorKey('files.error.serverError');
      }
      evictCachedFile(message.fileId);
      setVideoState('error');
    }
  }, [message, onOpenViewer, videoState]);

  const handleVideoLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video && isFinite(video.duration)) {
      setDuration(video.duration);
    }
  }, []);

  const handleVideoEnded = useCallback(() => {
    setVideoState('idle');
  }, []);

  const handleRetry = useCallback(() => {
    setVideoState('idle');
    setVideoErrorKey(null);
    evictCachedFile(message.fileId);
    window.setTimeout(() => {
      void handlePlay();
    }, 0);
  }, [handlePlay, message.fileId]);

  const hasCaption = message.content && !message.content.startsWith('🎬');
  const formattedTime = formatTime(message.timestamp);
  const formattedSize = formatLocalizedFileSize(message.fileSize, t);

  return (
    <div
      className={`message ${message.isOwn ? 'message--own' : 'message--peer'}`}
      role="listitem"
    >
      <div className="video-bubble">
        {!message.isOwn && message.senderName && (
          <span className="message-sender-name">{message.senderName}</span>
        )}

        <div className="video-bubble__content-wrap">
          {videoState === 'playing' && videoUrlRef.current ? (
            <video
              ref={videoRef}
              className="video-bubble__player"
              src={videoUrlRef.current}
              controls
              autoPlay
              playsInline
              onLoadedMetadata={handleVideoLoadedMetadata}
              onEnded={handleVideoEnded}
            />
          ) : (
            <div className="video-bubble__poster-wrap" onClick={handlePlay}>
              {thumbnailState === 'loading' && (
                <div className="video-bubble__placeholder">
                  <span className="video-bubble__placeholder-icon">🎬</span>
                </div>
              )}

              {thumbnailState === 'error' && (
                <div className="video-bubble__placeholder video-bubble__placeholder--error">
                  <span className="video-bubble__placeholder-icon">🎬</span>
                  {thumbnailErrorKey && (
                    <span className="video-bubble__error-hint">{t(thumbnailErrorKey)}</span>
                  )}
                  <button
                    className="video-bubble__retry-btn"
                    onClick={(e) => { e.stopPropagation(); handleRetryThumbnail(); }}
                  >
                    {t('files.bubble.retry')}
                  </button>
                </div>
              )}

              {thumbnailState === 'loaded' && thumbnailSrc && (
                <img
                  className="video-bubble__poster"
                  src={thumbnailSrc}
                  alt={message.fileMeta?.fileName || t('files.bubble.video')}
                  onError={handleThumbnailError}
                  onLoad={handleThumbnailLoad}
                  draggable={false}
                />
              )}

              {videoState === 'idle' && (
                <button className="video-bubble__play-btn" aria-label={t('files.download.open')}>
                  <svg className="video-bubble__play-icon" viewBox="0 0 48 48" fill="none">
                    <circle cx="24" cy="24" r="23" fill="rgba(0,0,0,0.5)" stroke="white" strokeWidth="2" />
                    <path d="M19 15L35 24L19 33V15Z" fill="white" />
                  </svg>
                </button>
              )}

              {videoState === 'downloading' && (
                <div className="video-bubble__download-overlay">
                  <div
                    className="video-bubble__download-progress"
                    style={{ width: `${downloadProgress}%` }}
                  />
                  <span className="video-bubble__download-text">{downloadProgress}%</span>
                </div>
              )}

              {videoState === 'error' && (
                <div className="video-bubble__error-overlay">
                  {videoErrorKey && (
                    <span className="video-bubble__error-hint">{t(videoErrorKey)}</span>
                  )}
                  <button type="button" className="video-bubble__retry-btn" onClick={handleRetry}>
                    {t('files.bubble.retry')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {hasCaption && (
          <p className="video-bubble__caption">{message.content}</p>
        )}

        <div className="video-bubble__meta">
          <span className="video-bubble__size">{formattedSize}</span>
          {duration !== null && (
            <span className="video-bubble__duration">{formatDuration(duration)}</span>
          )}
          <span className="video-bubble__time">{formattedTime}</span>
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
