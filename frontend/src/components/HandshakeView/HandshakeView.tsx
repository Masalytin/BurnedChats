import { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle,
  Hourglass,
  Key,
  Lock,
  Send,
  Star,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { HandshakeStage, HandshakeResult, HandshakeErrorCode } from '../../hooks/useHandshake';
import type { VisualFingerprintElement } from '../../types';
import { VisualFingerprint } from '../VisualFingerprint';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Card, CardContent } from '../Card';
import { CheckIcon, CloseIcon, LockIcon } from '../../icons';
import './HandshakeView.css';

interface HandshakeViewProps {
  /** The handshake result state */
  result: HandshakeResult;
  /** Visual fingerprint shapes shown when handshake completes */
  visualFingerprint?: VisualFingerprintElement[];
  /** Callback when user cancels handshake */
  onCancel: () => void;
  /** Callback when handshake is complete and user wants to continue to chat */
  onContinue?: () => void;
  /** Callback to retry handshake */
  onRetry?: () => void;
  /** Callback to burn session and return home (error recovery) */
  onStartOver?: () => void;
  /** When true, manual retry limit reached — disable retry button */
  retryDisabled?: boolean;
  /** Additional CSS class */
  className?: string;
}

/** Stage icon map (text comes from i18n) */
const STAGE_ICONS: Record<HandshakeStage, LucideIcon> = {
  idle: Hourglass,
  generating_keys: Key,
  sending_key: Send,
  waiting_peer: Hourglass,
  computing_secret: Lock,
  complete: CheckCircle,
  error: XCircle,
};

const HANDSHAKE_ERROR_CODES: HandshakeErrorCode[] = [
  'KEY_GENERATION_FAILED',
  'KEY_EXPORT_FAILED',
  'KEY_SEND_FAILED',
  'PEER_KEY_INVALID',
  'KEY_IMPORT_FAILED',
  'SECRET_COMPUTE_FAILED',
  'KEY_DERIVATION_FAILED',
  'SESSION_NOT_FOUND',
  'NOT_PARTICIPANT',
  'INVALID_STATUS',
  'TIMEOUT',
  'CONNECTION_ERROR',
];

/** Stages that show rotating waiting copy instead of static stage description */
const ROTATING_MESSAGE_STAGES: HandshakeStage[] = ['waiting_peer', 'computing_secret'];

/** Interval between rotating waiting messages (~2.5–3 s) */
const WAITING_MESSAGE_ROTATION_MS = 2800;

/** Stages where progress ring shows a live indeterminate animation */
const LIVE_PROGRESS_STAGES: HandshakeStage[] = ['waiting_peer', 'computing_secret'];

function isHandshakeErrorCode(code: string): code is HandshakeErrorCode {
  return HANDSHAKE_ERROR_CODES.includes(code as HandshakeErrorCode);
}

/**
 * Handshake progress UI component.
 *
 * Displays the current stage of the ECDH key exchange:
 * - Visual progress indicator
 * - Stage description
 * - Peer information
 * - Fingerprint on completion
 * - Error handling with retry option
 */
