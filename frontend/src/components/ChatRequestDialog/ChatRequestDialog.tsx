import { useState, useCallback, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserInfo } from '../../types';
import type { PowPhase } from '../../hooks/usePow';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Input } from '../Input';
import { PowProgress } from '../Pow/PowProgress';
import { StatusBadge } from '../StatusBadge';
import { CloseIcon, LockIcon, SendIcon } from '../../icons';
import './ChatRequestDialog.css';

const MAX_SECRET_LENGTH = 256;

const POW_ERROR_CODES = new Set(['POW_INVALID', 'POW_FAILED']);

export interface ChatRequestSecretPayload {
  secretQuestion: string;
  secretExpectedAnswer: string;
}

interface ChatRequestDialogProps {
  /** User to start chat with */
  user: UserInfo;
  /** Whether request is being sent */
  isLoading?: boolean;
  /** Error code to display */
  error?: string | null;
  /** Localized error message when available */
  errorMessage?: string | null;
  /** Current PoW phase during session creation */
  powPhase?: PowPhase;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when request is submitted */
  onSubmit: (secret?: ChatRequestSecretPayload) => void;
  /** Additional CSS class */
  className?: string;
}

/**
 * Dialog for creating a chat request.
 *
 * Features:
 * - Shows recipient user info
 * - Optional secret question + expected answer (initiator verification)
 * - Loading state while sending
 * - Error display
 */
