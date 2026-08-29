import { useState, useCallback, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { Input } from '../Input';
import { HelpSheet, HelpTrigger } from '../HelpSheet';
import { useToast } from '../Toast/ToastContext';
import { validatePassword } from '../../crypto/kdf';
import { Lock } from 'lucide-react';
import { EyeIcon, EyeOffIcon, SparklesIcon } from '../../icons';
import type { RoomJoinMode } from '../../hooks/useCreateRoom';
import { loadOnboardingProgress, markOnboardingSeen } from '../../onboarding/onboardingProgress';
import './CreateRoomView.css';

interface CreateRoomViewProps {
  /** Whether the form is submitting (KDF + STOMP in progress) */
  isLoading?: boolean;
  /** Error code from the server or crypto layer */
  error?: string | null;
  /** Called when the user submits the form. When joinMode is BY_REQUEST, password may be null (room without password). */
  onSubmit: (password: string | null, joinMode: RoomJoinMode, roomName?: string) => void;
  /** Called when the user cancels */
  onCancel?: () => void;
  /** CSS class override */
  className?: string;
  /** HelpSheet open — App Back must no-op while true (WalletSheet exclusive-Back). */
  onHelpOpenChange?: (open: boolean) => void;
}

/**
 * Form for creating a new room.
 *
 * - Password + confirmation fields
 * - Join mode selection (BY_PASSWORD / BY_REQUEST)
 * - Client-side password validation before calling onSubmit
 * - All UI strings via react-i18next (room.create.*)
 */
function generateSecurePassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#$%^&*';
  const all = upper + lower + digits + special;

  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = Array.from(bytes).map((b) => all[b % all.length]);

  // Ensure at least one char from each required category
  const guaranteed = [
    upper[crypto.getRandomValues(new Uint8Array(1))[0] % upper.length],
    lower[crypto.getRandomValues(new Uint8Array(1))[0] % lower.length],
    digits[crypto.getRandomValues(new Uint8Array(1))[0] % digits.length],
    special[crypto.getRandomValues(new Uint8Array(1))[0] % special.length],
  ];

  // Splice guaranteed chars into random positions in the first 4 slots
  guaranteed.forEach((ch, i) => { chars[i] = ch; });

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint8Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

export function CreateRoomView({
  isLoading = false,
  error,
  onSubmit,
  onCancel,
  className = '',
  onHelpOpenChange,
}: CreateRoomViewProps) {
  const { t } = useTranslation();
  const toast = useToast();

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [roomName, setRoomName] = useState('');
  const [joinMode, setJoinMode] = useState<RoomJoinMode>('BY_PASSWORD');
  const [noPassword, setNoPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [helpOpen, setHelpOpen] = useState(
    () => loadOnboardingProgress().seen.createRoomHint !== true,
  );

  useEffect(() => {
    onHelpOpenChange?.(helpOpen);
  }, [helpOpen, onHelpOpenChange]);

  const handleHelpClose = useCallback(() => {
    setHelpOpen(false);
    markOnboardingSeen('createRoomHint');
  }, []);

  const handleGeneratePassword = useCallback(async () => {
    const generated = generateSecurePassword();
    setPassword(generated);
    setPasswordConfirm(generated);
    setShowPassword(true);
    setShowConfirm(true);
    setValidationError(null);

    try {
      await navigator.clipboard.writeText(generated);
      toast.success(t('room.create.passwordGenerated'));
    } catch {
      toast.info(t('room.create.passwordGeneratedNoCopy'));
    }
  }, [t, toast]);

  const validate = useCallback((): boolean => {
    if (joinMode === 'BY_REQUEST' && noPassword) {
      setValidationError(null);
      return true;
    }
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
  }, [joinMode, noPassword, password, passwordConfirm, t]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (isLoading) return;
      if (!validate()) return;
      const submitPassword = joinMode === 'BY_REQUEST' && noPassword ? null : password;
      const trimmedName = roomName.trim();
      onSubmit(submitPassword, joinMode, trimmedName || undefined);
    },
    [isLoading, validate, onSubmit, joinMode, noPassword, password, roomName]
  );

  const displayError = validationError ?? (error ? t(`room.create.${mapErrorCode(error)}`) : null);

  return (
    <div className={`create-room-view ${className}`}>
      <div className="create-room-view__header">
        <div className="create-room-view__icon" aria-hidden="true">
          <Lock size={36} strokeWidth={1.75} />
        </div>
        <div className="create-room-view__title-row">
          <h2 className="create-room-view__title">{t('room.create.title')}</h2>
          <HelpTrigger onOpen={() => setHelpOpen(true)} />
        </div>
      </div>

      <form className="create-room-view__form" onSubmit={handleSubmit} noValidate>
        <Input
          type="text"
          label={t('room.create.nameLabel')}
          placeholder={t('room.create.namePlaceholder')}
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          disabled={isLoading}
          autoComplete="off"
          maxLength={64}
        />

        {/* Join mode first so "no password" option is contextual */}
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
              onChange={() => { setJoinMode('BY_PASSWORD'); setNoPassword(false); }}
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

          {joinMode === 'BY_REQUEST' && (
            <label className="create-room-view__radio-label create-room-view__checkbox-label">
              <input
                type="checkbox"
                checked={noPassword}
                onChange={(e) => setNoPassword(e.target.checked)}
                disabled={isLoading}
                className="create-room-view__radio"
              />
              <span className="create-room-view__radio-text">
                {t('room.create.noPasswordOption')}
              </span>
            </label>
          )}
        </fieldset>

        {/* Password fields — hidden when BY_REQUEST and no password */}
        {!(joinMode === 'BY_REQUEST' && noPassword) && (
          <>
            <Input
              type={showPassword ? 'text' : 'password'}
              label={t('room.create.passwordLabel')}
              placeholder={t('room.create.passwordPlaceholder')}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setValidationError(null);
              }}
              disabled={isLoading}
              autoComplete="new-password"
              rightIcon={
                <button
                  type="button"
                  className="input-icon-btn"
                  aria-label={showPassword ? t('common.hidePassword') : t('common.showPassword')}
                  onPointerDown={(e) => { e.preventDefault(); setShowPassword((v) => !v); }}
                  disabled={isLoading}
                >
                  {showPassword ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
                </button>
              }
            />

            <Input
              type={showConfirm ? 'text' : 'password'}
              label={t('room.create.passwordConfirmLabel')}
              placeholder={t('room.create.passwordConfirmPlaceholder')}
              value={passwordConfirm}
              onChange={(e) => {
                setPasswordConfirm(e.target.value);
                setValidationError(null);
              }}
              disabled={isLoading}
              autoComplete="new-password"
              rightIcon={
                <button
                  type="button"
                  className="input-icon-btn"
                  aria-label={showConfirm ? t('common.hidePassword') : t('common.showPassword')}
                  onPointerDown={(e) => { e.preventDefault(); setShowConfirm((v) => !v); }}
                  disabled={isLoading}
                >
                  {showConfirm ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
                </button>
              }
            />

            <button
              type="button"
              className="create-room-view__generate-btn"
              onClick={handleGeneratePassword}
              disabled={isLoading}
            >
              <SparklesIcon size={16} />
              {t('room.create.generatePassword')}
            </button>
          </>
        )}

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

      <HelpSheet
        open={helpOpen}
        onClose={handleHelpClose}
        topicKey="rooms.create"
      />
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
