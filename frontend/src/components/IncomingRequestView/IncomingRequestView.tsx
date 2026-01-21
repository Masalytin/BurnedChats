import { useState, useEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import type { ChatRequest } from '../../types';
import type { AcceptErrorCode } from '../../hooks/useIncomingRequests';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Card, CardContent } from '../Card';
import { Input } from '../Input';
import { StatusBadge } from '../StatusBadge';
import { CheckIcon, CloseIcon, LockIcon } from '../../icons';
import './IncomingRequestView.css';

interface IncomingRequestViewProps {
  /** The incoming chat request */
  request: ChatRequest;
  /** Whether accept is in progress */
  isAccepting?: boolean;
  /** Whether reject is in progress */
  isRejecting?: boolean;
  /** Error from accept action */
  error?: AcceptErrorCode | null;
  /** Callback when user accepts the request */
  onAccept: (secretAnswer?: string) => void;
  /** Callback when user rejects the request */
  onReject: () => void;
  /** Callback when request expires */
  onExpire?: () => void;
  /** Additional CSS class */
  className?: string;
}

/**
 * UI for viewing and responding to an incoming chat request.
 *
 * Features:
 * - Shows sender info
 * - Countdown timer to expiration
 * - Accept/Reject buttons
 * - Secret question answer input (when required)
 * - Error display
 *
 * Tasks: 3.4.4, 3.4.5
 */
export function IncomingRequestView({
  request,
  isAccepting = false,
  isRejecting = false,
  error,
  onAccept,
  onReject,
  onExpire,
  className = '',
}: IncomingRequestViewProps) {
  const { fromUsername, fromName, secretQuestion, expiresAt } = request;
  const hasSecretQuestion = !!secretQuestion;

  const [secretAnswer, setSecretAnswer] = useState('');
  const [showError, setShowError] = useState(false);

  // Calculate remaining time
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  );

  // Update countdown every second
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setRemainingSeconds(remaining);

      if (remaining === 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  // Show error when it changes
  useEffect(() => {
    if (error) {
      setShowError(true);
    }
  }, [error]);

  // Format remaining time as MM:SS
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const handleAccept = useCallback((e?: FormEvent) => {
    e?.preventDefault();
    if (isAccepting || isRejecting) return;

    // Validate answer if required
    if (hasSecretQuestion && !secretAnswer.trim()) {
      setShowError(true);
      return;
    }

    setShowError(false);
    onAccept(hasSecretQuestion ? secretAnswer.trim() : undefined);
  }, [isAccepting, isRejecting, hasSecretQuestion, secretAnswer, onAccept]);

  const handleReject = useCallback(() => {
    if (isAccepting || isRejecting) return;
    onReject();
  }, [isAccepting, isRejecting, onReject]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAccept();
    }
  }, [handleAccept]);

  const isExpired = remainingSeconds === 0;
  const isLowTime = remainingSeconds > 0 && remainingSeconds <= 60;
  const isProcessing = isAccepting || isRejecting;

  // Determine which error message to show
  const getErrorMessage = (errorCode: AcceptErrorCode): string => {
    switch (errorCode) {
      case 'SESSION_NOT_FOUND':
        return 'This request no longer exists';
      case 'NOT_RESPONDER':
        return 'You cannot accept this request';
      case 'ALREADY_ACCEPTED':
        return 'This request has already been accepted';
      case 'SESSION_EXPIRED':
      case 'REQUEST_EXPIRED':
        return 'This request has expired';
      case 'ANSWER_REQUIRED':
        return 'Please answer the secret question';
      case 'CONNECTION_ERROR':
        return 'Connection error. Please check your network';
      case 'INTERNAL_ERROR':
        return 'Something went wrong. Please try again';
      default:
        return 'An error occurred. Please try again';
    }
  };

  return (
    <div className={`incoming-request-view ${className}`}>
      <div className="incoming-request-view__content animate-slide-up">
        {/* Header icon */}
        <div className="incoming-request-view__header-icon">
          <div className="incoming-request-view__icon-ring" />
          <div className="incoming-request-view__icon-container">
            <LockIcon size={28} />
          </div>
        </div>

        {/* Status text */}
        <div className="incoming-request-view__status">
          <h2 className="incoming-request-view__title">
            {isExpired ? 'Request Expired' : 'Incoming Chat Request'}
          </h2>
          <p className="incoming-request-view__subtitle">
            {isExpired
              ? 'This request has expired. It is no longer available.'
              : 'Someone wants to start a secure conversation with you'}
          </p>
        </div>

        {/* Sender card */}
        <Card className="incoming-request-view__user-card">
          <CardContent>
            <div className="incoming-request-view__user">
              <Avatar
                name={fromName}
                size="lg"
              />
              <div className="incoming-request-view__user-info">
                <div className="incoming-request-view__user-header">
                  <h3 className="incoming-request-view__user-name">
                    {fromName}
                  </h3>
                  <StatusBadge status="online" size="sm" />
                </div>
                {fromUsername && (
                  <p className="incoming-request-view__user-username">
                    @{fromUsername}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Timer */}
        {!isExpired && (
          <div className={`incoming-request-view__timer ${isLowTime ? 'incoming-request-view__timer--low' : ''}`}>
            <ClockIcon size={16} />
            <span>Expires in {formatTime(remainingSeconds)}</span>
          </div>
        )}

        {/* Secret question section (Task 3.4.5) */}
        {hasSecretQuestion && !isExpired && (
          <div className="incoming-request-view__secret-question animate-fade-in">
            <div className="incoming-request-view__question-label">
              <span className="incoming-request-view__question-icon">?</span>
              <span>Secret Question</span>
            </div>
            <div className="incoming-request-view__question-text">
              {secretQuestion}
            </div>
            <form onSubmit={handleAccept}>
              <Input
                label="Your Answer"
                placeholder="Enter your answer..."
                value={secretAnswer}
                onChange={(e) => {
                  setSecretAnswer(e.target.value);
                  setShowError(false);
                }}
                onKeyDown={handleKeyDown}
                maxLength={256}
                disabled={isProcessing}
                error={showError && !secretAnswer.trim() ? 'Answer is required' : undefined}
                autoFocus
              />
            </form>
          </div>
        )}

        {/* Error message */}
        {error && showError && (
          <div className="incoming-request-view__error animate-fade-in">
            {getErrorMessage(error)}
          </div>
        )}

        {/* Actions */}
        {!isExpired && (
          <div className="incoming-request-view__actions">
            <Button
              variant="secondary"
              onClick={handleReject}
              disabled={isProcessing}
              isLoading={isRejecting}
              leftIcon={<CloseIcon size={18} />}
              fullWidth
            >
              Decline
            </Button>
            <Button
              variant="primary"
              onClick={handleAccept}
              disabled={isProcessing || (hasSecretQuestion && !secretAnswer.trim())}
              isLoading={isAccepting}
              leftIcon={<CheckIcon size={18} />}
              fullWidth
            >
              Accept
            </Button>
          </div>
        )}

        {/* Expired state action */}
        {isExpired && (
          <div className="incoming-request-view__actions incoming-request-view__actions--single">
            <Button
              variant="primary"
              onClick={handleReject}
              fullWidth
            >
              Back to Home
            </Button>
          </div>
        )}

        {/* Security note */}
        <div className="incoming-request-view__note">
          <LockIcon size={14} />
          <span>End-to-end encrypted. Messages cannot be read by anyone else.</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Clock icon
 */
function ClockIcon({ size = 24, ...props }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
