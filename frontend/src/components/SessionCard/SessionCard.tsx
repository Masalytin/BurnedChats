import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ActiveSession } from '../../hooks/useActiveSessions';
import { usePresence } from '../../hooks/usePresence';
import { Avatar } from '../Avatar';
import { FlameIcon, ShieldIcon, ShieldCheckIcon } from '../../icons';
import './SessionCard.css';

interface SessionCardProps {
  /** Session data */
  session: ActiveSession;
  /** Click handler */
  onClick?: () => void;
  /** Burn session handler (4.6.11) */
  onBurn?: (sessionId: string, peerName: string) => void;
  /** Whether the card is currently selected */
  isSelected?: boolean;
  /** Whether action is in progress (e.g., resuming) */
  isLoading?: boolean;
  /** Whether burn is in progress for this session */
  isBurning?: boolean;
}

/**
 * Card component displaying an active session (4.6.6).
 *
 * Shows peer info, session status, online indicator, and verification status.
 */
export function SessionCard({ 
  session, 
  onClick, 
  onBurn,
  isSelected = false,
  isLoading = false,
  isBurning = false,
}: SessionCardProps) {
  const { t } = useTranslation();
  const { peer, status, verified, peerVerified, lastActivityAt } = session;
  const peerPresence = usePresence(peer.internalId, { online: peer.online });
  
  const isActive = status === 'ACTIVE';
  const isHandshaking = status === 'HANDSHAKE';
  const isPending = status === 'PENDING';
  const canBurn = (isActive || isHandshaking || isPending) && Boolean(onBurn);
  const bothVerified = verified && peerVerified;
  
  const statusLabel = getStatusLabel(status, t);
  const timeAgo = getTimeAgo(lastActivityAt);

  /**
   * Handle burn button click (4.6.11).
   * Stops propagation to prevent card click handler.
   */
  const handleBurnClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onBurn && !isBurning && !isLoading) {
      onBurn(session.sessionId, peer.displayName);
    }
  };

  return (
    <button
      className={`session-card ${isSelected ? 'session-card--selected' : ''} ${isLoading ? 'session-card--loading' : ''}`}
      onClick={onClick}
      disabled={isLoading || isBurning}
      type="button"
    >
      {/* Avatar with online/offline indicator (4.6.10) */}
      <div className="session-card-avatar">
        <Avatar 
          src={peer.photoUrl} 
          name={peer.displayName} 
          size="md"
        />
        <span 
          className={`session-card-presence ${peerPresence.online ? 'session-card-presence--online' : 'session-card-presence--offline'}`}
          title={peerPresence.online ? t('status.online') : t('status.offline')}
        />
      </div>
      
      <div className="session-card-content">
        <div className="session-card-header">
          <span className="session-card-name">{peer.displayName}</span>
          {peer.premium && (
            <span className="session-card-premium" aria-label={t('sessionCard.premium', { defaultValue: 'Premium' })}>
              <Star size={14} fill="currentColor" aria-hidden="true" />
            </span>
          )}
          {/* Online text indicator (4.6.10) */}
          {peerPresence.online && <span className="session-card-online-text">{t('sessionCard.online')}</span>}
        </div>
        
        {peer.username && (
          <span className="session-card-username">@{peer.username}</span>
        )}
        
        <div className="session-card-meta">
          <span className={`session-card-status session-card-status--${status.toLowerCase()}`}>
            {isHandshaking && <span className="session-card-status-dot" />}
            {statusLabel}
          </span>
          <span className="session-card-time">{timeAgo}</span>
        </div>
      </div>
      
      <div className="session-card-actions">
        {/* Verification status */}
        {isActive && (
          <div className={`session-card-verified ${bothVerified ? 'session-card-verified--both' : ''}`}>
            {bothVerified ? (
              <ShieldCheckIcon size={18} />
            ) : (
              <ShieldIcon size={18} />
            )}
          </div>
        )}
        
        {/* Burn/Cancel for ACTIVE, HANDSHAKE, and PENDING (IMP-DMPEND-02) */}
        {canBurn && (
          <div 
            className={`session-card-burn-btn ${isBurning ? 'session-card-burn-btn--loading' : ''}`}
            onClick={handleBurnClick}
            role="button"
            tabIndex={0}
            aria-label={isPending ? t('sessionCard.cancelPending') : t('chat.burnSessionAria')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleBurnClick(e as unknown as React.MouseEvent);
              }
            }}
          >
            {isBurning ? (
              <div className="session-card-burn-spinner" />
            ) : (
              <FlameIcon size={16} />
            )}
          </div>
        )}
        
        {/* Burn indicator when no handler (display only) */}
        {isActive && !onBurn && (
          <div className="session-card-burn-indicator">
            <FlameIcon size={16} />
          </div>
        )}
        
        {/* Loading spinner */}
        {isLoading && (
          <div className="session-card-spinner" />
        )}
      </div>
    </button>
  );
}

/**
 * Get human-readable status label
 */
function getStatusLabel(status: ActiveSession['status'], t: (key: string) => string): string {
  switch (status) {
    case 'PENDING':
      return t('sessionCard.statusPending');
    case 'HANDSHAKE':
      return t('sessionCard.statusHandshake');
    case 'ACTIVE':
      return t('sessionCard.statusActive');
    case 'EXPIRED':
      return t('sessionCard.statusExpired');
    case 'BURNED':
      return t('sessionCard.statusBurned');
    default:
      return status;
  }
}

/**
 * Get relative time string (e.g., "2m ago", "1h ago")
 */
function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return 'Just now';
}
