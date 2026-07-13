import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/Toast';
import { useTonConnect } from '@/hooks/useTonConnect';
import { getProposal, getUserVote, getUserVotingPowerLockedBeyond } from '@/ton/governance';
import { formatBurn } from '@/utils/format';

import { describeLockGatedVoteUx, formatStartsInRemaining } from './governanceUi';
import { useGovernanceState } from './GovernanceStateProvider';
import styles from './Governance.module.css';

/** Poll interval while waiting for on-chain vote indexing after TonConnect accept. */
const VOTE_CONFIRM_POLL_MS = 4_000;
/** Max poll attempts (~60 s) before surfacing an inconclusive outcome. */
const VOTE_CONFIRM_MAX_ATTEMPTS = 15;

export type LockGatedVpState =
  | { status: 'loading' }
  | { status: 'ready'; vp: bigint }
  | { status: 'error' };

export interface VoteModalProps {
  open: boolean;
  proposalId: number;
  support: boolean;
  onClose(): void;
  onComplete?(): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pollVoteRecorded(
  proposalId: number,
  support: boolean,
  address: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < VOTE_CONFIRM_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(VOTE_CONFIRM_POLL_MS);
    }
    try {
      const vote = await getUserVote(proposalId, address);
      if (vote !== null && vote.support === support) {
        return true;
      }
    } catch {
      // Transient API/network errors — keep polling until timeout.
    }
  }
  return false;
}

/**
 * Confirms governance vote side with lock-gated VP summary and irreversibility warning.
 * After TonConnect accepts the tx, polls on-chain vote state instead of
 * treating wallet acceptance as final confirmation.
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
  const { walletAddress } = useTonConnect();
  const { vote, votingPower, proposals } = useGovernanceState();
  const [phase, setPhase] = useState<VotePhase>('idle');
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [lockGatedVp, setLockGatedVp] = useState<LockGatedVpState>({ status: 'loading' });
  const [lockGatedFetchGen, setLockGatedFetchGen] = useState(0);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const retryLockGatedVp = useCallback((): void => {
    setLockGatedFetchGen((g) => g + 1);
  }, []);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setLockGatedVp({ status: 'loading' });
      return;
    }
    setNowSec(Math.floor(Date.now() / 1000));
    const tick = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(tick);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const fromList = proposals.find((p) => p.id === proposalId);
    if (fromList !== undefined && fromList.startTime > 0) {
      setStartTime(fromList.startTime);
      setEndTime(fromList.endTime);
      return;
    }
    let cancelled = false;
    void getProposal(proposalId)
      .then((detail) => {
        if (!cancelled) {
          setStartTime(detail.summary.startTime);
          setEndTime(detail.summary.endTime);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, proposalId, proposals]);

  useEffect(() => {
    if (!open || endTime <= 0) {
      return;
    }
    const addr = walletAddress?.trim();
    if (!addr) {
      setLockGatedVp({ status: 'ready', vp: 0n });
      return;
    }
    let cancelled = false;
    setLockGatedVp({ status: 'loading' });
    void getUserVotingPowerLockedBeyond(addr, endTime)
      .then((vp) => {
        if (!cancelled) {
          setLockGatedVp({ status: 'ready', vp });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLockGatedVp({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, endTime, walletAddress, lockGatedFetchGen]);

  const isPreVoteWindow = useMemo(
    () => startTime > 0 && nowSec < startTime,
    [startTime, nowSec],
  );

  const voteUx = useMemo(() => {
    if (lockGatedVp.status !== 'ready') {
      return { kind: 'no-stake' as const, displayVp: 0n, showFlexibleHint: false };
    }
    return describeLockGatedVoteUx({
      liveVp: votingPower,
      lockGatedVp: lockGatedVp.vp,
    });
  }, [votingPower, lockGatedVp]);

  const cannotCast =
    isPreVoteWindow ||
    lockGatedVp.status !== 'ready' ||
    voteUx.kind === 'flexible-only' ||
    voteUx.displayVp <= 0n;

  const busy = phase !== 'idle';

  if (!open) {
    return null;
  }

  const sideLabel = support ? t('governance.voteSideFor') : t('governance.voteSideAgainst');

  const handleConfirm = async (): Promise<void> => {
    if (cannotCast || endTime <= 0) {
      return;
    }
    const addr = walletAddress?.trim();
    if (!addr) {
      toast.error(t('governance.voteDisabledNeedWallet'));
      return;
    }

    setPhase('sending');
    try {
      const res = await vote({ proposalId, support, endTimeSec: endTime });
      if (!res.ok) {
        toast.error(res.message && res.message.length > 0 ? res.message : t('governance.voteFail'));
        return;
      }

      toast.info(t('governance.voteSubmitted'));
      setPhase('confirming');

      const recorded = await pollVoteRecorded(proposalId, support, addr);
      onComplete?.();

      if (recorded) {
        toast.success(t('governance.voteConfirmed'));
        onClose();
      } else {
        toast.warning(t('governance.voteNotRecorded'));
        onClose();
      }
    } finally {
      setPhase('idle');
    }
  };

  const confirmLabel =
    phase === 'sending'
      ? t('governance.voteModalSending')
      : phase === 'confirming'
        ? t('governance.voteConfirming')
        : t('governance.voteModalConfirm');

  const displayVpLabel =
    lockGatedVp.status === 'loading'
      ? '…'
      : lockGatedVp.status === 'error'
        ? '—'
        : formatBurn(voteUx.displayVp);

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
        aria-label={t('governance.ariaModalVote')}
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
          {t('governance.voteModalVp')}: <strong>{displayVpLabel}</strong>
        </p>
        {lockGatedVp.status === 'error' ? (
          <p className={styles.errorBanner} role="alert">
            {t('governance.errorLoad')}{' '}
            <button type="button" className={styles.inlineLink} onClick={retryLockGatedVp}>
              {t('governance.retry')}
            </button>
          </p>
        ) : null}
        {voteUx.showFlexibleHint ? (
          <div className={styles.warnBanner} role="status">
            <p className={styles.modalBody}>{t('governance.voteFlexibleNoVp')}</p>
            <p className={styles.muted}>{t('governance.voteFlexibleHint')}</p>
            <Link className={styles.backLink} to="/app/staking" onClick={onClose}>
              {t('governance.voteFlexibleOpenStaking')}
            </Link>
          </div>
        ) : null}
        {isPreVoteWindow ? (
          <>
            <p className={styles.modalWarn}>{t('governance.voteNotOpenYet')}</p>
            <p className={styles.muted}>{formatStartsInRemaining(startTime, t, nowSec)}</p>
          </>
        ) : (
          <p className={styles.modalWarn}>{t('governance.voteModalFinalWarning')}</p>
        )}
        {phase === 'confirming' ? (
          <p className={styles.muted} role="status">
            {t('governance.voteConfirmingHint')}
          </p>
        ) : null}
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} disabled={busy} onClick={onClose}>
            {t('governance.voteModalCancel')}
          </button>
          <button
            type="button"
            className={support ? styles.voteForBtn : styles.voteAgainstBtn}
            disabled={busy || cannotCast}
            onClick={() => void handleConfirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type VotePhase = 'idle' | 'sending' | 'confirming';
