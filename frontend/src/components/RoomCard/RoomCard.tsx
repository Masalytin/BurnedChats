import { useEffect, useState } from 'react';
import { Flame, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatShortRoomId, resolveRoomDisplayName } from '../../crypto/groupKey';
import type { RoomListEntry } from '../../types';
import './RoomCard.css';

interface RoomCardProps {
  room: RoomListEntry;
  onClick?: (roomId: string) => void;
  /** True when local group key was cleared (e.g. after background burn). */
  keysBurned?: boolean;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Card component displaying a single room entry on the home page.
 */
export function RoomCard({ room, onClick, keysBurned = false }: RoomCardProps) {
  const { t } = useTranslation();
  const isOwner = room.role === 'owner';
  const roleLabel = isOwner ? t('room.roleOwner') : t('room.roleMember');
  const [displayLabel, setDisplayLabel] = useState(() => formatShortRoomId(room.roomId));

  useEffect(() => {
    let cancelled = false;
    void resolveRoomDisplayName(room.roomId, room.nameEncrypted, room.nameIv).then((label) => {
      if (!cancelled) {
        setDisplayLabel(label);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [room.roomId, room.nameEncrypted, room.nameIv]);

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
        <span className="room-card-id">{displayLabel}</span>
        <span className="room-card-date">{formatDate(room.createdAt)}</span>
      </div>
      <div className="room-card-badges">
        {keysBurned && (
          <span className="room-card-badge room-card-badge--keys-burned">
            <KeyRound size={12} strokeWidth={2} aria-hidden="true" />
            {t('room.list.keysBurnedBadge')}
          </span>
        )}
        <span className={`room-card-badge ${isOwner ? 'room-card-badge--owner' : 'room-card-badge--member'}`}>
          {roleLabel}
        </span>
      </div>
    </button>
  );
}
