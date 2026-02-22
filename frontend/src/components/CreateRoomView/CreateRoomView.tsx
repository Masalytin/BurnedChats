import { useState, useCallback, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { Input } from '../Input';
import { validatePassword } from '../../crypto/kdf';
import type { RoomJoinMode } from '../../hooks/useCreateRoom';
import './CreateRoomView.css';

interface CreateRoomViewProps {
  /** Whether the form is submitting (KDF + STOMP in progress) */
  isLoading?: boolean;
  /** Error code from the server or crypto layer */
  error?: string | null;
  /** Called when the user submits the form */
  onSubmit: (password: string, joinMode: RoomJoinMode) => void;
  /** Called when the user cancels */
  onCancel?: () => void;
  /** CSS class override */
  className?: string;
}

/**
 * Form for creating a new room.
 *
 * - Password + confirmation fields
 * - Join mode selection (BY_PASSWORD / BY_REQUEST)
 * - Client-side password validation before calling onSubmit
 * - All UI strings via react-i18next (room.create.*)
 */
export function CreateRoomView({
  isLoading = false,
  error,
  onSubmit,
  onCancel,
  className = '',
}: CreateRoomViewProps) {
  const { t } = useTranslation();

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [joinMode, setJoinMode] = useState<RoomJoinMode>('BY_PASSWORD');
  const [validationError, setValidationError] = useState<string | null>(null);

  const validate = useCallback((): boolean => {
    const pwdError = validatePassword(password);
    if (pwdError) {
      setValidationError(t(pwdError));
      return false;
    }
    if (password !== passwordConfirm) {
      setValidationError(t('room.create.passwordMismatch'));
      return false;
    }
    setValidationError(null);
    return true;
  }, [password, passwordConfirm, t]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (isLoading) return;
      if (!validate()) return;
      onSubmit(password, joinMode);
    },
    [isLoading, validate, onSubmit, password, joinMode]
  );

  const displayError = validationError ?? (error ? t(`room.create.${mapErrorCode(error)}`) : null);

  return (
    <div className={`create-room-view ${className}`}>
      <div className="create-room-view__header">
        <div className="create-room-view__icon" aria-hidden="true">
          🔐
        </div>
        <h2 className="create-room-view__title">{t('room.create.title')}</h2>
      </div>

      <form className="create-room-view__form" onSubmit={handleSubmit} noValidate>
        {/* Password */}
        <Input
          type="password"
          label={t('room.create.passwordLabel')}
          placeholder={t('room.create.passwordPlaceholder')}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setValidationError(null);
          }}
          disabled={isLoading}
          autoComplete="new-password"
        />

        {/* Confirm Password */}
        <Input
          type="password"
          label={t('room.create.passwordConfirmLabel')}
          placeholder={t('room.create.passwordConfirmPlaceholder')}
          value={passwordConfirm}
          onChange={(e) => {
            setPasswordConfirm(e.target.value);
            setValidationError(null);
          }}
          disabled={isLoading}
          autoComplete="new-password"
        />

        {/* Join mode */}
        <fieldset className="create-room-view__fieldset">
          <legend className="create-room-view__fieldset-legend">
            {t('room.create.joinModeLabel')}
          </legend>

          <label className="create-room-view__radio-label">
            <input
              type="radio"
              name="joinMode"
              value="BY_PASSWORD"
              checked={joinMode === 'BY_PASSWORD'}
              onChange={() => setJoinMode('BY_PASSWORD')}
              disabled={isLoading}
              className="create-room-view__radio"
            />
            <span className="create-room-view__radio-text">
              {t('room.create.joinModePassword')}
            </span>
          </label>

          <label className="create-room-view__radio-label">
            <input
              type="radio"
              name="joinMode"
              value="BY_REQUEST"
              checked={joinMode === 'BY_REQUEST'}
              onChange={() => setJoinMode('BY_REQUEST')}
              disabled={isLoading}
              className="create-room-view__radio"
            />
            <span className="create-room-view__radio-text">
              {t('room.create.joinModeRequest')}
            </span>
          </label>
        </fieldset>

        {/* Error */}
        {displayError && (
          <p className="create-room-view__error" role="alert">
            {displayError}
          </p>
        )}

        {/* Actions */}
        <div className="create-room-view__actions">
          {onCancel && (
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={isLoading}
            >
              {t('common.cancel')}
            </Button>
          )}
          <Button
            type="submit"
            isLoading={isLoading}
            fullWidth={!onCancel}
          >
            {t('room.create.submitButton')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function mapErrorCode(code: string): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'errorWeak';
    case 'RATE_LIMITED':
      return 'errorNetwork';
    case 'CRYPTO_ERROR':
    case 'INTERNAL_ERROR':
    case 'CONNECTION_ERROR':
    default:
      return 'errorNetwork';
  }
}
