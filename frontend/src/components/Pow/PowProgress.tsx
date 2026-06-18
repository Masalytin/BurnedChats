import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PowPhase } from '../../hooks/usePow';
import { Button } from '../Button';
import './PowProgress.css';

/** Minimum time the progress indicator stays visible to avoid flicker on fast PoW. */
const MIN_VISIBLE_MS = 450;

/** Interval between rotating "solving" explanations (~2.8 s), mirrors HandshakeView. */
const SOLVING_MESSAGE_ROTATION_MS = 2800;

/** After this long inside `solving`, surface a reassuring "taking longer" line. */
const TAKING_LONGER_THRESHOLD_MS = 9000;

/** Elapsed timer cadence (coarse enough to not spam screen readers). */
const ELAPSED_TICK_MS = 1000;

export interface PowProgressProps {
  phase: PowPhase;
  /** Live PoW hash-iteration count for the active solve (rendered in IMP-POWUX-02). */
  progressIterations?: number;
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
 *
 * During the heavy `solving` phase it shows a live "pulse of work": an
 * indeterminate bar, rotating reassurance copy, the running hash-iteration
 * counter and — after a threshold — an elapsed timer. The pattern mirrors
 * {@link ../HandshakeView/HandshakeView} (rotating waiting copy + elapsed timer),
 * reused conceptually rather than by copying code.
 */
export function PowProgress({
  phase,
  progressIterations = 0,
  failed = false,
  errorMessage,
  onRetry,
}: PowProgressProps) {
  const { t, i18n } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [displayPhase, setDisplayPhase] = useState<PowPhase>(phase);
  const [solvingMessageIndex, setSolvingMessageIndex] = useState(0);
  const [solvingElapsedMs, setSolvingElapsedMs] = useState(0);
  const shownAtRef = useRef<number | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showProgress = isActivePowPhase(phase) || failed;
  const showError = phase === 'error' || failed;
  /** Drive rotation/timer off the live phase so intervals stop when solving ends. */
  const isSolving = phase === 'solving' && !showError;

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

  const solvingMessages = useMemo(() => {
    const messages = t('antispam.pow.solvingMessages', { returnObjects: true });
    return Array.isArray(messages) ? (messages as string[]) : [];
  }, [t]);

  // Rotate explanatory copy and track elapsed time only while actively solving.
  useEffect(() => {
    if (!isSolving) {
      setSolvingMessageIndex(0);
      setSolvingElapsedMs(0);
      return;
    }

    const startedAt = Date.now();
    setSolvingMessageIndex(0);
    setSolvingElapsedMs(0);

    let rotation: ReturnType<typeof setInterval> | undefined;
    if (solvingMessages.length > 1) {
      rotation = setInterval(() => {
        setSolvingMessageIndex((prev) => (prev + 1) % solvingMessages.length);
      }, SOLVING_MESSAGE_ROTATION_MS);
    }

    const ticker = setInterval(() => {
      setSolvingElapsedMs(Date.now() - startedAt);
    }, ELAPSED_TICK_MS);

    return () => {
      if (rotation) {
        clearInterval(rotation);
      }
      clearInterval(ticker);
    };
  }, [isSolving, solvingMessages.length]);

  const formatElapsed = useCallback(
    (ms: number) => {
      const seconds = Math.max(1, Math.floor(ms / 1000));
      return t('antispam.pow.elapsedSeconds', { count: seconds });
    },
    [t],
  );

  if (!visible && !showProgress) {
    return null;
  }

  const progressMessage = (() => {
    if (displayPhase === 'requesting') {
      return t('antispam.pow.securing');
    }
    if (isSolving && solvingMessages.length > 0) {
      return solvingMessages[solvingMessageIndex % solvingMessages.length];
    }
    return t('antispam.pow.solving');
  })();

  const iterationsLabel =
    progressIterations > 0 ? progressIterations.toLocaleString(i18n.language) : null;
  const isTakingLonger = isSolving && solvingElapsedMs >= TAKING_LONGER_THRESHOLD_MS;
  const errorText = errorMessage ?? t('antispam.pow.failed');

  return (
    <div
      className={`pow-progress ${visible ? 'pow-progress--visible' : 'pow-progress--hiding'} ${isSolving ? 'pow-progress--solving' : ''}`}
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
          <div className="pow-progress__body">
            <span
              className={`pow-progress__text ${isSolving ? 'pow-progress__text--rotating' : ''}`}
              key={isSolving ? `solving-${solvingMessageIndex}` : displayPhase}
            >
              {progressMessage}
            </span>
            {isSolving && (
              <>
                <span className="pow-progress__bar" aria-hidden="true">
                  <span className="pow-progress__bar-fill" />
                </span>
                {iterationsLabel && (
                  <span className="pow-progress__iterations" aria-hidden="true">
                    {iterationsLabel}
                  </span>
                )}
                {isTakingLonger && (
                  <span className="pow-progress__taking-longer">
                    {t('antispam.pow.takingLonger')}
                    {solvingElapsedMs > 0 && (
                      <span className="pow-progress__elapsed" aria-hidden="true">
                        {' '}
                        {formatElapsed(solvingElapsedMs)}
                      </span>
                    )}
                  </span>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
