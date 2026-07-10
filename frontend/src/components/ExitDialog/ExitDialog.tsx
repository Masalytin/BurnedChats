import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertIcon, ArrowLeftIcon, CloseIcon } from '@/icons';
import type { ExitBurnError } from '@/hooks/useExitBurnFlow';
import '@/components/BurnAllDialog/BurnAllDialog.css';
import './ExitDialog.css';

export interface ExitDialogProps {
  open: boolean;
  isBurning?: boolean;
  error?: ExitBurnError | null;
  onClose: () => void;
  onJustExit: () => void;
  onBurnAndExit: () => void;
  onRetryBurnAndExit: () => void;
}

export const ExitDialog = memo(function ExitDialog({
  open,
  isBurning = false,
  error = null,
  onClose,
  onJustExit,
  onBurnAndExit,
  onRetryBurnAndExit,
}: ExitDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBurning) {
        onClose();
      }
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isBurning, onClose, open]);

  if (!open) {
    return null;
  }

  const errorMessage =
    error === 'TIMEOUT'
      ? t('settings.exit.timeoutError')
      : error === 'NOT_CONNECTED'
        ? t('settings.exit.offlineError')
        : error === 'INTERNAL_ERROR'
          ? t('settings.exit.internalError')
          : null;

  return createPortal(
    <div className="burn-all-dialog-overlay" onClick={isBurning ? undefined : onClose}>
      <div
        className="burn-all-dialog exit-dialog animate-slide-up"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-labelledby="exit-dialog-title"
        aria-describedby="exit-dialog-description"
        aria-modal="true"
      >
        <button
          type="button"
          className="burn-all-dialog__close"
          onClick={onClose}
          aria-label={t('common.cancel')}
          disabled={isBurning}
        >
          <CloseIcon size={20} />
        </button>

        <div className="burn-all-dialog__icon exit-dialog__icon">
          <ArrowLeftIcon size={32} />
        </div>

        <h2 id="exit-dialog-title" className="burn-all-dialog__title">
          {t('settings.exit.title')}
        </h2>

        <p id="exit-dialog-description" className="burn-all-dialog__description">
          {t('settings.exit.description')}
        </p>

        {errorMessage ? (
          <div className="burn-all-dialog__warning">
            <AlertIcon size={16} />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        <div className="exit-dialog__actions">
          <button
            type="button"
            className="exit-dialog__button exit-dialog__button--secondary"
            onClick={onJustExit}
            disabled={isBurning}
          >
            {t('settings.exit.justLeave')}
          </button>

          {error ? (
            <button
              type="button"
              className="exit-dialog__button exit-dialog__button--destructive"
              onClick={onRetryBurnAndExit}
              disabled={isBurning}
            >
              {t('settings.exit.retry')}
            </button>
          ) : (
            <button
              type="button"
              className="exit-dialog__button exit-dialog__button--destructive"
              onClick={onBurnAndExit}
              disabled={isBurning}
            >
              {isBurning ? t('common.loading') : t('settings.exit.burnAndLeave')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
});
