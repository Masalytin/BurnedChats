import { useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Message } from '../Message';
import { ImageMessageBubble } from '../ImageMessageBubble';
import { VideoMessageBubble } from '../VideoMessageBubble';
import { TypingIndicator } from '../TypingIndicator';
import { UploadProgressOverlay } from '../UploadProgressOverlay';
import type { UploadStage } from '../UploadProgressOverlay';
import type { DecryptedMessage, DecryptedFileMessage } from '@/types';
import './MessageList.css';

interface UploadStateInfo {
  progress: number;
  stage: UploadStage;
  fileName: string;
}

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
  /** Active upload state for showing a placeholder bubble (P4-4-1-3) */
  uploadState?: UploadStateInfo;
  /** Cancel current upload */
  onCancelUpload?: () => void;
  /** Retry failed upload */
  onRetryUpload?: () => void;
  /** Open full-screen media viewer for an image message (P4-4-2-1 → P4-4-2-4) */
  onOpenViewer?: (message: DecryptedFileMessage) => void;
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
  uploadState,
  onCancelUpload,
  onRetryUpload,
  onOpenViewer,
  className = '',
}: MessageListProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const firstRenderRef = useRef(true);

  /** IDs of messages that just appeared (for entrance animation); skip on initial load */
  const newMessageIds = useMemo(() => {
    if (firstRenderRef.current) return new Set<string>();
    const added = new Set<string>();
    messages.forEach((m) => {
      if (!prevIdsRef.current.has(m.id)) added.add(m.id);
    });
    return added;
  }, [messages]);

  useEffect(() => {
    prevIdsRef.current = new Set(messages.map((m) => m.id));
    firstRenderRef.current = false;
  });

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
          <p>{t('chat.loadingMessages')}</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={`message-list message-list--empty ${className}`}>
        <div className="message-list-empty">
          <span className="message-list-empty-icon">💬</span>
          <p>{t('chat.emptyMessages')}</p>
          <p className="message-list-empty-hint">
            {t('chat.emptyHint')}
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
      {messages.map((message, index) => {
        const dateSep = shouldShowDateSeparator(index);

        if (message.type === 'image' && isFileMessage(message)) {
          return (
            <div key={message.id}>
              {dateSep && (
                <div className="message-date-separator">
                  <span>{formatDateForSeparator(message.timestamp)}</span>
                </div>
              )}
              <ImageMessageBubble
                message={message}
                onOpenViewer={onOpenViewer}
              />
            </div>
          );
        }

        if (message.type === 'video' && isFileMessage(message)) {
          return (
            <div key={message.id}>
              {dateSep && (
                <div className="message-date-separator">
                  <span>{formatDateForSeparator(message.timestamp)}</span>
                </div>
              )}
              <VideoMessageBubble
                message={message}
                onOpenViewer={onOpenViewer}
              />
            </div>
          );
        }

        return (
          <Message
            key={message.id}
            content={message.content}
            isOwn={message.isOwn}
            timestamp={message.timestamp}
            status={message.status}
            showDateSeparator={dateSep}
            senderName={message.senderName}
            isNew={newMessageIds.has(message.id)}
          />
        );
      })}

      {/* P4-4-1-3: Upload placeholder bubble */}
      {uploadState && (
        <div className="message message--own message--uploading" role="listitem">
          <div className="message-bubble message-bubble--uploading">
            <span className="message-upload-filename">{uploadState.fileName}</span>
            <UploadProgressOverlay
              progress={uploadState.progress}
              stage={uploadState.stage}
              onCancel={onCancelUpload ?? (() => {})}
              onRetry={onRetryUpload}
            />
          </div>
        </div>
      )}

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

/**
 * Type guard: checks whether a DecryptedMessage is a DecryptedFileMessage.
 */
function isFileMessage(msg: DecryptedMessage): msg is DecryptedFileMessage {
  return msg.type !== 'text' && 'fileId' in msg && typeof (msg as DecryptedFileMessage).fileId === 'string';
}

/**
 * Format timestamp to date string for separator (mirrored from Message component).
 */
function formatDateForSeparator(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}
