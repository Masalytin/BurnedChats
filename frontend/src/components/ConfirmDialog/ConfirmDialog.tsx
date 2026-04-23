import { memo, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { useHaptics } from '@/hooks/useHaptics';
import './ConfirmDialog.css';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  warning?: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  isLoading?: boolean;
  icon?: ReactNode;
}

/**
 * Reusable confirmation dialog (overlay + title, description, warning, actions).
 * Used for Leave room and can be used for other confirm flows.
 */
export const ConfirmDialog = memo(function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  warning,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  isLoading = false,
  icon,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const haptics = useHaptics();
  const cancelLabelResolved = cancelLabel ?? t('common.cancel');
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      haptics.impact('medium');
    }
  }, [isOpen, haptics]);

  useEffect(() => {
    if (!isOpen || isLoading || variant !== 'destructive') {
      return;
    }
    const id = globalThis.setTimeout(() => {
      confirmButtonRef.current?.focus();
    }, 100);
    return () => {
      clearTimeout(id);
    };
  }, [isOpen, isLoading, variant]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, isLoading, onClose]);

  const handleOverlayClick = useCallback(() => {
    if (!isLoading) {
      onClose();
    }
  }, [isLoading, onClose]);

  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="confirm-dialog-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? 'confirm-dialog-description' : undefined}
    >
      <div className="confirm-dialog animate-slide-up" onClick={handleDialogClick}>
        {icon != null && <div className="confirm-dialog__icon">{icon}</div>}
        <h3 id="confirm-dialog-title" className="confirm-dialog__title">
          {title}
        </h3>
        {description && (
          <p id="confirm-dialog-description" className="confirm-dialog__text">
            {description}
          </p>
        )}
        {warning && (
          <p className="confirm-dialog__warning">{warning}</p>
        )}
        <div className="confirm-dialog__actions">
          <Button variant="secondary" onClick={onClose} disabled={isLoading} fullWidth>
            {cancelLabelResolved}
          </Button>
          <Button
            ref={confirmButtonRef}
            variant={variant === 'destructive' ? 'destructive' : 'primary'}
            onClick={onConfirm}
            isLoading={isLoading}
            fullWidth
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
});
