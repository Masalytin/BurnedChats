import { useEffect, useState, useMemo } from 'react';
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
import type { HandshakeStage, HandshakeResult } from '../../hooks/useHandshake';
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
  /** Additional CSS class */
  className?: string;
}

/** Stage display information */
interface StageInfo {
  title: string;
  description: string;
  Icon: LucideIcon;
}

/** Stage information map */
const STAGE_INFO: Record<HandshakeStage, StageInfo> = {
  idle: {
    title: 'Ready',
    description: 'Waiting to start...',
    Icon: Hourglass,
  },
  generating_keys: {
    title: 'Generating Keys',
    description: 'Creating your encryption keys...',
    Icon: Key,
  },
  sending_key: {
    title: 'Sending Key',
    description: 'Sending your public key...',
    Icon: Send,
  },
  waiting_peer: {
    title: 'Waiting for Peer',
    description: 'Waiting for their encryption key...',
    Icon: Hourglass,
  },
  computing_secret: {
    title: 'Computing Secret',
    description: 'Establishing secure connection...',
    Icon: Lock,
  },
  complete: {
    title: 'Secure Connection Established',
    description: 'End-to-end encryption is active',
    Icon: CheckCircle,
  },
  error: {
    title: 'Connection Failed',
    description: 'Could not establish secure connection',
    Icon: XCircle,
  },
};

/** Error code to user-friendly message */
const ERROR_MESSAGES: Record<string, string> = {
  KEY_GENERATION_FAILED: 'Failed to generate encryption keys. Please try again.',
  KEY_EXPORT_FAILED: 'Failed to prepare encryption key. Please try again.',
  KEY_SEND_FAILED: 'Failed to send encryption key. Check your connection.',
  PEER_KEY_INVALID: 'Received invalid key from peer. Please try again.',
  KEY_IMPORT_FAILED: 'Failed to process peer\'s key. Please try again.',
  SECRET_COMPUTE_FAILED: 'Failed to establish secure connection. Please try again.',
  KEY_DERIVATION_FAILED: 'Failed to derive encryption key. Please try again.',
  SESSION_NOT_FOUND: 'Session not found. It may have expired.',
  NOT_PARTICIPANT: 'You are not a participant in this session.',
  INVALID_STATUS: 'Session is not ready for key exchange.',
  TIMEOUT: 'Connection timed out. Please try again.',
  CONNECTION_ERROR: 'Connection lost. Please check your network.',
};

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
  className = '',
}: HandshakeViewProps) {
  const { t } = useTranslation();
  const { stage, peer, fingerprint, error, progress } = result;
  const [animatedProgress, setAnimatedProgress] = useState(0);

  // Animate progress bar
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedProgress(progress);
    }, 100);
    return () => clearTimeout(timer);
  }, [progress]);

  // Get stage info
  const stageInfo = useMemo(() => STAGE_INFO[stage], [stage]);
  const StageIcon = stageInfo.Icon;

  // Get error message
  const errorMessage = useMemo(() => {
    if (error) {
      return ERROR_MESSAGES[error] || 'An unexpected error occurred.';
    }
    return null;
  }, [error]);

  // Format fingerprint for display (add spaces) when visual shapes are unavailable
  const formattedFingerprint = useMemo(() => {
    if (!fingerprint) return null;
    return fingerprint.match(/.{1,4}/g)?.join(' ') || fingerprint;
  }, [fingerprint]);

  const hasVisualFingerprint = visualFingerprint.length > 0;

  const isError = stage === 'error';
  const isComplete = stage === 'complete';
  const isInProgress = !isError && !isComplete && stage !== 'idle';

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
              className={`handshake-view__progress-fill ${isError ? 'handshake-view__progress-fill--error' : ''} ${isComplete ? 'handshake-view__progress-fill--complete' : ''}`}
              cx="50"
              cy="50"
              r="45"
              fill="none"
              strokeWidth="6"
              strokeDasharray={`${animatedProgress * 2.83} 283`}
              strokeLinecap="round"
            />
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
          <h2 className="handshake-view__title">{stageInfo.title}</h2>
          <p className="handshake-view__subtitle">
            {isError ? errorMessage : stageInfo.description}
          </p>
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
              label="Generate keys"
              status={getStepStatus(stage, 'generating_keys')}
            />
            <HandshakeStep
              label="Exchange keys"
              status={getStepStatus(stage, 'sending_key', 'waiting_peer')}
            />
            <HandshakeStep
              label="Establish encryption"
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
              fullWidth
            >
              Try Again
            </Button>
          )}
          {!isComplete && (
            <Button
              variant={isError ? 'secondary' : 'secondary'}
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
