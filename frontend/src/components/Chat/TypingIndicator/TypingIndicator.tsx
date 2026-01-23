import { memo } from 'react';
import './TypingIndicator.css';

interface TypingIndicatorProps {
  /** Name of the user who is typing */
  userName?: string;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Typing indicator component (4.3.6)
 * 
 * Shows animated dots to indicate that the peer is typing.
 * Appears as a small bubble similar to a message.
 */
export const TypingIndicator = memo(function TypingIndicator({
  userName,
  className = '',
}: TypingIndicatorProps) {
  return (
    <div className={`typing-indicator ${className}`} role="status" aria-live="polite">
      <div className="typing-indicator-bubble">
        <div className="typing-indicator-dots">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
      {userName && (
        <span className="typing-indicator-text">
          {userName} is typing
        </span>
      )}
    </div>
  );
});
