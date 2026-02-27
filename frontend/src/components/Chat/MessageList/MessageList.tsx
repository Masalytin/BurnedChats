import { useRef, useEffect, useCallback, memo } from 'react';
import { Message } from '../Message';
import { TypingIndicator } from '../TypingIndicator';
import type { DecryptedMessage } from '@/types';
import './MessageList.css';

interface MessageListProps {
  /** Array of decrypted messages to display */
  messages: DecryptedMessage[];
  /** Whether the peer is currently typing */
  isPeerTyping?: boolean;
  /** Name of the peer (for typing indicator) */
  peerName?: string;
  /** Whether messages are loading */
  isLoading?: boolean;
  /** Callback when user scrolls to top (for loading older messages) */
  onLoadMore?: () => void;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Message list component (4.3.2)
 * 
 * Displays a scrollable list of messages with:
 * - Auto-scroll to bottom on new messages
 * - Date separators between days
 * - Typing indicator
 * - Loading state
 */
export const MessageList = memo(function MessageList({
  messages,
  isPeerTyping = false,
  peerName,
  isLoading = false,
  onLoadMore,
  className = '',
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  /**
   * Check if scroll is near bottom
   */
  const checkIfNearBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) return true;
    const threshold = 100; // pixels from bottom
    return list.scrollHeight - list.scrollTop - list.clientHeight < threshold;
  }, []);

  /**
   * Scroll to bottom of list
   */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  /**
   * Handle scroll event
   */
  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    isNearBottomRef.current = checkIfNearBottom();

    // Load more when scrolled to top
    if (list.scrollTop === 0 && onLoadMore) {
      onLoadMore();
    }
  }, [checkIfNearBottom, onLoadMore]);

  /**
   * Auto-scroll on new messages (only if user was near bottom)
   */
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  /**
   * Scroll to bottom on initial load
   */
  useEffect(() => {
    scrollToBottom('instant');
  }, [scrollToBottom]);

  /**
   * Scroll to bottom when peer starts typing
   */
  useEffect(() => {
    if (isPeerTyping && isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [isPeerTyping, scrollToBottom]);

  /**
   * Determine if we should show a date separator before this message
   */
  const shouldShowDateSeparator = (index: number): boolean => {
    if (index === 0) return true;
    const currentDate = new Date(messages[index].timestamp);
    const prevDate = new Date(messages[index - 1].timestamp);
    return !isSameDay(currentDate, prevDate);
  };

  if (isLoading && messages.length === 0) {
    return (
      <div className={`message-list message-list--loading ${className}`}>
        <div className="message-list-loader">
          <div className="message-list-spinner" />
          <p>Loading messages...</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={`message-list message-list--empty ${className}`}>
        <div className="message-list-empty">
          <span className="message-list-empty-icon">💬</span>
          <p>No messages yet</p>
          <p className="message-list-empty-hint">
            Send a message to start the conversation
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className={`message-list ${className}`}
      onScroll={handleScroll}
      role="list"
      aria-label="Chat messages"
    >
      {/* Loading indicator at top */}
      {isLoading && (
        <div className="message-list-loading-more">
          <div className="message-list-spinner message-list-spinner--small" />
        </div>
      )}

      {/* Messages */}
      {messages.map((message, index) => (
        <Message
          key={message.id}
          content={message.content}
          isOwn={message.isOwn}
          timestamp={message.timestamp}
          status={message.status}
          showDateSeparator={shouldShowDateSeparator(index)}
          senderName={message.senderName}
        />
      ))}

      {/* Typing indicator */}
      {isPeerTyping && <TypingIndicator userName={peerName} />}

      {/* Scroll anchor */}
      <div ref={bottomRef} className="message-list-bottom" />
    </div>
  );
});

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
