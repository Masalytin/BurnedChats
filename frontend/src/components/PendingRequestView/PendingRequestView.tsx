import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { PendingSession } from '../../hooks/useSession';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Card, CardContent } from '../Card';
import { StatusBadge } from '../StatusBadge';
import { LoaderIcon, CloseIcon } from '../../icons';
import './PendingRequestView.css';

interface PendingRequestViewProps {
  /** The pending session data */
  session: PendingSession;
  /** Callback when user cancels the request */
  onCancel: () => void;
  /** Callback when request expires (5.1.3) */
  onExpire?: () => void;
  /** Additional CSS class */
  className?: string;
}

/**
 * Waiting UI while a chat request is pending acceptance.
 *
 * Features:
 * - Shows recipient info
 * - Countdown timer to expiration
 * - Animated waiting indicator
 * - Cancel button
 */
export function PendingRequestView({
  session,
  onCancel,
  onExpire,
  className = '',
}: PendingRequestViewProps) {
  const { t } = useTranslation();
  const { recipient, hasSecretQuestion, expiresAt } = session;

  // Calculate remaining time
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  );
  
  // Track if expiration callback was called
  const [expireCalled, setExpireCalled] = useState(false);

  // Update countdown every second
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setRemainingSeconds(remaining);

      if (remaining === 0) {
        clearInterval(interval);
        // Call onExpire callback when timer reaches 0 (5.1.3)
        if (!expireCalled && onExpire) {
          setExpireCalled(true);
          onExpire();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, expireCalled, onExpire]);

  // Format remaining time as MM:SS
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const isExpired = remainingSeconds === 0;
  const isLowTime = remainingSeconds > 0 && remainingSeconds <= 60;

  return (
    <div className={`pending-request-view ${className}`}>
      <div className="pending-request-view__content animate-slide-up">
        {/* Waiting animation */}
        <div className="pending-request-view__animation">
          <div className="pending-request-view__pulse-ring" />
          <div className="pending-request-view__pulse-ring pending-request-view__pulse-ring--delayed" />
          <div className="pending-request-view__icon-container">
            <LoaderIcon className="pending-request-view__spinner" size={32} />
          </div>
        </div>

        {/* Status text */}
        <div className="pending-request-view__status">
          <h2 className="pending-request-view__title">
            {t('pendingRequest.title')}
          </h2>
          <p className="pending-request-view__subtitle">
            {isExpired
              ? 'Your chat request has expired. Please try again.'
              : 'Your secure chat request has been sent'}
          </p>
        </div>

        {/* User card */}
        <Card className="pending-request-view__user-card">
          <CardContent>
            <div className="pending-request-view__user">
              <Avatar
                src={recipient.photoUrl}
                name={recipient.displayName}
                size="lg"
              />
              <div className="pending-request-view__user-info">
                <div className="pending-request-view__user-header">
                  <h3 className="pending-request-view__user-name">
                    {recipient.displayName}
                    {recipient.premium && (
                      <span className="pending-request-view__premium" title={t('common.premium')}>
                        &#11088;
                      </span>
                    )}
                  </h3>
                  <StatusBadge
                    status={recipient.online ? 'online' : 'offline'}
                    size="sm"
                  />
                </div>
                {recipient.username && (
                  <p className="pending-request-view__user-username">
                    @{recipient.username}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Timer */}
        {!isExpired && (
          <div className={`pending-request-view__timer ${isLowTime ? 'pending-request-view__timer--low' : ''}`}>
            <ClockIcon size={16} />
            <span>{t('incomingRequest.expiresIn', { time: formatTime(remainingSeconds) })}</span>
          </div>
        )}

        {/* Secret question indicator */}
        {hasSecretQuestion && !isExpired && (
          <div className="pending-request-view__info">
            <span className="pending-request-view__info-icon">?</span>
            <span>{t('pendingRequest.secretQuestionHint')}</span>
          </div>
        )}

        {/* Notification sent indicator */}
        {!recipient.online && !isExpired && (
          <div className="pending-request-view__info pending-request-view__info--notification">
            <span className="pending-request-view__info-icon">&#128276;</span>
            <span>{t('pendingRequest.notificationSent')}</span>
          </div>
        )}

        {/* Actions */}
        <div className="pending-request-view__actions">
          <Button
            variant={isExpired ? 'primary' : 'secondary'}
            onClick={onCancel}
            leftIcon={isExpired ? undefined : <CloseIcon size={18} />}
            fullWidth
          >
            {isExpired ? t('common.back') : t('pendingRequest.cancelButton')}
          </Button>
        </div>

        {/* Help text */}
        <p className="pending-request-view__help">
          {isExpired
            ? 'The request expires after 5 minutes for security.'
            : 'The recipient will be notified about your request.'}
        </p>
      </div>
    </div>
  );
}

/**
 * Clock icon
 */
function ClockIcon({ size = 24, ...props }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
