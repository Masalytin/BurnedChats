import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { useToast } from '../Toast';
import './CreateRoomView.css';

interface RoomCreatedSuccessProps {
  roomId: string;
  /** Deep-link to the room (e.g. Telegram startapp link). May be null before P2-2. */
  inviteLink?: string | null;
  onEnterRoom?: (roomId: string) => void;
  /** If provided, shows a "Join Requests" button for rooms with BY_REQUEST mode. */
  onViewRequests?: (roomId: string) => void;
  /** Number of pending join requests (shows a badge on the button). */
  pendingRequestsCount?: number;
}

/**
 * Shown after a room is successfully created.
 * Displays the room ID and a "Copy invite link" button when an invite link is available.
 */
export function RoomCreatedSuccess({
  roomId,
  inviteLink,
  onEnterRoom,
  onViewRequests,
  pendingRequestsCount = 0,
}: RoomCreatedSuccessProps) {
  const { t } = useTranslation();
  const toast = useToast();

  const handleCopyLink = useCallback(async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    toast.success(t('room.create.linkCopied'));
  }, [inviteLink, toast, t]);

  return (
    <div className="create-room-view create-room-view--success">
      <div className="create-room-view__header">
        <div className="create-room-view__icon" aria-hidden="true">
          🔥
        </div>
        <h2 className="create-room-view__title">{t('room.create.successTitle')}</h2>
      </div>

      <div className="create-room-view__form">
        {inviteLink && (
          <Button variant="secondary" onClick={handleCopyLink} fullWidth>
            {t('room.create.copyLinkButton')}
          </Button>
        )}

        {onViewRequests && (
          <Button variant="secondary" onClick={() => onViewRequests(roomId)} fullWidth>
            {t('room.manage.requestsButton')}
            {pendingRequestsCount > 0 && ` (${pendingRequestsCount})`}
          </Button>
        )}

        {onEnterRoom && (
          <Button onClick={() => onEnterRoom(roomId)} fullWidth>
            → {roomId.slice(0, 8)}…
          </Button>
        )}
      </div>
    </div>
  );
}
