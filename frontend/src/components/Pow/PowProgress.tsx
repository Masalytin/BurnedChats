import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PowPhase } from '../../hooks/usePow';
import { Button } from '../Button';
import './PowProgress.css';

/** Minimum time the progress indicator stays visible to avoid flicker on fast PoW. */
const MIN_VISIBLE_MS = 450;

export interface PowProgressProps {
  phase: PowPhase;
  /** Session-level PoW failure (server rejected or client-side solve failed). */
  failed?: boolean;
  /** Localized error message when available. */
  errorMessage?: string | null;
  onRetry?: () => void;
}

const ACTIVE_PHASES: PowPhase[] = ['requesting', 'solving', 'error'];

function isActivePowPhase(phase: PowPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
}

/**
 * Lightweight, non-blocking PoW progress indicator for session creation flow.
 */
export function PowProgress({
  phase,
  failed = false,
  errorMessage,
  onRetry,
}: PowProgressProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [displayPhase, setDisplayPhase] = useState<PowPhase>(phase);
  const shownAtRef = useRef<number | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showProgress = isActivePowPhase(phase) || failed;
  const showError = phase === 'error' || failed;

  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (showProgress) {
      setDisplayPhase(failed ? 'error' : phase);
      setVisible(true);
      if (phase === 'requesting' && shownAtRef.current === null) {
        shownAtRef.current = Date.now();
      }
      return;
    }

    if (!visible) {
      return;
    }

    const elapsed = shownAtRef.current !== null ? Date.now() - shownAtRef.current : MIN_VISIBLE_MS;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);

    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      shownAtRef.current = null;
    }, remaining);

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [phase, showProgress, failed, visible]);

  if (!visible && !showProgress) {
    return null;
  }

  const progressMessage =
    displayPhase === 'requesting'
      ? t('antispam.pow.securing')
      : t('antispam.pow.solving');

  const errorText = errorMessage ?? t('antispam.pow.failed');

  return (
    <div
      className={`pow-progress ${visible ? 'pow-progress--visible' : 'pow-progress--hiding'}`}
      role="status"
      aria-live="polite"
    >
      {showError ? (
        <div className="pow-progress__error">
          <span className="pow-progress__text">{errorText}</span>
          {onRetry && (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              {t('antispam.pow.retry')}
            </Button>
          )}
        </div>
      ) : (
        <>
          <span className="pow-progress__spinner" aria-hidden="true" />
          <span className="pow-progress__text">{progressMessage}</span>
        </>
      )}
    </div>
  );
}
