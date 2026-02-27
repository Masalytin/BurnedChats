import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageList } from '../MessageList';
import { MessageInput } from '../MessageInput';
import { hasGroupKey } from '@/crypto/keyStore';
import { useRoomMessages } from '@/hooks/useRoomMessages';
import type { UseRoomMessagesWebSocket } from '@/hooks/useRoomMessages';
import './RoomChatRoom.css';

// ============================================
// Back icon (inline SVG)
// ============================================

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M12.5 15L7.5 10L12.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============================================
// Component Props
// ============================================

interface RoomChatRoomProps {
  /** Room identifier */
  roomId: string;
  /** Current key epoch */
  epoch?: number;
  /** Current user's Telegram ID */
  userId: number;
  /** WebSocket connection */
  ws: UseRoomMessagesWebSocket;
  /** Optional member count for display */
  memberCount?: number;
  /** Callback to go back */
  onBack?: () => void;
}

// ============================================
// Component
// ============================================

/**
 * RoomChatRoom — full chat UI for encrypted group rooms (P2-4.2.2).
 *
 * Subscribes to /topic/room/{roomId}, retrieves the group key from keyStore,
 * and renders MessageList + MessageInput with AES-GCM encryption.
 *
 * States:
 * - Loading key: group key not yet in keyStore
 * - No access: group key absent after load (fallback)
 * - Active chat: group key present, full messaging UI
 */
export const RoomChatRoom = memo(function RoomChatRoom({
  roomId,
  epoch = 0,
  userId,
  ws,
  memberCount,
  onBack,
}: RoomChatRoomProps) {
  const { t } = useTranslation();
  const hasKey = hasGroupKey(roomId);

  const { messages, sendMessage, isLoading, isSyncing } = useRoomMessages({
    roomId,
    userId,
    ws,
  });

  const handleSend = useCallback((text: string) => {
    sendMessage(text);
  }, [sendMessage]);

  // ----------------------------------------
  // Header subtitle: member count or E2EE info
  // ----------------------------------------
  const subtitle = hasKey
    ? memberCount != null
      ? t('room.chat.memberCount', { count: memberCount })
      : `E2EE · epoch ${epoch}`
    : t('room.chat.loadingKey');

  // ----------------------------------------
  // Render
  // ----------------------------------------
  return (
    <div className="room-chat-room">
      {/* Header */}
      <div className="room-chat-room-header">
        <div className="room-chat-room-header-left">
          {onBack && (
            <button
              type="button"
              className="room-chat-room-back"
              onClick={onBack}
              aria-label={t('common.back')}
            >
              <BackIcon />
            </button>
          )}
          <div className="room-chat-room-info">
            <div className="room-chat-room-title">
              <span className="room-chat-room-icon">🏠</span>
              <span className="room-chat-room-id">
                {roomId.length > 12 ? `${roomId.slice(0, 8)}…` : roomId}
              </span>
              {hasKey && (
                <span className="room-chat-room-encrypted" title="End-to-End Encrypted">
                  🔒
                </span>
              )}
            </div>
            <div className="room-chat-room-subtitle">{subtitle}</div>
          </div>
        </div>
      </div>

      {/* Body */}
      {hasKey ? (
        <>
          <MessageList
            messages={messages}
            isLoading={isLoading || isSyncing}
            className="room-chat-room-messages"
          />
          <MessageInput
            onSend={handleSend}
            placeholder={t('chat.messagePlaceholder', { name: '🏠' })}
          />
        </>
      ) : (
        <div className="room-chat-room-body">
          <div className="room-chat-room-placeholder">
            <div className="room-chat-room-placeholder-icon">⏳</div>
            <div className="room-chat-room-placeholder-text">
              {t('room.chat.loadingKey')}
            </div>
            <div className="room-chat-room-placeholder-hint">
              {t('room.chat.noAccessHint')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
