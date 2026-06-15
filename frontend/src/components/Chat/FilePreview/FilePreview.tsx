import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileMessageType } from '../MessageInput';
import { FileTypeIcon } from '../FileTypeIcon';
import { getFileTypeDisplay } from '../fileTypeDisplay';
import { formatLocalizedFileSize } from '@/utils/formatLocalizedFileSize';
import './FilePreview.css';

interface FilePreviewProps {
  file: File;
  messageType: FileMessageType;
  onSend: (file: File, caption?: string) => void;
  onCancel: () => void;
}

/**
 * Pre-send file preview overlay (P4-4-1-2).
 *
 * Shows image preview, video poster frame, or document info
 * before the user confirms sending.
 */
export const FilePreview = memo(function FilePreview({
  file,
  messageType,
  onSend,
  onCancel,
}: FilePreviewProps) {
  const { t } = useTranslation();
  const [caption, setCaption] = useState('');
  /** Video preview only (blob URLs). Images use a data URL so strict CSP can allow `data:` without `blob:`. */
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (messageType === 'image') {
      let cancelled = false;
      const reader = new FileReader();
      reader.onload = () => {
        if (!cancelled) setImageDataUrl(reader.result as string);
      };
      reader.onerror = () => {
        if (!cancelled) setImageDataUrl(null);
      };
      reader.readAsDataURL(file);
      return () => {
        cancelled = true;
      };
    }
    setImageDataUrl(null);
    return undefined;
  }, [file, messageType]);

  useEffect(() => {
    if (messageType !== 'video') {
      setVideoObjectUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setVideoObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, messageType]);

  useEffect(() => {
    if (messageType !== 'video' || !videoObjectUrl) return;

    const video = videoRef.current;
    if (!video) return;

    const handleMetadata = () => {
      if (Number.isFinite(video.duration)) {
        setVideoDuration(formatDuration(video.duration));
      }
    };
    video.addEventListener('loadedmetadata', handleMetadata);
    return () => video.removeEventListener('loadedmetadata', handleMetadata);
  }, [messageType, videoObjectUrl]);

  const handleSend = useCallback(() => {
    onSend(file, caption.trim() || undefined);
  }, [file, caption, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  return (
    <div
      className="file-preview-overlay"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={t('files.preview.title')}
    >
      <div className="file-preview-card" onClick={(e) => e.stopPropagation()}>
        {/* Preview area */}
        <div className="file-preview-content">
          {messageType === 'image' && imageDataUrl && (
            <img
              className="file-preview-image"
              src={imageDataUrl}
              alt={file.name}
            />
          )}

          {messageType === 'video' && videoObjectUrl && (
            <div className="file-preview-video-wrapper">
              <video
                ref={videoRef}
                className="file-preview-video"
                src={videoObjectUrl}
                preload="metadata"
                playsInline
                muted
              />
              {videoDuration && (
                <span className="file-preview-video-duration">{videoDuration}</span>
              )}
            </div>
          )}

          {messageType === 'file' && (
            <div className="file-preview-doc">
              <span className="file-preview-doc-icon" aria-hidden="true">
                <FileTypeIcon variant={getFileTypeDisplay(file.type).variant} size={48} />
              </span>
              <span className="file-preview-doc-name" title={file.name}>{file.name}</span>
            </div>
          )}
        </div>

        {/* File info */}
        <div className="file-preview-info">
          <span className="file-preview-filename" title={file.name}>{file.name}</span>
          <span className="file-preview-size">{formatLocalizedFileSize(file.size, t)}</span>
        </div>

        {/* Caption input */}
        <input
          className="file-preview-caption"
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={t('files.preview.captionPlaceholder')}
          maxLength={200}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSend();
            }
          }}
        />

        {/* Actions */}
        <div className="file-preview-actions">
          <button
            type="button"
            className="file-preview-btn file-preview-btn--cancel"
            onClick={onCancel}
          >
            {t('files.preview.cancel')}
          </button>
          <button
            type="button"
            className="file-preview-btn file-preview-btn--send"
            onClick={handleSend}
          >
            {t('files.preview.send')}
          </button>
        </div>
      </div>
    </div>
  );
});

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
