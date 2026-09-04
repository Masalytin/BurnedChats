import { memo, useRef, useCallback, useMemo, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageStatus, ReplyToInfo } from '@/types';
import { useHaptics } from '@/hooks/useHaptics';
import { useLongPress } from '@/hooks/useLongPress';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useMessageRowDoubleOpenMenu } from '@/hooks/useMessageRowDoubleOpenMenu';
import type { UseMessageSelectionReturn } from '@/hooks/useMessageSelection';
import { mergeMessagePointerHandlers } from '@/utils/messagePointerMerge';
import { messageStatusAriaLabel } from '@/utils/messageStatusAria';
import { formatChatDateSeparator } from '@/utils/formatChatDateSeparator';
import { ReplyQuote } from '../ReplyQuote';
import { MessageReplyAction } from '../MessageReplyAction';
import { MessageRemainingTime } from '../MessageRemainingTime';
import { MessageStatusIcon } from '../MessageStatusIcon';
import './Message.css';

interface MessageProps {
  /** Message id (for selection and action menu) */
  messageId: string;
  /** Message content text */
  content: string;
  /** Whether this message was sent by the current user */
  isOwn: boolean;
  /** Message timestamp */
  timestamp: number;
  /** Delivery status (only shown for own messages) */
  status?: MessageStatus;
  /** Whether to show the date separator */
  showDateSeparator?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Sender display name — shown above bubble for non-own room messages */
  senderName?: string;
  /** Whether to play the "new message" entrance animation */
  isNew?: boolean;
  /** Multi-select (IMP-MA-01) */
  selection?: UseMessageSelectionReturn;
  /** Opens the message action popover; long-press is enabled when set */
  onOpenActionMenu?: (messageId: string, anchor: DOMRect) => void;
  /** Quoted message above bubble (IMP-MA-03) */
  replyTo?: ReplyToInfo;
  /** Localized name line for the quote (you / peer / room member) */
  replySenderLabel?: string;
  onReplyQuoteClick?: (messageId: string) => void;
  /** Swipe right → quick reply (IMP-MA-03) */
  onSwipeReply?: () => void;
  /** Inline reply icon (IMP-MA-10); hidden in selection mode */
  onReplyIconClick?: () => void;
  /** When set, show a subtle “edited” label next to the time. */
  isEdited?: boolean;
  /** Selection mode: roving `tabIndex` (single active row) */
  rovingTabIndex?: 0 | -1;
  onRovingActivate?: () => void;
  /** Hidden label id for the action menu and assistive name */
  a11yLabelId?: string;
  onRangeExtendKey?: (messageId: string, direction: 'up' | 'down') => void;
  /** Send-time TTL anchor (server first). */
  ttlAnchorMs?: number;
  /** Chat-level disappearing TTL in seconds; 0 = off. */
  messageTtlSeconds?: number;
}

/**
 * Message bubble component (4.3.4)
 *
 * Displays a single chat message with:
 * - Different styling for own vs peer messages
 * - Timestamp
 * - Delivery status indicators (4.3.5)
 */
