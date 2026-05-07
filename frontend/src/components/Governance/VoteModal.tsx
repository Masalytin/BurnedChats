import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/Toast';
import { formatBurn } from '@/utils/format';

import { useGovernanceState } from './GovernanceStateProvider';
import styles from './Governance.module.css';

export interface VoteModalProps {
  open: boolean;
  proposalId: number;
  support: boolean;
  onClose(): void;
  onComplete?(): void;
}

/**
 * Confirms governance vote side with VP summary and irreversibility warning.
 */
export function VoteModal({
  open,
  proposalId,
  support,
  onClose,
  onComplete,
}: VoteModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { vote, votingPower } = useGovernanceState();
  const [busy, setBusy] = useState(false);

  if (!open) {
    return null;
  }

  const sideLabel = support ? t('governance.voteSideFor') : t('governance.voteSideAgainst');

  const handleConfirm = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await vote({ proposalId, support });
      if (res.ok) {
        toast.success(t('governance.voteSuccess'));
        onComplete?.();
        onClose();
      } else {
        toast.error(res.message && res.message.length > 0 ? res.message : t('governance.voteFail'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onClick={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modalSheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vote-modal-title"
        aria-describedby="vote-modal-desc"
      >
        <h2 id="vote-modal-title" className={styles.modalTitle}>
          {t('governance.voteModalTitle')}
        </h2>
        <p id="vote-modal-desc" className={styles.modalBody}>
          {t('governance.voteModalSide', { side: sideLabel })}
        </p>
        <p className={styles.modalMeta}>
          {t('governance.voteModalVp')}: <strong>{formatBurn(votingPower)}</strong>
        </p>
        <p className={styles.modalWarn}>{t('governance.voteModalFinalWarning')}</p>
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} disabled={busy} onClick={onClose}>
            {t('governance.voteModalCancel')}
          </button>
          <button
            type="button"
            className={support ? styles.voteForBtn : styles.voteAgainstBtn}
            disabled={busy}
            onClick={() => void handleConfirm()}
          >
            {busy ? t('governance.voteModalSending') : t('governance.voteModalConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
