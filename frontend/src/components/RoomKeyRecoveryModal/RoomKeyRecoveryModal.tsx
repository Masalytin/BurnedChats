import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { ConfirmDialog } from '../ConfirmDialog';
import './RoomKeyRecoveryModal.css';

export interface RoomKeyRecoveryModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

/**
 * Owner confirmation before bootstrap rekey after local key loss (IMP-RKR-02).
 * Explicit user intent only — no silent auto-rekey (IMP-WFT-04).
 */
export const RoomKeyRecoveryModal = memo(function RoomKeyRecoveryModal({
  open,
  onClose,
  onConfirm,
  isLoading = false,
}: RoomKeyRecoveryModalProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      isOpen={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t('room.recovery.modalTitle')}
      description={t('room.recovery.modalDescription')}
      warning={t('room.recovery.modalWarning')}
      confirmLabel={t('room.recovery.confirmButton')}
      isLoading={isLoading}
      icon={<KeyRound size={40} className="room-key-recovery-modal__icon" aria-hidden />}
    />
  );
});
