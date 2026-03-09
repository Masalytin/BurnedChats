import type { ReactNode } from 'react';
import '@/styles/ChatScreen.css';

export interface ChatScreenHeaderProps {
  onBack?: () => void;
  backAriaLabel?: string;
  left: ReactNode;
  right?: ReactNode;
  className?: string;
}

/**
 * Shared chat screen header with back button and left/right slots.
 * Used by ChatRoom and RoomChatRoom for consistent layout and styling.
 */
export function ChatScreenHeader({
  onBack,
  backAriaLabel = 'Go back',
  left,
  right,
  className = '',
}: ChatScreenHeaderProps) {
  return (
    <div className={`chat-screen-header ${className}`.trim()}>
      <div className="chat-screen-header-left">
        {onBack && (
          <button
            type="button"
            className="chat-screen-back"
            onClick={onBack}
            aria-label={backAriaLabel}
          >
            <BackIcon />
          </button>
        )}
        {left}
      </div>
      {right != null && (
        <div className="chat-screen-header-right">
          {right}
        </div>
      )}
    </div>
  );
}

function BackIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
