import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DecryptedFileMessage } from '@/types';
import { saveDecryptedFile, evictCachedFile, type DecryptedFile, type SaveDecryptedFileResult } from '@/services/fileDownloadService';
import { enqueueDownload } from '@/services/transferQueue';
import { FileTransferError, fileTransferErrorI18nKey } from '@/services/fileTransferErrors';
import { resolveDecryptionKey } from '@/crypto/keyStore';
import { useBackButton } from '@/hooks/useBackButton';
import { useDecryptionKey } from '@/hooks/useDecryptionKey';
import { useTelegram } from '@/hooks/useTelegram';
import { useToast } from '@/components/Toast/ToastContext';
import './MediaViewer.css';

interface MediaViewerProps {
  message: DecryptedFileMessage;
  onClose: () => void;
}

type ViewerState = 'loading' | 'ready' | 'error';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_DELAY = 300;
const SWIPE_DISMISS_THRESHOLD = 120;

/**
 * Full-screen media viewer for images (pinch-to-zoom, pan, double-tap)
 * and videos (native controls). Renders via portal to document.body.
 */
export const MediaViewer = memo(function MediaViewer({
  message,
  onClose,
}: MediaViewerProps) {
  const { t } = useTranslation();
  const { showAlert, platform, isInTelegram } = useTelegram();
  const toast = useToast();
  const decryptionKey = useDecryptionKey(message.sessionId, message.keyEpoch);

  const [state, setState] = useState<ViewerState>('loading');
  const [file, setFile] = useState<DecryptedFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  // Image zoom/pan state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [swipeY, setSwipeY] = useState(0);

  const lastTapRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const pinchStartDistRef = useRef(0);
  const pinchStartScaleRef = useRef(1);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const isImage = message.type === 'image';
  const isVideo = message.type === 'video';

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  }, [onClose]);

  useBackButton({ visible: true, onBack: handleClose });

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (!decryptionKey) {
      resolveDecryptionKey(message.sessionId);
      setLoadErrorKey('files.error.decryptFailed');
      setState('error');
      return;
    }

    const abort = new AbortController();
    setState('loading');
    setLoadErrorKey(null);
    setProgress(0);

    const load = async () => {
      try {
        const result = await enqueueDownload(message.fileId, decryptionKey, {
          signal: abort.signal,
          onProgress: (p) => setProgress(p),
          mimeType: message.fileMeta?.mimeType,
        }).result;
        if (abort.signal.aborted) return;
        setFile(result);
        setState('ready');
      } catch (err) {
        if (abort.signal.aborted) return;
        evictCachedFile(message.fileId);
        if (err instanceof FileTransferError) {
          setLoadErrorKey(fileTransferErrorI18nKey(err));
        } else {
          setLoadErrorKey('files.error.serverError');
        }
        setState('error');
      }
    };
    void load();
    return () => abort.abort();
  }, [message.fileId, message.sessionId, message.fileMeta?.mimeType, decryptionKey]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) handleClose();
  }, [handleClose]);

  const showSaveFeedback = useCallback(
    (result: SaveDecryptedFileResult) => {
      if (result === 'cancelled') {
        showAlert(t('files.save.cancelled'));
      } else if (result === 'unavailable') {
        showAlert(t('files.save.unavailable'));
      }
    },
    [showAlert, t],
  );

  // --- Save / download ---
  const handleSave = useCallback(async () => {
    if (!file) return;
    const name = message.fileMeta?.fileName || 'file';
    if (isInTelegram && (platform === 'android' || platform === 'ios')) {
      toast.info(t('files.save.shareHint'));
    }
    const result = await saveDecryptedFile(file.blob, name);
    showSaveFeedback(result);
  }, [file, message.fileMeta, isInTelegram, platform, showSaveFeedback, t, toast]);

  // --- Double tap to zoom ---
  const handleDoubleTap = useCallback((clientX: number, clientY: number) => {
    if (!isImage) return;
    if (scale > 1) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    } else {
      setScale(2.5);
      const rect = overlayRef.current?.getBoundingClientRect();
      if (rect) {
        const cx = clientX - rect.left - rect.width / 2;
        const cy = clientY - rect.top - rect.height / 2;
        setTranslate({ x: -cx * 1.5, y: -cy * 1.5 });
      }
    }
  }, [scale, isImage]);

  // --- Touch handlers (pinch, pan, swipe, double-tap) ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isImage) return;

    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartScaleRef.current = scale;
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const now = Date.now();

      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
        e.preventDefault();
        handleDoubleTap(touch.clientX, touch.clientY);
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = now;

      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: now };
      if (scale > 1) {
        panStartRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          tx: translate.x,
          ty: translate.y,
        };
      }
    }
  }, [isImage, scale, translate, handleDoubleTap]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isImage) return;

    // Pinch zoom
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / (pinchStartDistRef.current || 1);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStartScaleRef.current * ratio));
      setScale(newScale);
      if (newScale <= 1) setTranslate({ x: 0, y: 0 });
      return;
    }

    // Pan when zoomed
    if (e.touches.length === 1 && panStartRef.current && scale > 1) {
      e.preventDefault();
      const touch = e.touches[0];
      setTranslate({
        x: panStartRef.current.tx + (touch.clientX - panStartRef.current.x),
        y: panStartRef.current.ty + (touch.clientY - panStartRef.current.y),
      });
      return;
    }

    // Swipe down to close (only when not zoomed)
    if (e.touches.length === 1 && scale <= 1 && touchStartRef.current) {
      const dy = e.touches[0].clientY - touchStartRef.current.y;
      if (dy > 0) {
        setSwipeY(dy);
      }
    }
  }, [isImage, scale]);

  const handleTouchEnd = useCallback(() => {
    if (!isImage) return;

    panStartRef.current = null;

    if (swipeY > SWIPE_DISMISS_THRESHOLD) {
      handleClose();
    }
    setSwipeY(0);
  }, [isImage, swipeY, handleClose]);

  // Dismiss opacity based on swipe progress
  const swipeOpacity = swipeY > 0 ? Math.max(0.2, 1 - swipeY / (SWIPE_DISMISS_THRESHOLD * 2)) : 1;

  const overlayClassName = [
    'media-viewer',
    isClosing && 'media-viewer--closing',
  ].filter(Boolean).join(' ');

  const content = (
    <div
      ref={overlayRef}
      className={overlayClassName}
      onClick={handleOverlayClick}
      style={{ opacity: swipeOpacity }}
    >
      {/* Top bar */}
      <div className="media-viewer__topbar">
        <button
          className="media-viewer__btn media-viewer__btn--close"
          onClick={handleClose}
          aria-label={t('files.viewer.close')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {state === 'ready' && (
          <button
            className="media-viewer__btn media-viewer__btn--save"
            onClick={handleSave}
            aria-label={t('files.viewer.saveToDevice')}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="media-viewer__content">
        {state === 'loading' && (
          <div className="media-viewer__loading">
            <div className="media-viewer__spinner" />
            <span className="media-viewer__progress">{progress}%</span>
          </div>
        )}

        {state === 'error' && (
          <div className="media-viewer__error">
            <span className="media-viewer__error-icon" aria-hidden="true">
              <AlertTriangle size={32} strokeWidth={1.5} />
            </span>
            <span>{loadErrorKey ? t(loadErrorKey) : t('files.download.failed')}</span>
          </div>
        )}

        {state === 'ready' && file && isImage && (
          <div
            className="media-viewer__image-container"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <img
              className="media-viewer__image"
              src={file.objectUrl}
              alt={message.fileMeta?.fileName || t('files.bubble.photo')}
              draggable={false}
              style={{
                transform: `translate(${translate.x}px, ${translate.y + swipeY}px) scale(${scale})`,
              }}
            />
          </div>
        )}

        {state === 'ready' && file && isVideo && (
          <video
            className="media-viewer__video"
            src={file.objectUrl}
            controls
            autoPlay
            playsInline
          />
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
});
