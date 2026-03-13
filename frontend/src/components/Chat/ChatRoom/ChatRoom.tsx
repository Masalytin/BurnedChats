import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageList } from '../MessageList';
import { MessageInput } from '../MessageInput';
import { ChatScreenHeader } from '../ChatScreenHeader';
import { Avatar } from '@/components/Avatar';
import { useHaptics } from '@/hooks/useHaptics';
import type { DecryptedMessage, UserInfo } from '@/types';
import '@/styles/ChatScreen.css';
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
  /** Optional error message to show when disabled (e.g. "Chat temporarily unavailable") */
  errorMessage?: string;
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
  sessionId: _sessionId,
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
  errorMessage,
  className = '',
}: ChatRoomProps) {
  const { t } = useTranslation();
  const haptics = useHaptics();
  /** Display name for header/placeholder (backend may omit) */
  const displayName = peer?.displayName?.trim() || `User ${peer?.id ?? ''}`.trim() || t('common.unknown');

  const handleSend = useCallback((text: string) => {
    haptics.success();
    onSendMessage(text);
  }, [onSendMessage, haptics]);

  const handleTypingChange = useCallback((isTyping: boolean) => {
    onTypingChange?.(isTyping);
  }, [onTypingChange]);

  const handleBurnClick = useCallback(() => {
    haptics.destructive();
    onBurn?.();
  }, [onBurn, haptics]);

  const headerLeft = (
    <>
      <Avatar
        name={displayName}
        src={peer.photoUrl}
        size="sm"
      />
      <div className="chat-room-peer-info">
        <div className="chat-room-peer-name">
          {displayName}
          {peer.premium && <span className="chat-room-premium">⭐</span>}
          {isVerified && (
            <span
              className="chat-room-verified"
              title={t('chat.verifiedTitle')}
              aria-label={t('chat.verifiedTitle')}
            >
              🔒
            </span>
          )}
        </div>
        <div className="chat-room-peer-status">
          {isPeerTyping ? (
            <span className="chat-room-typing">{t('status.typing')}</span>
          ) : peer.online ? (
            <span className="chat-room-online">{t('status.online')}</span>
          ) : (
            <span className="chat-room-offline">{t('status.offline')}</span>
          )}
        </div>
      </div>
    </>
  );

  const headerRight = onBurn ? (
    <button
      type="button"
      className="chat-room-burn"
      onClick={handleBurnClick}
      disabled={disabled}
      aria-label={t('chat.burnButtonLabel')}
      title={t('chat.burnButtonTitle')}
    >
      🔥
    </button>
  ) : undefined;

  return (
    <div className={`chat-screen chat-room ${className}`}>
      <ChatScreenHeader
        onBack={onBack}
        backAriaLabel={t('common.back')}
        left={headerLeft}
        right={headerRight}
      />

      {errorMessage && disabled && (
        <div className="chat-room-error-banner" role="alert">
          {errorMessage}
        </div>
      )}

      <MessageList
        messages={messages}
        isPeerTyping={isPeerTyping}
        peerName={displayName}
        isLoading={isLoading}
        className="chat-room-messages chat-screen-messages"
      />

      <div className="chat-screen-input">
        <MessageInput
          onSend={handleSend}
          onTypingChange={handleTypingChange}
          disabled={disabled}
          placeholder={t('chat.messagePlaceholder', { name: displayName })}
        />
      </div>
    </div>
  );
});
