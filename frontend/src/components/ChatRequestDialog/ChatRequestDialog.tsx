import { useState, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import type { UserInfo } from '../../types';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Input } from '../Input';
import { StatusBadge } from '../StatusBadge';
import { CloseIcon, LockIcon, SendIcon } from '../../icons';
import './ChatRequestDialog.css';

interface ChatRequestDialogProps {
  /** User to start chat with */
  user: UserInfo;
  /** Whether request is being sent */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when request is submitted */
  onSubmit: (secretQuestion?: string) => void;
  /** Additional CSS class */
  className?: string;
}

/**
 * Dialog for creating a chat request.
 *
 * Features:
 * - Shows recipient user info
 * - Optional secret question input (3.3.4)
 * - Loading state while sending
 * - Error display
 */
export function ChatRequestDialog({
  user,
  isLoading = false,
  error,
  onClose,
  onSubmit,
  className = '',
}: ChatRequestDialogProps) {
  const [secretQuestion, setSecretQuestion] = useState('');
  const [showSecretQuestion, setShowSecretQuestion] = useState(false);

  const handleSubmit = useCallback((e?: FormEvent) => {
    e?.preventDefault();
    if (isLoading) return;
    onSubmit(showSecretQuestion ? secretQuestion.trim() : undefined);
  }, [isLoading, onSubmit, showSecretQuestion, secretQuestion]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const toggleSecretQuestion = useCallback(() => {
    setShowSecretQuestion((prev) => !prev);
    if (showSecretQuestion) {
      setSecretQuestion('');
    }
  }, [showSecretQuestion]);

  return (
    <div className={`chat-request-dialog-overlay ${className}`} onClick={onClose}>
      <div
        className="chat-request-dialog animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="dialog-title"
        aria-modal="true"
      >
        {/* Close button */}
        <button
          type="button"
          className="chat-request-dialog__close"
          onClick={onClose}
          aria-label="Close dialog"
          disabled={isLoading}
        >
          <CloseIcon size={20} />
        </button>

        {/* Header */}
        <div className="chat-request-dialog__header">
          <div className="chat-request-dialog__icon">
            <LockIcon size={24} />
          </div>
          <h2 id="dialog-title" className="chat-request-dialog__title">
            Start Secure Chat
          </h2>
          <p className="chat-request-dialog__subtitle">
            Send an encrypted chat request
          </p>
        </div>

        {/* User info */}
        <div className="chat-request-dialog__user">
          <Avatar
            src={user.photoUrl}
            name={user.displayName}
            size="lg"
          />
          <div className="chat-request-dialog__user-info">
            <div className="chat-request-dialog__user-header">
              <h3 className="chat-request-dialog__user-name">
                {user.displayName}
                {user.premium && (
                  <span className="chat-request-dialog__premium" title="Premium">
                    &#11088;
                  </span>
                )}
              </h3>
              <StatusBadge
                status={user.online ? 'online' : 'offline'}
                size="sm"
              />
            </div>
            {user.username && (
              <p className="chat-request-dialog__user-username">
                @{user.username}
              </p>
            )}
          </div>
        </div>

        {/* Form */}
        <form className="chat-request-dialog__form" onSubmit={handleSubmit}>
          {/* Secret question toggle */}
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
              <span className="chat-request-dialog__option-label">
                Add secret question
              </span>
            </button>
            <p className="chat-request-dialog__option-hint">
              Recipient must answer to accept the request
            </p>
          </div>

          {/* Secret question input */}
          {showSecretQuestion && (
            <div className="chat-request-dialog__secret-question animate-slide-up">
              <Input
                label="Secret Question"
                placeholder="e.g., What's our shared memory?"
                value={secretQuestion}
                onChange={(e) => setSecretQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={256}
                disabled={isLoading}
                hint={`${secretQuestion.length}/256 characters`}
                autoFocus
              />
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="chat-request-dialog__error animate-fade-in">
              {getErrorMessage(error)}
            </div>
          )}

          {/* Actions */}
          <div className="chat-request-dialog__actions">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={isLoading}
              rightIcon={<SendIcon size={18} />}
            >
              Send Request
            </Button>
          </div>
        </form>

        {/* Security note */}
        <div className="chat-request-dialog__note">
          <LockIcon size={14} />
          <span>End-to-end encrypted. We can't read your messages.</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Simple checkmark SVG
 */
function CheckMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Get user-friendly error message
 */
function getErrorMessage(error: string): string {
  switch (error) {
    case 'SELF_REQUEST':
      return "You can't start a chat with yourself";
    case 'ALREADY_HAS_SESSION':
      return 'You already have an active chat session';
    case 'RECIPIENT_HAS_SESSION':
      return 'This user already has an active chat session';
    case 'PENDING_REQUEST_EXISTS':
      return 'You already sent a request to this user';
    case 'RECIPIENT_NOT_FOUND':
      return 'User not found';
    case 'RATE_LIMITED':
      return 'Too many requests. Please wait a moment';
    case 'CONNECTION_ERROR':
      return 'Connection error. Please check your network';
    case 'INTERNAL_ERROR':
      return 'Something went wrong. Please try again';
    default:
      return 'An error occurred. Please try again';
  }
}
