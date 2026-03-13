import { memo, useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageList } from '../MessageList';
import { MessageInput } from '../MessageInput';
import { ChatScreenHeader } from '../ChatScreenHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { hasGroupKey } from '@/crypto/keyStore';
import { useRoomMessages } from '@/hooks/useRoomMessages';
import type { UseRoomMessagesWebSocket } from '@/hooks/useRoomMessages';
import { useHaptics } from '@/hooks/useHaptics';
import '@/styles/ChatScreen.css';
import './RoomChatRoom.css';

// ============================================
// Icons (room-specific, not in header)
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
  roomId: string;
  epoch?: number;
  userId: number;
  ws: UseRoomMessagesWebSocket;
  memberCount?: number;
  isOwner?: boolean;
  onBack?: () => void;
  onManage?: () => void;
  onLeave?: () => void;
}

// ============================================
// Component
// ============================================

/**
 * RoomChatRoom — full chat UI for encrypted group rooms (P2-4.2.2).
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
  const toast = useToast();
  const haptics = useHaptics();
  const hasKey = hasGroupKey(roomId);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const { messages, sendMessage, isLoading, isSyncing, error } = useRoomMessages({
    roomId,
    userId,
    ws,
  });

  useEffect(() => {
    if (error) {
      toast.error(t('room.chat.sendError'), { duration: 4000 });
    }
  }, [error, t, toast]);

  const handleSend = useCallback((text: string) => {
    haptics.success();
    sendMessage(text);
  }, [sendMessage, haptics]);

  const handleLeaveClick = useCallback(() => {
    haptics.destructive();
    setShowLeaveConfirm(true);
  }, [haptics]);

  const handleLeaveConfirm = useCallback(() => {
    setShowLeaveConfirm(false);
    onLeave?.();
  }, [onLeave]);

  const handleLeaveCancel = useCallback(() => {
    setShowLeaveConfirm(false);
  }, []);

  const subtitle = hasKey
    ? memberCount != null
      ? t('room.chat.memberCount', { count: memberCount })
      : `E2EE · epoch ${epoch}`
    : t('room.chat.loadingKey');

  const headerLeft = (
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
  );

  const hasHeaderRight = (isOwner && onManage) || (!isOwner && onLeave);
  const headerRight = hasHeaderRight ? (
    <>
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
    </>
  ) : undefined;

  return (
    <div className="chat-screen room-chat-room">
      <ChatScreenHeader
        onBack={onBack}
        backAriaLabel={t('common.back')}
        left={headerLeft}
        right={headerRight}
      />

      {hasKey ? (
        <>
          <MessageList
            messages={messages}
            isLoading={isLoading || isSyncing}
            className="room-chat-room-messages chat-screen-messages"
          />
          <div className="chat-screen-input">
            <MessageInput
              onSend={handleSend}
              placeholder={t('chat.messagePlaceholder', { name: '🏠' })}
            />
          </div>
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

      <ConfirmDialog
        isOpen={showLeaveConfirm}
        onClose={handleLeaveCancel}
        onConfirm={handleLeaveConfirm}
        title={t('room.leave.title')}
        description={t('room.leave.description')}
        warning={t('room.leave.warning')}
        confirmLabel={t('room.leave.confirmButton')}
        cancelLabel={t('common.cancel')}
        variant="destructive"
        icon={<span role="img" aria-hidden>🚪</span>}
      />
    </div>
  );
});
