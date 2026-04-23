import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageType } from '@/types';
import './ReplyChip.css';

export interface ReplyChipModel {
  senderName: string;
  preview: string;
  type: MessageType;
}

export interface ReplyChipProps {
  replyTo: ReplyChipModel | null;
  onCancel: () => void;
}

export const ReplyChip = memo(function ReplyChip({ replyTo, onCancel }: ReplyChipProps) {
  const { t } = useTranslation();
  if (!replyTo) {
    return null;
  }
  return (
    <div
      className="reply-chip"
      role="status"
      aria-live="polite"
      aria-label={t('chat.reply.chipLabel', { name: replyTo.senderName })}
    >
      <div className="reply-chip__text">
        <div className="reply-chip__label">{t('chat.reply.chipLabel', { name: replyTo.senderName })}</div>
        <div className="reply-chip__preview">{replyTo.preview}</div>
      </div>
      <button
        type="button"
        className="reply-chip__close"
        onClick={onCancel}
        aria-label={t('chat.reply.cancelAriaLabel')}
      >
        ×
      </button>
    </div>
  );
});
