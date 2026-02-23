import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { Input } from '../Input';
import type { JoinRoomStatus, JoinRoomErrorCode } from '../../hooks/useJoinRoom';
import type { RoomJoinMode } from '../../types';
import './JoinRoomView.css';

interface JoinRoomViewProps {
  /** The invite token extracted from startapp parameter. */
  token: string;
  /** Current join flow status driven by the parent (useJoinRoom). */
  status: JoinRoomStatus;
  /** Join mode resolved from the server; null while loading. */
  joinMode: RoomJoinMode | null;
  /** Error code from the server or crypto layer. */
  error?: JoinRoomErrorCode | string | null;
  /** Called when the user submits the password form. */
  onSubmit?: (token: string, password: string) => void;
  /** Called when the user presses back / cancel. */
  onCancel?: () => void;
}

/**
 * Screen shown when the app is opened via a Telegram invite deep link.
 *
 * States:
 * - `loading-info` — fetching room metadata (spinner).
 * - `ready` — password form shown; button label depends on joinMode.
 * - `submitting` — request in flight (loading button).
 * - `pending` — BY_REQUEST: waiting for owner approval.
 * - `approved` — user joined; parent navigates away.
 * - `rejected` — owner declined the request.
 * - `error` — validation or network error.
 *
 * All strings via react-i18next (`room.join.*`).
 */
export function JoinRoomView({
  token,
  status,
  joinMode,
  error,
  onSubmit,
  onCancel,
}: JoinRoomViewProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');

  // Reset password when token changes (new invite link)
  useEffect(() => {
    setPassword('');
  }, [token]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (status === 'submitting' || status === 'loading-info' || !password) return;
      onSubmit?.(token, password);
    },
    [status, password, token, onSubmit]
  );

  const isLoading = status === 'loading-info' || status === 'submitting';
  const isExpiredToken =
    error === 'INVALID_TOKEN' ||
    (typeof error === 'string' && (error.includes('expired') || error.includes('INVALID_TOKEN')));

  // ----------------------------------------
  // Pending state: waiting for owner approval
  // ----------------------------------------
  if (status === 'pending') {
    return (
      <div className="join-room-view">
        <div className="join-room-view__header">
          <div className="join-room-view__icon" aria-hidden="true">⏳</div>
          <h2 className="join-room-view__title">{t('room.join.title')}</h2>
          <p className="join-room-view__subtitle join-room-view__subtitle--pending">
            {t('room.join.requestSent')}
          </p>
        </div>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} fullWidth>
            {t('common.back')}
          </Button>
        )}
      </div>
    );
  }

  // ----------------------------------------
  // Rejected state
  // ----------------------------------------
  if (status === 'rejected') {
    return (
      <div className="join-room-view">
        <div className="join-room-view__header">
          <div className="join-room-view__icon" aria-hidden="true">❌</div>
          <h2 className="join-room-view__title">{t('room.join.title')}</h2>
          <p className="join-room-view__error join-room-view__error--expired" role="alert">
            {t('room.join.errorRejected')}
          </p>
        </div>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} fullWidth>
            {t('common.back')}
          </Button>
        )}
      </div>
    );
  }

  // ----------------------------------------
  // Error state: expired / invalid token
  // ----------------------------------------
  if (isExpiredToken) {
    return (
      <div className="join-room-view">
        <div className="join-room-view__header">
          <div className="join-room-view__icon" aria-hidden="true">🔑</div>
          <h2 className="join-room-view__title">{t('room.join.title')}</h2>
          <p className="join-room-view__error join-room-view__error--expired" role="alert">
            {t('room.join.errorExpiredToken')}
          </p>
        </div>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} fullWidth>
            {t('common.back')}
          </Button>
        )}
      </div>
    );
  }

  // ----------------------------------------
  // Loading state: fetching invite info
  // ----------------------------------------
  if (status === 'loading-info') {
    return (
      <div className="join-room-view">
        <div className="join-room-view__header">
          <div className="join-room-view__icon" aria-hidden="true">🔑</div>
          <h2 className="join-room-view__title">{t('room.join.title')}</h2>
          <p className="join-room-view__subtitle">{t('common.loading')}</p>
        </div>
        <div className="join-room-view__token" title={token}>
          invite_{token.slice(0, 12)}…
        </div>
      </div>
    );
  }

  // ----------------------------------------
  // Main form: ready / submitting / error
  // ----------------------------------------
  const errorMessage = mapErrorMessage(error, t);
  const isRequest = joinMode === 'BY_REQUEST';

  return (
    <div className="join-room-view">
      <div className="join-room-view__header">
        <div className="join-room-view__icon" aria-hidden="true">🔑</div>
        <h2 className="join-room-view__title">{t('room.join.title')}</h2>
        <p className="join-room-view__subtitle">{t('room.join.subtitle')}</p>
      </div>

      <div className="join-room-view__token" title={token}>
        invite_{token.slice(0, 12)}…
      </div>

      <form className="join-room-view__form" onSubmit={handleSubmit} noValidate>
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
          <Button
            type="submit"
            isLoading={isLoading}
            fullWidth
            disabled={!password}
          >
            {isRequest ? t('room.join.requestButton') : t('room.join.joinButton')}
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
    case 'ROOM_NOT_FOUND':
      return null; // shown as full-screen state above
    case 'WRONG_PASSWORD':
      return t('room.join.errorInvalidPassword');
    case 'ALREADY_MEMBER':
      return t('room.join.errorAlreadyMember');
    case 'REQUEST_PENDING':
      return t('room.join.errorRequestPending');
    case 'NETWORK_ERROR':
    case 'CONNECTION_ERROR':
    case 'CRYPTO_ERROR':
      return t('room.join.errorNetwork');
    default:
      return t('room.join.errorNetwork');
  }
}
