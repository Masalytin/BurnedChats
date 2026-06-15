import { Flame } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RoomListEntry } from '../../types';
import './RoomCard.css';

interface RoomCardProps {
  room: RoomListEntry;
  onClick?: (roomId: string) => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function shortRoomId(roomId: string): string {
  return roomId.substring(0, 8).toUpperCase();
}

/**
 * Card component displaying a single room entry on the home page.
 */
export function RoomCard({ room, onClick }: RoomCardProps) {
  const { t } = useTranslation();
  const isOwner = room.role === 'owner';
  const roleLabel = isOwner ? t('room.roleOwner') : t('room.roleMember');

  return (
    <button
      className="room-card"
      onClick={() => onClick?.(room.roomId)}
      type="button"
    >
      <div className="room-card-icon" aria-hidden="true">
        <Flame size={24} strokeWidth={1.75} />
      </div>
      <div className="room-card-content">
        <span className="room-card-id">
          {t('room.roomLabel', { id: shortRoomId(room.roomId), defaultValue: `Room ${shortRoomId(room.roomId)}` })}
        </span>
        <span className="room-card-date">{formatDate(room.createdAt)}</span>
      </div>
      <span className={`room-card-badge ${isOwner ? 'room-card-badge--owner' : 'room-card-badge--member'}`}>
        {roleLabel}
      </span>
    </button>
  );
}
