import { useState, useCallback, useRef, useEffect, memo, type KeyboardEvent, type ChangeEvent } from 'react';
import './MessageInput.css';

interface MessageInputProps {
  /** Callback when message is submitted */
  onSend: (text: string) => void;
  /** Callback when user starts/stops typing (for typing indicator) */
  onTypingChange?: (isTyping: boolean) => void;
  /** Whether sending is disabled */
  disabled?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Whether a message is currently being sent */
  isSending?: boolean;
  /** Max message length */
  maxLength?: number;
  /** Optional CSS class name */
  className?: string;
}

/** Typing indicator debounce delay in ms */
const TYPING_DEBOUNCE = 2000;

/**
 * Message input component (4.3.3)
 * 
 * Text input with send button for composing messages.
 * Features:
 * - Auto-resize textarea
 * - Send on Enter (Shift+Enter for new line)
 * - Typing indicator support
 * - Character limit
 */
export const MessageInput = memo(function MessageInput({
  onSend,
  onTypingChange,
  disabled = false,
  placeholder = 'Message...',
  isSending = false,
  maxLength = 4096,
  className = '',
}: MessageInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasTypingRef = useRef(false);

  /**
   * Handle textarea value change
   */
  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    
    // Enforce max length
    if (newText.length > maxLength) {
      return;
    }

    setText(newText);

    // Typing indicator logic
    if (onTypingChange && newText.length > 0) {
      // Clear existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Notify that user is typing
      if (!wasTypingRef.current) {
        wasTypingRef.current = true;
        onTypingChange(true);
      }

      // Set timeout to stop typing indicator
      typingTimeoutRef.current = setTimeout(() => {
        wasTypingRef.current = false;
        onTypingChange(false);
      }, TYPING_DEBOUNCE);
    }
  }, [maxLength, onTypingChange]);

  /**
   * Handle key press
   */
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [text, disabled, isSending]);

  /**
   * Submit the message
   */
  const handleSubmit = useCallback(() => {
    const trimmedText = text.trim();
    
    if (!trimmedText || disabled || isSending) {
      return;
    }

    // Clear typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (wasTypingRef.current) {
      wasTypingRef.current = false;
      onTypingChange?.(false);
    }

    // Send message
    onSend(trimmedText);
    setText('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, isSending, onSend, onTypingChange]);

  /**
   * Auto-resize textarea based on content
   */
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    
    // Set new height (max 150px)
    const newHeight = Math.min(textarea.scrollHeight, 150);
    textarea.style.height = `${newHeight}px`;
  }, [text]);

  /**
   * Cleanup typing timeout on unmount
   */
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (wasTypingRef.current) {
        onTypingChange?.(false);
      }
    };
  }, [onTypingChange]);

  const canSend = text.trim().length > 0 && !disabled && !isSending;

  return (
    <div className={`message-input ${className}`}>
      <div className="message-input-container">
        <textarea
          ref={textareaRef}
          className="message-input-field"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          maxLength={maxLength}
          aria-label="Type a message"
        />
        <button
          type="button"
          className={`message-input-send ${canSend ? 'message-input-send--active' : ''}`}
          onClick={handleSubmit}
          disabled={!canSend}
          aria-label="Send message"
        >
          {isSending ? (
            <span className="message-input-spinner" />
          ) : (
            <SendIcon />
          )}
        </button>
      </div>
      
      {/* Character counter (show when approaching limit) */}
      {text.length > maxLength * 0.8 && (
        <div className="message-input-counter">
          {text.length} / {maxLength}
        </div>
      )}
    </div>
  );
});

/**
 * Send icon SVG
 */
function SendIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="message-input-send-icon"
    >
      <path
        d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"
        fill="currentColor"
      />
    </svg>
  );
}