export function ChatRequestDialog({
  user,
  isLoading = false,
  error,
  errorMessage,
  powPhase = 'idle',
  onClose,
  onSubmit,
  className = '',
}: ChatRequestDialogProps) {
  const { t } = useTranslation();
  const [secretQuestion, setSecretQuestion] = useState('');
  const [secretExpectedAnswer, setSecretExpectedAnswer] = useState('');
  const [showSecretQuestion, setShowSecretQuestion] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ question: false, answer: false });

  const getSessionErrorMessage = useCallback(
    (code: string): string => {
      const key = `chatRequest.errors.${code}` as const;
      const message = t(key);
      return message !== key ? message : t('chatRequest.errors.DEFAULT');
    },
    [t]
  );

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      if (isLoading) return;

      if (!showSecretQuestion) {
        onSubmit();
        return;
      }

      const q = secretQuestion.trim();
      const a = secretExpectedAnswer.trim();
      if (!q || !a) {
        setFieldErrors({ question: !q, answer: !a });
        return;
      }

      setFieldErrors({ question: false, answer: false });
      onSubmit({ secretQuestion: q, secretExpectedAnswer: a });
    },
    [isLoading, onSubmit, showSecretQuestion, secretQuestion, secretExpectedAnswer]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const toggleSecretQuestion = useCallback(() => {
    setShowSecretQuestion((show) => {
      if (show) {
        setSecretQuestion('');
        setSecretExpectedAnswer('');
        setFieldErrors({ question: false, answer: false });
      }
      return !show;
    });
  }, []);

  const secretInvalid =
    showSecretQuestion && (!secretQuestion.trim() || !secretExpectedAnswer.trim());

  const isPowError = Boolean(error && POW_ERROR_CODES.has(error));
  const showPowProgress = isPowError || powPhase === 'requesting' || powPhase === 'solving' || powPhase === 'error';

  const handlePowRetry = useCallback(() => {
    handleSubmit();
  }, [handleSubmit]);

  useEffect(() => {
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className={`chat-request-dialog-overlay ${className}`} onClick={onClose}>
      <div
        className="chat-request-dialog animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="dialog-title"
        aria-modal="true"
      >
        <button
          type="button"
          className="chat-request-dialog__close"
          onClick={onClose}
          aria-label={t('aria.closeDialog')}
        >
          <CloseIcon size={20} />
        </button>

        <div className="chat-request-dialog__header">
          <div className="chat-request-dialog__icon">
            <LockIcon size={24} />
          </div>
          <h2 id="dialog-title" className="chat-request-dialog__title">
            {t('chatRequest.title')}
          </h2>
          <p className="chat-request-dialog__subtitle">{t('chatRequest.subtitle')}</p>
        </div>

        <div className="chat-request-dialog__user">
          <Avatar src={user.photoUrl} name={user.displayName} size="lg" />
          <div className="chat-request-dialog__user-info">
            <div className="chat-request-dialog__user-header">
              <h3 className="chat-request-dialog__user-name">
                {user.displayName}
                {user.premium && (
                  <span className="chat-request-dialog__premium" title={t('chat.premiumTitle')}>
                    &#11088;
                  </span>
                )}
              </h3>
              <StatusBadge status={user.online ? 'online' : 'offline'} size="sm" />
            </div>
            {user.username && (
              <p className="chat-request-dialog__user-username">@{user.username}</p>
            )}
          </div>
        </div>

        <form className="chat-request-dialog__form" onSubmit={handleSubmit}>
          <div className="chat-request-dialog__option">
            <button
              type="button"
              className={`chat-request-dialog__option-toggle ${showSecretQuestion ? 'chat-request-dialog__option-toggle--active' : ''}`}
              onClick={toggleSecretQuestion}
              disabled={isLoading}
            >
              <span className="chat-request-dialog__option-checkbox">
                {showSecretQuestion && <CheckMark />}
              </span>
              <span className="chat-request-dialog__option-label">{t('chatRequest.secretToggle')}</span>
            </button>
            <p className="chat-request-dialog__option-hint">
              {t('chatRequest.secretHint', { max: MAX_SECRET_LENGTH })}
            </p>
          </div>

          {showSecretQuestion && (
            <div className="chat-request-dialog__secret-question animate-slide-up">
              <div className="chat-request-dialog__secret-fields">
                <Input
                  label={t('chatRequest.secretQuestionLabel')}
                  placeholder={t('chatRequest.secretQuestionPlaceholder')}
                  value={secretQuestion}
                  onChange={(e) => {
                    setSecretQuestion(e.target.value);
                    setFieldErrors((f) => ({ ...f, question: false }));
                  }}
                  onKeyDown={handleKeyDown}
                  maxLength={MAX_SECRET_LENGTH}
                  disabled={isLoading}
                  hint={t('chatRequest.charCount', { count: secretQuestion.length, max: MAX_SECRET_LENGTH })}
                  error={fieldErrors.question ? t('chatRequest.validation.questionRequired') : undefined}
                  autoFocus
                />
                <Input
                  label={t('chatRequest.expectedAnswerLabel')}
                  placeholder={t('chatRequest.expectedAnswerPlaceholder')}
                  value={secretExpectedAnswer}
                  onChange={(e) => {
                    setSecretExpectedAnswer(e.target.value);
                    setFieldErrors((f) => ({ ...f, answer: false }));
                  }}
                  onKeyDown={handleKeyDown}
                  maxLength={MAX_SECRET_LENGTH}
                  disabled={isLoading}
                  hint={t('chatRequest.expectedAnswerHint')}
                  error={fieldErrors.answer ? t('chatRequest.validation.answerRequired') : undefined}
                />
              </div>
            </div>
          )}

          {showPowProgress && (
            <PowProgress
              phase={powPhase}
              failed={isPowError}
              errorMessage={errorMessage}
              onRetry={isPowError && !isLoading ? handlePowRetry : undefined}
            />
          )}

          {error && !isPowError && (
            <div className="chat-request-dialog__error animate-fade-in">
              {errorMessage ?? getSessionErrorMessage(error)}
            </div>
          )}

          <div className="chat-request-dialog__actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              isLoading={isLoading}
              disabled={isLoading || secretInvalid}
              rightIcon={<SendIcon size={18} />}
            >
              {t('chatRequest.sendButton')}
            </Button>
          </div>
        </form>

        <div className="chat-request-dialog__note">
          <LockIcon size={14} />
          <span>{t('chatRequest.securityNote')}</span>
        </div>
      </div>
    </div>
  );
}

function CheckMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
