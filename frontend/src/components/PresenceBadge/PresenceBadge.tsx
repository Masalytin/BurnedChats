import { useTranslation } from 'react-i18next';
import { usePresence } from '../../hooks/usePresence';
import { formatPresenceRelativeTime } from '../../presence/formatPresenceRelativeTime';
import './PresenceBadge.css';

interface PresenceBadgeProps {
  internalId: string;
  snapshotOnline?: boolean;
  snapshotLastSeen?: number;
  /** Search / dialog: do not stale-flip the snapshot. */
  live?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function PresenceBadge({
  internalId,
  snapshotOnline,
  snapshotLastSeen,
  live = true,
  size = 'sm',
  className = '',
}: PresenceBadgeProps) {
  const { t } = useTranslation();
  const presence = usePresence(
    internalId,
    { online: snapshotOnline, lastSeen: snapshotLastSeen },
    { live },
  );

  const status = presence.online ? 'online' : 'offline';
  const label = presence.online
    ? t('status.online')
    : presence.lastSeen != null
      ? t('status.lastSeen', { time: formatPresenceRelativeTime(presence.lastSeen, t) })
      : t('status.offline');

  return (
    <div
      className={`presence-badge presence-badge--${status} presence-badge--${size} ${className}`.trim()}
      title={label}
    >
      <span className="presence-badge-dot" />
      <span className="presence-badge-label">{label}</span>
    </div>
  );
}
