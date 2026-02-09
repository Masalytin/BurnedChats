import { memo } from 'react';
import type { MessageStatus } from '@/types';
import './Message.css';

interface MessageProps {
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
  content,
  isOwn,
  timestamp,
  status = 'sent',
  showDateSeparator = false,
  className = '',
}: MessageProps) {
  const validTs = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0;
  const formattedTime = validTs ? formatTime(timestamp) : '--:--';
  const formattedDate = validTs ? formatDate(timestamp) : '';

  return (
    <>
      {showDateSeparator && formattedDate && (
        <div className="message-date-separator">
          <span>{formattedDate}</span>
        </div>
      )}
      <div
        className={`message ${isOwn ? 'message--own' : 'message--peer'} ${className}`}
        role="listitem"
      >
        <div className="message-bubble">
          <p className="message-content">{content}</p>
          <div className="message-meta">
            <span className="message-time">{formattedTime}</span>
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
