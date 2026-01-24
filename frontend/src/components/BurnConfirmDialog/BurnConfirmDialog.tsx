import { memo, useCallback, useEffect } from 'react';
import { Button } from '../Button';
import { CloseIcon, FlameIcon, AlertIcon } from '../../icons';
import './BurnConfirmDialog.css';

interface BurnConfirmDialogProps {
  /** Peer's display name */
  peerName: string;
  /** Whether burn is in progress */
  isLoading?: boolean;
  /** Callback when burn is confirmed */
  onConfirm: () => void;
  /** Callback when dialog is cancelled */
  onCancel: () => void;
  /** Additional CSS class */
  className?: string;
}

/**
 * Confirmation dialog for burning (destroying) a chat session.
 * 
 * Task 4.4.5 - Frontend: диалог подтверждения
 * 
 * Features:
 * - Clear warning about irreversible action
 * - Loading state during burn
 * - Escape key to cancel
 * - Click outside to cancel
 * 
 * @example
 * ```tsx
 * {showBurnDialog && (
 *   <BurnConfirmDialog
 *     peerName="John"
 *     isLoading={isBurning}
 *     onConfirm={confirmBurn}
 *     onCancel={cancelBurn}
 *   />
 * )}
 * ```
 */
export const BurnConfirmDialog = memo(function BurnConfirmDialog({
  peerName,
  isLoading = false,
  onConfirm,
  onCancel,
  className = '',
}: BurnConfirmDialogProps) {
  /**
   * Handle escape key to close dialog.
   */
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isLoading, onCancel]);

  /**
   * Handle overlay click.
   */
  const handleOverlayClick = useCallback(() => {
    if (!isLoading) {
      onCancel();
    }
  }, [isLoading, onCancel]);

  /**
   * Prevent clicks inside dialog from closing it.
   */
  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div 
      className={`burn-dialog-overlay ${className}`} 
      onClick={handleOverlayClick}
    >
      <div
        className="burn-dialog animate-slide-up"
        onClick={handleDialogClick}
        role="alertdialog"
        aria-labelledby="burn-dialog-title"
        aria-describedby="burn-dialog-description"
        aria-modal="true"
      >
        {/* Close button */}
        <button
          type="button"
          className="burn-dialog__close"
          onClick={onCancel}
          aria-label="Cancel"
          disabled={isLoading}
        >
          <CloseIcon size={20} />
        </button>

        {/* Icon */}
        <div className="burn-dialog__icon">
          <FlameIcon size={32} />
        </div>

        {/* Header */}
        <h2 id="burn-dialog-title" className="burn-dialog__title">
          Burn this chat?
        </h2>

        {/* Description */}
        <p id="burn-dialog-description" className="burn-dialog__description">
          This will permanently destroy your chat with <strong>{peerName}</strong>.
        </p>

        {/* Warning */}
        <div className="burn-dialog__warning">
          <AlertIcon size={16} />
          <span>
            All messages and encryption keys will be erased on both devices. 
            This action cannot be undone.
          </span>
        </div>

        {/* What will be destroyed */}
        <ul className="burn-dialog__list">
          <li>
            <span className="burn-dialog__list-icon">🔑</span>
            Encryption keys (both devices)
          </li>
          <li>
            <span className="burn-dialog__list-icon">💬</span>
            All message history
          </li>
          <li>
            <span className="burn-dialog__list-icon">🔗</span>
            Session connection
          </li>
        </ul>

        {/* Actions */}
        <div className="burn-dialog__actions">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            isLoading={isLoading}
            leftIcon={<FlameIcon size={18} />}
          >
            Burn Chat
          </Button>
        </div>
      </div>
    </div>
  );
});
