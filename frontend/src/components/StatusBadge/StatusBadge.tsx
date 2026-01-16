import './StatusBadge.css';

type StatusType = 'online' | 'offline' | 'connecting' | 'error';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  size?: 'sm' | 'md';
}

/**
 * Connection status indicator badge
 */
export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const statusLabel = label || getDefaultLabel(status);

  return (
    <div className={`status-badge status-badge--${status} status-badge--${size}`}>
      <span className="status-badge-dot" />
      <span className="status-badge-label">{statusLabel}</span>
    </div>
  );
}

function getDefaultLabel(status: StatusType): string {
  switch (status) {
    case 'online':
      return 'Connected';
    case 'offline':
      return 'Disconnected';
    case 'connecting':
      return 'Connecting...';
    case 'error':
      return 'Error';
  }
}


