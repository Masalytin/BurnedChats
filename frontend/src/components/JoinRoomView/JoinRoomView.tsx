import { useState, useCallback, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { Input } from '../Input';
import './JoinRoomView.css';

export type JoinRoomErrorCode =
  | 'INVALID_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'INVALID_PASSWORD'
  | 'NETWORK_ERROR'
  | 'CONNECTION_ERROR';

interface JoinRoomViewProps {
  /** The invite token extracted from startapp parameter */
  token: string;
  /** Whether a join/request operation is in progress */
  isLoading?: boolean;
  /** Error code from validation or server */
  error?: JoinRoomErrorCode | string | null;
  /**
   * Called when the user submits the password to join directly (BY_PASSWORD mode).
   * For P2-2.2 full implementation — currently shows "coming soon".
   */
  onJoin?: (token: string, password: string) => void;
  /**
   * Called when the user sends a join request (BY_REQUEST mode).
   * For P2-2.2 full implementation — currently shows "coming soon".
   */
  onRequestJoin?: (token: string, password: string) => void;
  /** Called when the user presses back / cancel */
  onCancel?: () => void;
}

/**
 * Screen shown when the app is opened via a Telegram invite deep link.
 *
 * Displays the invite token context, a password field, and two action buttons:
 * - "Join" — for BY_PASSWORD rooms
 * - "Send Request" — for BY_REQUEST rooms
 *
 * The actual join mode is resolved by the server in P2-2.2.
 * Until then, both buttons are shown; the parent decides which handler to wire.
 *
 * All strings via react-i18next (room.join.*).
 */
export function JoinRoomView({
  token,
  isLoading = false,
  error,
  onJoin,
  onRequestJoin,
  onCancel,
}: JoinRoomViewProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');

  const handleJoin = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (isLoading || !password) return;
      onJoin?.(token, password);
    },
    [isLoading, password, token, onJoin]
  );

  const handleRequestJoin = useCallback(() => {
    if (isLoading || !password) return;
    onRequestJoin?.(token, password);
  }, [isLoading, password, token, onRequestJoin]);

  const errorMessage = mapErrorMessage(error, t);

  const isExpiredToken =
    error === 'EXPIRED_TOKEN' ||
    (typeof error === 'string' && error.includes('expired'));

  return (
    <div className="join-room-view">
      <div className="join-room-view__header">
        <div className="join-room-view__icon" aria-hidden="true">
          🔑
        </div>
        <h2 className="join-room-view__title">{t('room.join.title')}</h2>
        <p className="join-room-view__subtitle">{t('room.join.subtitle')}</p>
      </div>

      <div className="join-room-view__token" title={token}>
        invite_{token.slice(0, 12)}…
      </div>

      {isExpiredToken ? (
        <p className="join-room-view__error join-room-view__error--expired" role="alert">
          {t('room.join.errorExpiredToken')}
        </p>
      ) : (
        <form className="join-room-view__form" onSubmit={handleJoin} noValidate>
          <Input
            type="password"
            label={t('room.join.passwordLabel')}
            placeholder={t('room.join.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            autoComplete="current-password"
          />

          {errorMessage && (
            <p className="join-room-view__error" role="alert">
              {errorMessage}
            </p>
          )}

          <div className="join-room-view__actions">
            <Button type="submit" isLoading={isLoading} fullWidth disabled={!password}>
              {t('room.join.joinButton')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              isLoading={isLoading}
              fullWidth
              disabled={!password}
              onClick={handleRequestJoin}
            >
              {t('room.join.requestButton')}
            </Button>
            {onCancel && (
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                disabled={isLoading}
                fullWidth
              >
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </form>
      )}

      {isExpiredToken && onCancel && (
        <Button variant="secondary" onClick={onCancel} fullWidth>
          {t('common.back')}
        </Button>
      )}
    </div>
  );
}

function mapErrorMessage(
  error: JoinRoomErrorCode | string | null | undefined,
  t: (key: string) => string
): string | null {
  if (!error) return null;
  switch (error) {
    case 'INVALID_TOKEN':
      return t('room.join.errorInvalidToken');
    case 'EXPIRED_TOKEN':
      return null;
    case 'INVALID_PASSWORD':
      return t('room.join.errorInvalidPassword');
    case 'NETWORK_ERROR':
    case 'CONNECTION_ERROR':
      return t('room.join.errorNetwork');
    default:
      return t('room.join.errorNetwork');
  }
}
