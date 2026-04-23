import { memo, useState, useCallback, useRef, useMemo, type MouseEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DecryptedFileMessage, ReplyToInfo } from '@/types';
import { useHaptics } from '@/hooks/useHaptics';
import { useLongPress } from '@/hooks/useLongPress';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useMediaBubblePrimaryAndMenu } from '@/hooks/useMediaBubblePrimaryAndMenu';
import type { UseMessageSelectionReturn } from '@/hooks/useMessageSelection';
import { mergeMessagePointerHandlers } from '@/utils/messagePointerMerge';
import { messageStatusAriaLabel } from '@/utils/messageStatusAria';
import { ReplyQuote } from '../ReplyQuote';
import { MessageReplyAction } from '../MessageReplyAction';
import '../Message/Message.css';
import { saveDecryptedFile, evictCachedFile } from '@/services/fileDownloadService';
import { enqueueDownload } from '@/services/transferQueue';
import { FileTransferError, fileTransferErrorI18nKey } from '@/services/fileTransferErrors';
import { resolveDecryptionKey } from '@/crypto/keyStore';
import { useDecryptionKey } from '@/hooks/useDecryptionKey';
import { getFileIcon } from '@/utils/fileIcons';
import { formatLocalizedFileSize } from '@/utils/formatLocalizedFileSize';
import './DocumentMessageBubble.css';

type MessageStatus = DecryptedFileMessage['status'];
type DocState = 'idle' | 'downloading' | 'downloaded' | 'error';

