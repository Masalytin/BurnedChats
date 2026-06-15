import { Check, Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { calculateProposalProgress } from '@/ton/governance';
import type { ProposalSummary } from '@/types/ton';

import styles from './Governance.module.css';

export interface VoteProgressBarProps {
  proposal: ProposalSummary;
  variant?: 'compact' | 'large';
}

function StatusMark({ met }: { met: boolean }) {
  if (met) {
    return (
      <span className={`${styles.statusIcon} ${styles.statusIconOk}`} aria-hidden="true">
        <Check size={14} strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className={`${styles.statusIcon} ${styles.statusIconPending}`} aria-hidden="true">
      <Ellipsis size={14} strokeWidth={2.5} />
    </span>
  );
}

/**
 * Horizontal stacked bar for FOR / AGAINST plus quorum marker when chain supplied absolute quorum VP.
 */
export function VoteProgressBar({ proposal, variant = 'large' }: VoteProgressBarProps) {
  const { t } = useTranslation();
  const progress = calculateProposalProgress(proposal);
  const cast = proposal.forVotes + proposal.againstVotes;
  const denom =
    proposal.quorumRequired > cast ? proposal.quorumRequired : cast > 0n ? cast : proposal.quorumRequired > 0n ? proposal.quorumRequired : 1n;

  const forFlex =
    cast > 0n ? Number(proposal.forVotes) : proposal.quorumRequired > 0n ? 0 : 50;
  const againstFlex =
    cast > 0n ? Number(proposal.againstVotes) : proposal.quorumRequired > 0n ? 0 : 50;

  let quorumMarkerPct: number | null = null;
  if (proposal.quorumRequired > 0n && denom > 0n) {
    quorumMarkerPct = Math.min(100, Number((proposal.quorumRequired * 10000n) / denom) / 100);
  }

  const wrapCls =
    variant === 'compact' ? `${styles.voteBarWrap} ${styles.voteBarWrapCompact}` : styles.voteBarWrap;

  return (
    <div className={wrapCls} role="group" aria-label={t('governance.ariaVoteProgress')}>
      <div className={styles.voteBarTrack} aria-hidden>
        <div
          className={styles.voteBarSegment}
          style={{ '--bar-flex': forFlex } as React.CSSProperties}
        >
          <div className={`${styles.voteBarFill} ${styles.voteBarFor}`} />
        </div>
        <div
          className={styles.voteBarSegment}
          style={{ '--bar-flex': againstFlex } as React.CSSProperties}
        >
          <div className={`${styles.voteBarFill} ${styles.voteBarAgainst}`} />
        </div>
        {quorumMarkerPct !== null ? (
          <span className={styles.voteBarQuorumLine} style={{ left: `${quorumMarkerPct}%` }} />
        ) : null}
      </div>
      <div className={styles.voteBarLegend}>
        <span className={styles.voteBarLegendFor}>
          {t('governance.progressFor')}: {progress.forPercent.toFixed(1)}%
        </span>
        <span className={styles.voteBarLegendAgainst}>
          {t('governance.progressAgainst')}: {progress.againstPercent.toFixed(1)}%
        </span>
      </div>
      {variant === 'large' ? (
        <ul className={styles.voteBarMeta}>
          <li>
            {t('governance.progressQuorum')}:{' '}
            {proposal.quorumRequired > 0n ? `${proposal.quorumRequired.toString()} VP` : '—'}
            {proposal.quorumRequired > 0n ? (
              <>
                {' '}
                (<StatusMark met={progress.quorumMet} />)
              </>
            ) : null}
          </li>
          <li>
            {t('governance.progressThreshold')}:{' '}
            {proposal.thresholdRequired > 0n
              ? `${(Number(proposal.thresholdRequired) / 100).toFixed(2)}% FOR`
              : '—'}
            {proposal.thresholdRequired > 0n ? (
              <>
                {' '}
                (<StatusMark met={progress.thresholdMet} />)
              </>
            ) : null}
          </li>
        </ul>
      ) : null}
    </div>
  );
}
