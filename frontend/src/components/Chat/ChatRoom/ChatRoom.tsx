import { memo, useCallback } from 'react';
import { MessageList } from '../MessageList';
import { MessageInput } from '../MessageInput';
import { Avatar } from '@/components/Avatar';
import type { DecryptedMessage, UserInfo } from '@/types';
import './ChatRoom.css';

interface ChatRoomProps {
  /** Session ID for the chat */
  sessionId: string;
  /** Information about the peer user */
  peer: UserInfo;
  /** Array of decrypted messages */
  messages: DecryptedMessage[];
  /** Whether the peer is currently typing */
  isPeerTyping?: boolean;
  /** Whether messages are loading */
  isLoading?: boolean;
  /** Whether peer is verified (fingerprint matched) */
  isVerified?: boolean;
  /** Callback when message is sent */
  onSendMessage: (text: string) => void;
  /** Callback when user typing status changes */
  onTypingChange?: (isTyping: boolean) => void;
  /** Callback when burn button is clicked */
  onBurn?: () => void;
  /** Callback to go back */
  onBack?: () => void;
  /** Whether the chat is disabled (e.g., during burn) */
  disabled?: boolean;
  /** Optional CSS class name */
  className?: string;
}

/**
 * ChatRoom component (4.3.1)
 * 
 * Main chat container that combines:
 * - Chat header with peer info
 * - Message list with auto-scroll
 * - Message input with typing indicator
 * - Burn button for destroying the session
 */
export const ChatRoom = memo(function ChatRoom({
  sessionId,
  peer,
  messages,
  isPeerTyping = false,
  isLoading = false,
  isVerified = false,
  onSendMessage,
  onTypingChange,
  onBurn,
  onBack,
  disabled = false,
  className = '',
}: ChatRoomProps) {
  /**
   * Handle message send
   */
  const handleSend = useCallback((text: string) => {
    onSendMessage(text);
  }, [onSendMessage]);

  /**
   * Handle typing status change
   */
  const handleTypingChange = useCallback((isTyping: boolean) => {
    onTypingChange?.(isTyping);
  }, [onTypingChange]);

  return (
    <div className={`chat-room ${className}`}>
      {/* Chat Header */}
      <div className="chat-room-header">
        <div className="chat-room-header-left">
          {onBack && (
            <button
              type="button"
              className="chat-room-back"
              onClick={onBack}
              aria-label="Go back"
            >
              <BackIcon />
            </button>
          )}
          <Avatar
            name={peer.displayName}
            photoUrl={peer.photoUrl}
            size="sm"
            online={peer.online}
          />
          <div className="chat-room-peer-info">
            <div className="chat-room-peer-name">
              {peer.displayName}
              {peer.premium && <span className="chat-room-premium">⭐</span>}
              {isVerified && (
                <span 
                  className="chat-room-verified" 
                  title="Encrypted & Verified"
                  aria-label="Encrypted and verified"
                >
                  🔒
                </span>
              )}
            </div>
            <div className="chat-room-peer-status">
              {isPeerTyping ? (
                <span className="chat-room-typing">typing...</span>
              ) : peer.online ? (
                <span className="chat-room-online">online</span>
              ) : (
                <span className="chat-room-offline">offline</span>
              )}
            </div>
          </div>
        </div>
        
        <div className="chat-room-header-right">
          {onBurn && (
            <button
              type="button"
              className="chat-room-burn"
              onClick={onBurn}
              disabled={disabled}
              aria-label="Burn chat"
              title="Destroy this chat permanently"
            >
              🔥
            </button>
          )}
        </div>
      </div>

      {/* Message List */}
      <MessageList
        messages={messages}
        isPeerTyping={isPeerTyping}
        peerName={peer.displayName}
        isLoading={isLoading}
        className="chat-room-messages"
      />

      {/* Message Input */}
      <MessageInput
        onSend={handleSend}
        onTypingChange={handleTypingChange}
        disabled={disabled}
        placeholder={`Message ${peer.displayName}...`}
      />
    </div>
  );
});

/**
 * Back arrow icon SVG
 */
function BackIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
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
