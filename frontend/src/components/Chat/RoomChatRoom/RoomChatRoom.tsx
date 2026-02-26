import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { hasGroupKey } from '@/crypto/keyStore';
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
// Component
// ============================================

interface RoomChatRoomProps {
  /** Room identifier */
  roomId: string;
  /** Current key epoch (for display purposes) */
  epoch?: number;
  /** Callback to go back */
  onBack?: () => void;
}

/**
 * RoomChatRoom — placeholder screen entered after KEY_BUNDLE is received and
 * the group key is stored in keyStore (P2-3.2.3).
 *
 * Full messaging UI is implemented in P2-4.2.2.
 */
export const RoomChatRoom = memo(function RoomChatRoom({
  roomId,
  epoch = 0,
  onBack,
}: RoomChatRoomProps) {
  const { t } = useTranslation();
  const hasKey = hasGroupKey(roomId);

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
            <div className="room-chat-room-subtitle">
              {hasKey
                ? `E2EE · epoch ${epoch}`
                : t('room.chat.loadingKey')}
            </div>
          </div>
        </div>
      </div>

      {/* Body — placeholder until P2-4.2.2 */}
      <div className="room-chat-room-body">
        {hasKey ? (
          <div className="room-chat-room-placeholder">
            <div className="room-chat-room-placeholder-icon">🔐</div>
            <div className="room-chat-room-placeholder-text">
              Encrypted room chat
            </div>
            <div className="room-chat-room-placeholder-hint">
              Messaging UI coming in P2-4
            </div>
          </div>
        ) : (
          <div className="room-chat-room-placeholder">
            <div className="room-chat-room-placeholder-icon">⏳</div>
            <div className="room-chat-room-placeholder-text">
              {t('room.chat.loadingKey')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
