import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './PanicUndoToast.css';

export interface PanicUndoToastProps {
  open: boolean;
  countdownSeconds?: number;
  onCancel: () => void;
  onExpire: () => void;
}

export const PanicUndoToast = memo(function PanicUndoToast({
  open,
  countdownSeconds = 3,
  onCancel,
  onExpire,
}: PanicUndoToastProps) {
  const { t } = useTranslation();
  const [secondsLeft, setSecondsLeft] = useState(countdownSeconds);
  const onExpireRef = useRef(onExpire);
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onExpireRef.current = onExpire;

  const clearCountdownTimer = () => {
    if (countdownTimerRef.current != null) {
      clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      clearCountdownTimer();
      return;
    }

    setSecondsLeft(countdownSeconds);
    let remaining = countdownSeconds;

    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        countdownTimerRef.current = null;
        onExpireRef.current();
        return;
      }
      setSecondsLeft(remaining);
      countdownTimerRef.current = setTimeout(tick, 1000);
    };

    countdownTimerRef.current = setTimeout(tick, 1000);

    return () => {
      clearCountdownTimer();
    };
  }, [open, countdownSeconds]);

  const handleCancel = () => {
    clearCountdownTimer();
    onCancel();
  };

  if (!open) {
    return null;
  }

  return (
    <div className="panic-undo-toast" role="alertdialog" aria-live="assertive" aria-modal="true">
      <p className="panic-undo-toast__message">
        {t('panic.countdown', { seconds: secondsLeft })}
      </p>
      <button type="button" className="panic-undo-toast__cancel" onClick={handleCancel}>
        {t('panic.cancel')}
      </button>
    </div>
  );
});
