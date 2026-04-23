import { memo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageStatus, ReplyToInfo } from '@/types';
import { useHaptics } from '@/hooks/useHaptics';
import { useLongPress } from '@/hooks/useLongPress';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import type { UseMessageSelectionReturn } from '@/hooks/useMessageSelection';
import { mergeMessagePointerHandlers } from '@/utils/messagePointerMerge';
import { ReplyQuote } from '../ReplyQuote';
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
  /** When set, show a subtle “edited” label next to the time. */
  isEdited?: boolean;
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
  isEdited = false,
}: MessageProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const haptics = useHaptics();
  const menuEnabled = Boolean(onOpenActionMenu);
  const isSelecting = selection?.mode === 'selecting';
  const isSelected = selection ? selection.isSelected(messageId) : false;

  const handleOpenMenu = useCallback(() => {
    if (!onOpenActionMenu || !rootRef.current) return;
    haptics.selectionChanged();
    onOpenActionMenu(messageId, rootRef.current.getBoundingClientRect());
  }, [haptics, messageId, onOpenActionMenu]);

  const { handlers: longPress } = useLongPress({
    enabled: menuEnabled && !isSelecting,
    onLongPress: handleOpenMenu,
    onShortClick: (e) => {
      if (isSelecting) {
        e.preventDefault();
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

  const validTs = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0;
  const formattedTime = validTs ? formatTime(timestamp) : '--:--';
  const formattedDate = validTs ? formatDate(timestamp) : '';
  const shouldInteract = menuEnabled || isSelecting;

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
          } ${className}`.trim()
        }
        data-selected={isSelecting ? (isSelected ? 'true' : 'false') : undefined}
        data-message-id={messageId}
        role="listitem"
        {...(shouldInteract ? handlers : {})}
      >
        {isSelecting && (
          <span
            className="message__select-checkbox"
            aria-hidden
            data-checked={isSelected ? 'true' : 'false'}
          />
        )}
        <div className="message-bubble">
          {!isOwn && senderName && (
            <span className="message-sender-name">{senderName}</span>
          )}
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
            {isEdited && (
              <span className="message-edited" aria-label={t('chat.edit.editedLabel')}>
                {t('chat.edit.editedLabel')}
              </span>
            )}
            {isOwn && (
              <span className="message-status" aria-label={getStatusLabel(status)}>
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
 * Message status icon component (4.3.5)
 * 
 * Displays delivery status:
 * - sending: clock icon (⏳)
 * - sent: single check (✓)
 * - delivered: double check (✓✓)
 * - read: double check blue (✓✓)
 * - failed: error icon (!)
 */
function MessageStatusIcon({ status }: { status: MessageStatus }) {
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

/**
 * Get accessibility label for message status
 */
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

/**
 * Format timestamp to date string for separator
 */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(date, today)) {
    return 'Today';
  } else if (isSameDay(date, yesterday)) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  }
}

/**
 * Check if two dates are the same day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}
