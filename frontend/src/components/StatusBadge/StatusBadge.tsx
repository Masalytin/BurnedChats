import { useTranslation } from 'react-i18next';
import './StatusBadge.css';

type StatusType = 'online' | 'offline' | 'connecting' | 'error';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  size?: 'sm' | 'md';
}

const BADGE_KEYS: Record<StatusType, string> = {
  online: 'status.badge.connected',
  offline: 'status.badge.disconnected',
  connecting: 'status.badge.connecting',
  error: 'status.badge.error',
};

/**
 * Connection status indicator badge
 */
export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const { t } = useTranslation();
  const statusLabel = label || t(BADGE_KEYS[status]);

  return (
    <div className={`status-badge status-badge--${status} status-badge--${size}`}>
      <span className="status-badge-dot" />
      <span className="status-badge-label">{statusLabel}</span>
    </div>
  );
}
