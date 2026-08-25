import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertIcon, CloseIcon, FlameIcon } from '@/icons';
import { useHaptics } from '@/hooks/useHaptics';
import './BurnAllDialog.css';

export type BurnAllDialogMode = 'data' | 'account';

const HOLD_DURATION_MS = 1500;

interface BurnAllDialogProps {
  mode: BurnAllDialogMode;
  open: boolean;
  isLoading?: boolean;
  isOffline?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const BurnAllDialog = memo(function BurnAllDialog({
  mode,
  open,
  isLoading = false,
  isOffline = false,
  onConfirm,
  onClose,
}: BurnAllDialogProps) {
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [accountAcknowledged, setAccountAcknowledged] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdActiveRef = useRef(false);
  const holdStartRef = useRef(0);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      setAccountAcknowledged(false);
      setHoldProgress(0);
      holdActiveRef.current = false;
      if (holdIntervalRef.current != null) {
        clearInterval(holdIntervalRef.current);
        holdIntervalRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      haptics.impact('medium');
    }
  }, [haptics.impact, open]);

  const canHold = mode === 'data' || accountAcknowledged;

  const stopHold = useCallback(() => {
    holdActiveRef.current = false;
    if (holdIntervalRef.current != null) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    setHoldProgress(0);
  }, []);

  const tickHold = useCallback(() => {
    if (!holdActiveRef.current) {
      return;
    }

    const elapsed = Date.now() - holdStartRef.current;
    const progress = Math.min(100, (elapsed / HOLD_DURATION_MS) * 100);
    setHoldProgress(progress);

    if (elapsed >= HOLD_DURATION_MS) {
      holdActiveRef.current = false;
      if (holdIntervalRef.current != null) {
        clearInterval(holdIntervalRef.current);
        holdIntervalRef.current = null;
      }
      setHoldProgress(100);
      haptics.notification('warning');
      onConfirm();
    }
  }, [haptics.notification, onConfirm]);

  const startHold = useCallback(() => {
    if (isLoading || isOffline || !canHold) {
      return;
    }

    holdActiveRef.current = true;
    holdStartRef.current = Date.now();
    setHoldProgress(0);
    if (holdIntervalRef.current != null) {
      clearInterval(holdIntervalRef.current);
    }
    holdIntervalRef.current = setInterval(tickHold, 50);
  }, [canHold, isLoading, isOffline, tickHold]);

  useEffect(() => {
    return () => {
      if (holdIntervalRef.current != null) {
        clearInterval(holdIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLoading) {
        onClose();
      }
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isLoading, onClose, open]);

  if (!open) {
    return null;
  }

  const titleKey = mode === 'account' ? 'settings.burnAll.accountTitle' : 'settings.burnAll.dataTitle';
  const descriptionKey =
    mode === 'account' ? 'settings.burnAll.accountDescription' : 'settings.burnAll.dataDescription';

  return (
    <div className="burn-all-dialog-overlay" onClick={isLoading ? undefined : onClose}>
      <div
        className="burn-all-dialog animate-slide-up"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-labelledby="burn-all-dialog-title"
        aria-describedby="burn-all-dialog-description"
        aria-modal="true"
      >
        <button
          type="button"
          className="burn-all-dialog__close"
          onClick={onClose}
          aria-label={t('common.cancel')}
          disabled={isLoading}
        >
          <CloseIcon size={20} />
        </button>

        <div className="burn-all-dialog__icon">
          <FlameIcon size={32} />
        </div>

        <h2 id="burn-all-dialog-title" className="burn-all-dialog__title">
          {t(titleKey)}
        </h2>

        <p id="burn-all-dialog-description" className="burn-all-dialog__description">
          {t(descriptionKey)}
        </p>

        {isOffline ? (
          <div className="burn-all-dialog__warning">
            <AlertIcon size={16} />
            <span>{t('settings.burnAll.offlineError')}</span>
          </div>
        ) : null}

        {mode === 'account' ? (
          <label className="burn-all-dialog__ack">
            <input
              type="checkbox"
              checked={accountAcknowledged}
              onChange={(event) => setAccountAcknowledged(event.target.checked)}
              disabled={isLoading}
            />
            <span>{t('settings.burnAll.accountAck')}</span>
          </label>
        ) : null}

        <button
          type="button"
          className="burn-all-dialog__hold"
          aria-label={t('settings.burnAll.holdButton')}
          disabled={isLoading || isOffline || !canHold}
          onPointerDown={startHold}
          onPointerUp={stopHold}
          onPointerCancel={stopHold}
          onPointerLeave={stopHold}
        >
          <span
            className="burn-all-dialog__hold-progress"
            style={{ width: `${holdProgress}%` }}
            aria-hidden="true"
          />
          <span className="burn-all-dialog__hold-label">
            {isLoading ? t('common.loading') : t('settings.burnAll.holdButton')}
          </span>
        </button>
      </div>
    </div>
  );
});
