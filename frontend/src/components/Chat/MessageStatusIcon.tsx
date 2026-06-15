import { memo } from 'react';
import { AlertCircle, Clock } from 'lucide-react';
import { CheckCheckIcon, CheckIcon } from '@/icons';
import type { MessageStatus } from '@/types';

const STATUS_ICON_SIZE = 14;

interface MessageStatusIconProps {
  status: MessageStatus;
}

/**
 * Delivery status glyph for own messages (Telegram-style checks).
 * Decorative — parent carries aria-label via messageStatusAriaLabel().
 */
export const MessageStatusIcon = memo(function MessageStatusIcon({
  status,
}: MessageStatusIconProps) {
  switch (status) {
    case 'sending':
      return (
        <span className="status-icon status-icon--sending" aria-hidden="true">
          <Clock size={STATUS_ICON_SIZE} />
        </span>
      );
    case 'sent':
      return (
        <span className="status-icon status-icon--sent" aria-hidden="true">
          <CheckIcon size={STATUS_ICON_SIZE} />
        </span>
      );
    case 'delivered':
      return (
        <span className="status-icon status-icon--delivered" aria-hidden="true">
          <CheckCheckIcon size={STATUS_ICON_SIZE} />
        </span>
      );
    case 'read':
      return (
        <span className="status-icon status-icon--read" aria-hidden="true">
          <CheckCheckIcon size={STATUS_ICON_SIZE} />
        </span>
      );
    case 'failed':
      return (
        <span className="status-icon status-icon--failed" aria-hidden="true">
          <AlertCircle size={STATUS_ICON_SIZE} />
        </span>
      );
    default:
      return null;
  }
});