export function HandshakeView({
  result,
  visualFingerprint = [],
  onCancel,
  onContinue,
  onRetry,
  onStartOver,
  retryDisabled = false,
  className = '',
}: HandshakeViewProps) {
  const { t } = useTranslation();
  const { stage, peer, fingerprint, error, progress, elapsedMs, isTakingLonger } = result;
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const [waitingMessageIndex, setWaitingMessageIndex] = useState(0);

  const waitingMessages = useMemo(() => {
    const messages = t('handshake.waitingMessages', { returnObjects: true });
    return Array.isArray(messages) ? (messages as string[]) : [];
  }, [t]);

  const isRotatingMessageStage = ROTATING_MESSAGE_STAGES.includes(stage);
  const isLiveProgressStage = LIVE_PROGRESS_STAGES.includes(stage);

  // Rotate explanatory copy during long-running waiting stages
  useEffect(() => {
    if (!isRotatingMessageStage || waitingMessages.length === 0) {
      setWaitingMessageIndex(0);
      return;
    }

    setWaitingMessageIndex(0);
    const interval = setInterval(() => {
      setWaitingMessageIndex((prev) => (prev + 1) % waitingMessages.length);
    }, WAITING_MESSAGE_ROTATION_MS);

    return () => clearInterval(interval);
  }, [stage, isRotatingMessageStage, waitingMessages.length]);

  // Animate progress bar
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedProgress(progress);
    }, 100);
    return () => clearTimeout(timer);
  }, [progress]);

  const StageIcon = STAGE_ICONS[stage];

  const stageTitle = t(`handshake.stages.${stage}.title`);
  const stageDescription = t(`handshake.stages.${stage}.description`);

  const errorMessage = useMemo(() => {
    if (!error) {
      return null;
    }
    if (isHandshakeErrorCode(error)) {
      return t(`handshake.errors.${error}`);
    }
    return t('handshake.errors.DEFAULT');
  }, [error, t]);

  const isError = stage === 'error';
  const isComplete = stage === 'complete';
  const isInProgress = !isError && !isComplete && stage !== 'idle';

  const formatElapsed = useCallback((ms: number) => {
    const seconds = Math.max(1, Math.floor(ms / 1000));
    return t('handshake.elapsedSeconds', { count: seconds });
  }, [t]);

  const statusSubtitle = useMemo(() => {
    if (isError) {
      return errorMessage;
    }
    if (isRotatingMessageStage && waitingMessages.length > 0) {
      return waitingMessages[waitingMessageIndex % waitingMessages.length];
    }
    return stageDescription;
  }, [
    isError,
    errorMessage,
    isRotatingMessageStage,
    waitingMessages,
    waitingMessageIndex,
    stageDescription,
  ]);

  // Format fingerprint for display (add spaces) when visual shapes are unavailable
  const formattedFingerprint = useMemo(() => {
    if (!fingerprint) return null;
    return fingerprint.match(/.{1,4}/g)?.join(' ') || fingerprint;
  }, [fingerprint]);

  const hasVisualFingerprint = visualFingerprint.length > 0;

  return (
    <div className={`handshake-view ${className}`}>
      <div className="handshake-view__content animate-slide-up">
        {/* Progress ring */}
        <div className="handshake-view__progress-container">
          <svg className="handshake-view__progress-ring" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              className="handshake-view__progress-bg"
              cx="50"
              cy="50"
              r="45"
              fill="none"
              strokeWidth="6"
            />
            {/* Progress circle */}
            <circle
              className={`handshake-view__progress-fill ${isError ? 'handshake-view__progress-fill--error' : ''} ${isComplete ? 'handshake-view__progress-fill--complete' : ''} ${isLiveProgressStage ? 'handshake-view__progress-fill--waiting' : ''}`}
              cx="50"
              cy="50"
              r="45"
              fill="none"
              strokeWidth="6"
              strokeDasharray={`${animatedProgress * 2.83} 283`}
              strokeLinecap="round"
            />
            {isLiveProgressStage && (
              <circle
                className="handshake-view__progress-indeterminate"
                cx="50"
                cy="50"
                r="45"
                fill="none"
                strokeWidth="6"
                strokeDasharray="70 213"
                strokeLinecap="round"
              />
            )}
          </svg>
          <div className="handshake-view__progress-icon">
            {isComplete ? (
              <LockIcon size={32} />
            ) : isError ? (
              <span className="handshake-view__error-icon" aria-hidden="true">
                <StageIcon size={32} />
              </span>
            ) : (
              <div className="handshake-view__spinner" />
            )}
          </div>
        </div>

        {/* Status text */}
        <div className="handshake-view__status">
          <h2 className="handshake-view__title">{stageTitle}</h2>
          <p
            className={`handshake-view__subtitle ${isRotatingMessageStage ? 'handshake-view__subtitle--rotating' : ''}`}
            key={isRotatingMessageStage ? waitingMessageIndex : stage}
          >
            {statusSubtitle}
          </p>
          {isTakingLonger && stage === 'waiting_peer' && (
            <p className="handshake-view__taking-longer">
              {t('handshake.takingLonger')}
              {typeof elapsedMs === 'number' && elapsedMs > 0 && (
                <span className="handshake-view__elapsed">
                  {formatElapsed(elapsedMs)}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Fingerprint display (on complete) */}
        {isComplete && hasVisualFingerprint && (
          <div className="handshake-view__fingerprint animate-fade-in">
            <VisualFingerprint
              elements={visualFingerprint}
              size="md"
              showLabel
              showHint
            />
          </div>
        )}
        {isComplete && !hasVisualFingerprint && formattedFingerprint && (
          <div className="handshake-view__fingerprint animate-fade-in">
            <div className="handshake-view__fingerprint-label">
              {t('handshake.fingerprintLabel')}
            </div>
            <div className="handshake-view__fingerprint-value">
              {formattedFingerprint}
            </div>
            <p className="handshake-view__fingerprint-hint">
              {t('handshake.fingerprintHint')}
            </p>
          </div>
        )}

        {/* Peer info card */}
        {peer && (
          <Card className="handshake-view__peer-card">
            <CardContent>
              <div className="handshake-view__peer">
                <Avatar
                  src={peer.photoUrl}
                  name={peer.displayName}
                  size="md"
                />
                <div className="handshake-view__peer-info">
                  <h3 className="handshake-view__peer-name">
                    {peer.displayName}
                    {peer.premium && (
                      <span className="handshake-view__premium" title="Premium">
                        <Star size={14} aria-hidden="true" />
                      </span>
                    )}
                  </h3>
                  {peer.username && (
                    <p className="handshake-view__peer-username">
                      @{peer.username}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Progress steps (for in-progress states) */}
        {isInProgress && (
          <div className="handshake-view__steps">
            <HandshakeStep
              label={t('handshake.steps.generateKeys')}
              status={getStepStatus(stage, 'generating_keys')}
            />
            <HandshakeStep
              label={t('handshake.steps.exchangeKeys')}
              status={getStepStatus(stage, 'sending_key', 'waiting_peer')}
            />
            <HandshakeStep
              label={t('handshake.steps.establishEncryption')}
              status={getStepStatus(stage, 'computing_secret')}
            />
          </div>
        )}

        {/* Actions */}
        <div className="handshake-view__actions">
          {isError && onRetry && (
            <Button
              variant="primary"
              onClick={onRetry}
              disabled={retryDisabled}
              fullWidth
            >
              {t('handshake.retry')}
            </Button>
          )}
          {isError && onStartOver && (
            <Button
              variant="secondary"
              onClick={onStartOver}
              leftIcon={<CloseIcon size={18} />}
              fullWidth
            >
              {t('handshake.startOver')}
            </Button>
          )}
          {!isComplete && !isError && (
            <Button
              variant="secondary"
              onClick={onCancel}
              leftIcon={<CloseIcon size={18} />}
              fullWidth
            >
              {t('common.cancel')}
            </Button>
          )}
          {isComplete && (
            <Button
              variant="primary"
              onClick={onContinue || onCancel}
              fullWidth
            >
              {t('handshake.continueToVerification')}
            </Button>
          )}
        </div>

        {/* Help text */}
        {isInProgress && (
          <p className="handshake-view__help">
            Establishing end-to-end encryption...
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================
// Helper Components
// ============================================

type StepStatus = 'pending' | 'active' | 'complete';

interface HandshakeStepProps {
  label: string;
  status: StepStatus;
}

function HandshakeStep({ label, status }: HandshakeStepProps) {
  return (
    <div className={`handshake-step handshake-step--${status}`}>
      <div className="handshake-step__indicator">
        {status === 'complete' && <CheckIcon size={12} aria-hidden="true" />}
        {status === 'active' && <div className="handshake-step__spinner" />}
      </div>
      <span className="handshake-step__label">{label}</span>
    </div>
  );
}

/**
 * Determine step status based on current stage.
 */
function getStepStatus(
  currentStage: HandshakeStage,
  ...targetStages: HandshakeStage[]
): StepStatus {
  const stageOrder: HandshakeStage[] = [
    'idle',
    'generating_keys',
    'sending_key',
    'waiting_peer',
    'computing_secret',
    'complete',
  ];

  const currentIndex = stageOrder.indexOf(currentStage);
  const targetIndices = targetStages.map((s) => stageOrder.indexOf(s));
  const maxTargetIndex = Math.max(...targetIndices);
  const minTargetIndex = Math.min(...targetIndices);

  if (currentIndex > maxTargetIndex) {
    return 'complete';
  }
  if (currentIndex >= minTargetIndex && currentIndex <= maxTargetIndex) {
    return 'active';
  }
  return 'pending';
}
