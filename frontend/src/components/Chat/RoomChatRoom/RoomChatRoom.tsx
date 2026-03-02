import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageList } from '../MessageList';
import { MessageInput } from '../MessageInput';
import { Button } from '../../Button';
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
// Leave icon (inline SVG)
// ============================================

function LeaveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13 14l4-4-4-4M17 10H7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 3H5a1 1 0 00-1 1v12a1 1 0 001 1h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============================================
// Settings icon (inline SVG)
// ============================================

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10 2v2m0 12v2M2 10h2m12 0h2m-3.172-4.828-1.414 1.414M4.586 15.414l1.414-1.414m0-8.414L4.586 4.586m11.828 11.828-1.414-1.414"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
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
  /** Whether the current user is the room owner */
  isOwner?: boolean;
  /** Callback to go back */
  onBack?: () => void;
  /** Callback to open room management (owner only) */
  onManage?: () => void;
  /** Callback to leave the room (member only, hidden for owner) */
  onLeave?: () => void;
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
  isOwner = false,
  onBack,
  onManage,
  onLeave,
}: RoomChatRoomProps) {
  const { t } = useTranslation();
  const hasKey = hasGroupKey(roomId);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const { messages, sendMessage, isLoading, isSyncing } = useRoomMessages({
    roomId,
    userId,
    ws,
  });

  const handleSend = useCallback((text: string) => {
    sendMessage(text);
  }, [sendMessage]);

  const handleLeaveClick = useCallback(() => {
    setShowLeaveConfirm(true);
  }, []);

  const handleLeaveConfirm = useCallback(() => {
    setShowLeaveConfirm(false);
    onLeave?.();
  }, [onLeave]);

  const handleLeaveCancel = useCallback(() => {
    setShowLeaveConfirm(false);
  }, []);

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
        <div className="room-chat-room-header-right">
          {isOwner && onManage && (
            <button
              type="button"
              className="room-chat-room-manage"
              onClick={onManage}
              aria-label={t('room.manage.title')}
            >
              <SettingsIcon />
            </button>
          )}
          {!isOwner && onLeave && (
            <button
              type="button"
              className="room-chat-room-leave"
              onClick={handleLeaveClick}
              aria-label={t('room.manage.leaveButton')}
            >
              <LeaveIcon />
            </button>
          )}
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

      {/* Leave room confirmation dialog */}
      {showLeaveConfirm && (
        <div className="room-chat-room-leave-overlay" role="dialog" aria-modal="true">
          <div className="room-chat-room-leave-dialog">
            <div className="room-chat-room-leave-dialog__icon">🚪</div>
            <h3 className="room-chat-room-leave-dialog__title">{t('room.leave.title')}</h3>
            <p className="room-chat-room-leave-dialog__text">{t('room.leave.description')}</p>
            <p className="room-chat-room-leave-dialog__warning">{t('room.leave.warning')}</p>
            <div className="room-chat-room-leave-dialog__actions">
              <Button variant="secondary" onClick={handleLeaveCancel} fullWidth>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                className="room-chat-room-leave-dialog__confirm-btn"
                onClick={handleLeaveConfirm}
                fullWidth
              >
                {t('room.leave.confirmButton')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