export const Message = memo(function Message({
  messageId,
  content,
  isOwn,
  timestamp,
  status = 'sent',
  showDateSeparator = false,
  className = '',
  senderName,
  isNew = false,
  selection,
  onOpenActionMenu,
  replyTo,
  replySenderLabel,
  onReplyQuoteClick,
  onSwipeReply,
  onReplyIconClick,
  isEdited = false,
  rovingTabIndex = -1,
  onRovingActivate,
  a11yLabelId,
  onRangeExtendKey,
  ttlAnchorMs,
  messageTtlSeconds = 0,
}: MessageProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const haptics = useHaptics();
  const menuEnabled = Boolean(onOpenActionMenu);
  const isSelecting = selection?.mode === 'selecting';
  const isSelected = selection ? selection.isSelected(messageId) : false;

  const a11yLabel = useMemo(() => {
    const preview = (content || '').trim().slice(0, 120) || t('chat.reply.fileShort');
    return isOwn
      ? t('chat.aria.ownMessagePreview', { preview })
      : t('chat.aria.peerMessagePreview', {
          name: senderName?.trim() || t('chat.reply.unknownSender'),
          preview,
        });
  }, [content, isOwn, senderName, t]);

  const labelId = a11yLabelId ?? `message-a11y-${messageId}`;

  const handleOpenMenu = useCallback(() => {
    if (!onOpenActionMenu || !rootRef.current) return;
    haptics.selectionChanged();
    onOpenActionMenu(messageId, rootRef.current.getBoundingClientRect());
  }, [haptics, messageId, onOpenActionMenu]);

  const rowDoubleOpen = useMessageRowDoubleOpenMenu({
    active: menuEnabled && !isSelecting,
    onOpenMenu: handleOpenMenu,
  });

  const { handlers: longPress } = useLongPress({
    enabled: menuEnabled && !isSelecting,
    onLongPress: handleOpenMenu,
    onShortClick: (e) => {
      if (isSelecting) {
        e.preventDefault();
        onRovingActivate?.();
        selection?.toggle(messageId);
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
          selection?.toggle(messageId);
          return;
        }
        if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          onRangeExtendKey?.(messageId, e.key === 'ArrowUp' ? 'up' : 'down');
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
    [isSelecting, menuEnabled, messageId, onRangeExtendKey, selection, handleOpenMenu],
  );

  const validTs = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0;
  const formattedTime = validTs ? formatTime(timestamp) : '--:--';
  const formattedDate = validTs ? formatChatDateSeparator(timestamp, t) : '';
  const shouldInteract = menuEnabled || isSelecting;
  const rowRole = isSelecting ? 'option' : 'listitem';
  const tabIndex =
    isSelecting ? rovingTabIndex : menuEnabled && !isSelecting ? -1 : -1;

  return (
    <>
      {showDateSeparator && formattedDate && (
        <div className="message-date-separator">
          <span>{formattedDate}</span>
        </div>
      )}
      <div
        ref={rootRef}
        className={
          `message ${isOwn ? 'message--own' : 'message--peer'} ${isNew ? 'message--new' : ''} ${
            isSelecting ? 'message--selectable' : ''
          } ${menuEnabled && !isSelecting ? 'message--menu-gestures' : ''} ${className}`.trim()
        }
        data-selected={isSelecting ? (isSelected ? 'true' : 'false') : undefined}
        data-message-id={messageId}
        role={rowRole}
        aria-selected={isSelecting ? isSelected : undefined}
        aria-labelledby={labelId}
        tabIndex={tabIndex}
        onMouseDown={onRowMouseDown}
        onKeyDown={onRowKeyDown}
        onDoubleClick={rowDoubleOpen.onDoubleClick}
        {...(shouldInteract ? handlers : {})}
        onPointerUp={
          shouldInteract
            ? (e) => {
                handlers.onPointerUp(e);
                rowDoubleOpen.onPointerUp(e);
              }
            : undefined
        }
      >
        <span id={labelId} className="visually-hidden">
          {a11yLabel}
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
        <div className="message-bubble">
          {!isOwn && senderName && <span className="message-sender-name">{senderName}</span>}
          {replyTo && replySenderLabel && onReplyQuoteClick && (
            <ReplyQuote
              reply={replyTo}
              senderLabel={replySenderLabel}
              onJumpToMessage={onReplyQuoteClick}
            />
          )}
          <p className="message-content">{content}</p>
          <div className="message-meta">
            <span className="message-time">{formattedTime}</span>
            <MessageRemainingTime
              ttlAnchorMs={ttlAnchorMs ?? timestamp}
              ttlSeconds={messageTtlSeconds}
            />
            {isEdited && (
              <span className="message-edited" aria-label={t('chat.edit.editedLabel')}>
                {t('chat.edit.editedLabel')}
              </span>
            )}
            {isOwn && (
              <span
                className="message-status"
                aria-label={messageStatusAriaLabel(t, status)}
              >
                <MessageStatusIcon status={status} />
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
});

/**
 * Format timestamp to time string (HH:MM)
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
