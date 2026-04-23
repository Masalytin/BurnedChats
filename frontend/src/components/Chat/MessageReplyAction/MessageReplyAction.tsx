import { memo, useCallback, type MouseEvent } from 'react';
import { Reply } from 'lucide-react';
import './MessageReplyAction.css';

export interface MessageReplyActionProps {
  /** When false, nothing is rendered */
  visible: boolean;
  onReply: () => void;
  ariaLabel: string;
  title: string;
}

export const MessageReplyAction = memo(function MessageReplyAction({
  visible,
  onReply,
  ariaLabel,
  title,
}: MessageReplyActionProps) {
  const onClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onReply();
    },
    [onReply],
  );

  if (!visible) {
    return null;
  }

  return (
    <div className="message__reply-wrap">
      <button
        type="button"
        className="message__reply-btn"
        aria-label={ariaLabel}
        title={title}
        onClick={onClick}
      >
        <Reply size={20} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
});
