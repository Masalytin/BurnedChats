import { memo, useCallback, type MouseEvent } from 'react';
import type { ReplyToInfo } from '@/types';
import './ReplyQuote.css';

export interface ReplyQuoteProps {
  reply: ReplyToInfo;
  senderLabel: string;
  onJumpToMessage: (messageId: string) => void;
}

export const ReplyQuote = memo(function ReplyQuote({ reply, senderLabel, onJumpToMessage }: ReplyQuoteProps) {
  const onClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onJumpToMessage(reply.messageId);
    },
    [onJumpToMessage, reply.messageId],
  );
  return (
    <button
      type="button"
      className="reply-quote"
      onClick={onClick}
      aria-label={senderLabel}
    >
      <span className="reply-quote__bar" aria-hidden />
      <span className="reply-quote__body">
        <span className="reply-quote__name">{senderLabel}</span>
        <span className="reply-quote__preview">{reply.preview}</span>
      </span>
    </button>
  );
});