interface DocumentMessageBubbleProps {
  message: DecryptedFileMessage;
  selection?: UseMessageSelectionReturn;
  onOpenActionMenu?: (messageId: string, anchor: DOMRect) => void;
  replyTo?: ReplyToInfo;
  replySenderLabel?: string;
  onReplyQuoteClick?: (messageId: string) => void;
  onSwipeReply?: () => void;
  rovingTabIndex?: 0 | -1;
  onRovingActivate?: () => void;
  a11yLabelId?: string;
  onRangeExtendKey?: (messageId: string, direction: 'up' | 'down') => void;
  onReplyIconClick?: () => void;
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
  selection,
  onOpenActionMenu,
  replyTo,
  replySenderLabel,
  onReplyQuoteClick,
  onSwipeReply,
  rovingTabIndex = -1,
  onRovingActivate,
  a11yLabelId,
  onRangeExtendKey,
  onReplyIconClick,
}: DocumentMessageBubbleProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const haptics = useHaptics();
  const menuEnabled = Boolean(onOpenActionMenu);
  const isSelecting = selection?.mode === 'selecting';
  const isSelected = selection ? selection.isSelected(message.id) : false;
  const shouldInteract = menuEnabled || isSelecting;

  const handleOpenMenu = useCallback(() => {
    if (!onOpenActionMenu || !rootRef.current) return;
    haptics.selectionChanged();
    onOpenActionMenu(message.id, rootRef.current.getBoundingClientRect());
  }, [haptics, message.id, onOpenActionMenu]);

  const { handlers: longPress } = useLongPress({
    enabled: menuEnabled && !isSelecting,
    onLongPress: handleOpenMenu,
    onShortClick: (e) => {
      if (isSelecting) {
        e.preventDefault();
        onRovingActivate?.();
        selection?.toggle(message.id);
      }
    },
  });
  const swipe = useSwipeGesture({
    onSwipeRight: () => {
      haptics.selectionChanged();
      onSwipeReply?.();
    },
    enabled: menuEnabled && !isSelecting && Boolean(onSwipeReply),
  });
  const handlers = mergeMessagePointerHandlers(longPress, onSwipeReply ? swipe : null);

  const decryptionKey = useDecryptionKey(message.sessionId);

  const [docState, setDocState] = useState<DocState>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [errorHintKey, setErrorHintKey] = useState<string | null>(null);
  const downloadedBlobRef = useRef<Blob | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fileName = message.fileMeta?.fileName || t('files.bubble.document');
  const mimeType = message.fileMeta?.mimeType || 'application/octet-stream';
  const iconInfo = getFileIcon(mimeType);
  const formattedSize = formatLocalizedFileSize(message.fileSize, t);
  const formattedTime = formatTime(message.timestamp);
  const hasCaption = message.content && !message.content.startsWith('📎');

  const handleDownload = useCallback(async () => {
    if (isSelecting) {
      onRovingActivate?.();
      selection?.toggle(message.id);
      return;
    }
    if (docState === 'downloading') return;

    if (docState === 'downloaded' && downloadedBlobRef.current) {
      void saveDecryptedFile(downloadedBlobRef.current, fileName);
      return;
    }

    setDocState('downloading');
    setDownloadProgress(0);
    setErrorHintKey(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (!decryptionKey) {
        resolveDecryptionKey(message.sessionId);
        setErrorHintKey('files.error.decryptFailed');
        setDocState('error');
        return;
      }

      const result = await enqueueDownload(message.fileId, decryptionKey, {
        onProgress: (percent) => setDownloadProgress(percent),
        signal: controller.signal,
        mimeType,
      }).result;

      downloadedBlobRef.current = result.blob;
      setDocState('downloaded');
    } catch (err) {
      if (!controller.signal.aborted) {
        if (err instanceof FileTransferError) {
          setErrorHintKey(fileTransferErrorI18nKey(err));
        } else {
          setErrorHintKey('files.error.serverError');
        }
        evictCachedFile(message.fileId);
        setDocState('error');
      }
    } finally {
      abortRef.current = null;
    }
  }, [isSelecting, selection, onRovingActivate, docState, message.fileId, message.sessionId, fileName, mimeType, decryptionKey, message.id]);

  const mediaTapMenu = useMediaBubblePrimaryAndMenu({
    menuEnabled,
    isSelecting,
    onOpenMenu: handleOpenMenu,
    runPrimary: () => {
      void handleDownload();
    },
  });

  const handleRetry = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setDocState('idle');
      setErrorHintKey(null);
      downloadedBlobRef.current = null;
      window.setTimeout(() => {
        void handleDownload();
      }, 0);
    },
    [handleDownload],
  );

  const handleSave = useCallback(() => {
    if (downloadedBlobRef.current) {
      void saveDecryptedFile(downloadedBlobRef.current, fileName);
    }
  }, [fileName]);

  const labelId = a11yLabelId ?? `message-a11y-${message.id}`;
  const rowA11yLabel = useMemo(() => {
    const preview =
      (hasCaption && String(message.content).trim()) ||
      fileName ||
      t('files.bubble.document');
    return message.isOwn
      ? t('chat.aria.ownMessagePreview', { preview })
      : t('chat.aria.peerMessagePreview', {
          name: message.senderName?.trim() || t('chat.reply.unknownSender'),
          preview,
        });
  }, [hasCaption, message.content, message.isOwn, message.senderName, fileName, t]);

  const onRowMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isSelecting || (menuEnabled && !isSelecting)) {
        (e.currentTarget as HTMLElement).focus();
        onRovingActivate?.();
      }
    },
    [isSelecting, menuEnabled, onRovingActivate],
  );

  const onRowKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (isSelecting) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onRovingActivate?.();
          selection?.toggle(message.id);
          return;
        }
        if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          onRangeExtendKey?.(message.id, e.key === 'ArrowUp' ? 'up' : 'down');
          return;
        }
      }
      if (menuEnabled && !isSelecting) {
        if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault();
          handleOpenMenu();
        }
      }
    },
    [isSelecting, menuEnabled, message.id, onRangeExtendKey, selection, handleOpenMenu],
  );

  const rowRole = isSelecting ? 'option' : 'listitem';
  const tabIndex = isSelecting ? rovingTabIndex : menuEnabled && !isSelecting ? -1 : -1;

  return (
    <div
      ref={rootRef}
      className={`message ${message.isOwn ? 'message--own' : 'message--peer'} ${
        isSelecting ? 'message--selectable' : ''
      } ${menuEnabled && !isSelecting ? 'message--menu-gestures' : ''}`.trim()}
      data-selected={isSelecting ? (isSelected ? 'true' : 'false') : undefined}
      data-message-id={message.id}
      role={rowRole}
      aria-selected={isSelecting ? isSelected : undefined}
      aria-labelledby={labelId}
      tabIndex={tabIndex}
      onMouseDown={onRowMouseDown}
      onKeyDown={onRowKeyDown}
      {...(shouldInteract ? handlers : {})}
      onClickCapture={
        shouldInteract
          ? (e) => {
              handlers.onClickCapture(e);
              mediaTapMenu.onRootClickCapture(e);
            }
          : undefined
      }
      onPointerUp={
        shouldInteract
          ? (e) => {
              handlers.onPointerUp(e);
              mediaTapMenu.onRootPointerUp(e);
            }
          : undefined
      }
    >
      <span id={labelId} className="visually-hidden">
        {rowA11yLabel}
      </span>
      {isSelecting && (
        <span
          className="message__select-checkbox"
          aria-hidden
          data-checked={isSelected ? 'true' : 'false'}
        />
      )}
      <MessageReplyAction
        visible={Boolean(onReplyIconClick) && !isSelecting}
        onReply={() => {
          haptics.selectionChanged();
          onReplyIconClick?.();
        }}
        ariaLabel={t('chat.actions.reply')}
        title={t('chat.actions.reply')}
      />
      <div className="doc-bubble">
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

        <div
          className="doc-bubble__body"
          onClick={mediaTapMenu.onInnerClick}
          onDoubleClick={mediaTapMenu.onInnerDoubleClick}
        >
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
                aria-label={t('files.download.fetch')}
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
                aria-label={t('files.download.save')}
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
                aria-label={t('files.bubble.retry')}
                onClick={handleRetry}
              >
                <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                  <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20.49 9A9 9 0 005.64 5.64L4 4m16 16l-1.64-1.64A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {docState === 'error' && errorHintKey && (
          <p className="doc-bubble__error-text">{t(errorHintKey)}</p>
        )}

        {hasCaption && (
          <p className="doc-bubble__caption">{message.content}</p>
        )}

        <div className="doc-bubble__meta">
          <span className="doc-bubble__time">{formattedTime}</span>
          {message.editedAt != null && (
            <span className="doc-bubble__edited">{t('chat.edit.editedLabel')}</span>
          )}
          {message.isOwn && (
            <span className="message-status" aria-label={messageStatusAriaLabel(t, message.status)}>
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

