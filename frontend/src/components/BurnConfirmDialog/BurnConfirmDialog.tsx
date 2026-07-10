import { memo, useCallback, useEffect, useState } from 'react';
import { Key, Link2, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { HelpSheet, HelpTrigger } from '../HelpSheet';
import { CloseIcon, FlameIcon, AlertIcon } from '../../icons';
import { useHaptics } from '@/hooks/useHaptics';
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
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    haptics.impact('medium');
  }, [haptics]);

  /**
   * Handle escape key to close dialog.
   */
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading && !helpOpen) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isLoading, onCancel, helpOpen]);

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
          aria-label={t('common.cancel')}
          disabled={isLoading}
        >
          <CloseIcon size={20} />
        </button>

        {/* Icon */}
        <div className="burn-dialog__icon">
          <FlameIcon size={32} />
        </div>

        {/* Header */}
        <div className="burn-dialog__title-row">
          <h2 id="burn-dialog-title" className="burn-dialog__title">
            {t('burnDialog.title')}
          </h2>
          <HelpTrigger onOpen={() => setHelpOpen(true)} />
        </div>

        {/* Description */}
        <p id="burn-dialog-description" className="burn-dialog__description">
          {t('burnDialog.description', { name: peerName }).split('<1>').map((part, i) =>
            i === 0 ? part : part.split('</1>').map((inner, j) =>
              j === 0 ? <strong key={`${i}-${j}`}>{inner}</strong> : inner
            )
          )}
        </p>

        {/* Warning */}
        <div className="burn-dialog__warning">
          <AlertIcon size={16} />
          <span>{t('burnDialog.warning')}</span>
        </div>

        {/* What will be destroyed */}
        <ul className="burn-dialog__list">
          <li>
            <span className="burn-dialog__list-icon" aria-hidden>
              <Key size={18} strokeWidth={2} />
            </span>
            {t('burnDialog.listKeys')}
          </li>
          <li>
            <span className="burn-dialog__list-icon" aria-hidden>
              <MessageSquare size={18} strokeWidth={2} />
            </span>
            {t('burnDialog.listHistory')}
          </li>
          <li>
            <span className="burn-dialog__list-icon" aria-hidden>
              <Link2 size={18} strokeWidth={2} />
            </span>
            {t('burnDialog.listSession')}
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
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            isLoading={isLoading}
            leftIcon={<FlameIcon size={18} />}
          >
            {t('burnDialog.confirmButton')}
          </Button>
        </div>
      </div>

      <HelpSheet
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        topicKey="burn.about"
      />
    </div>
  );
});
