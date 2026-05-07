import { useTranslation } from 'react-i18next';

import { calculateProposalProgress } from '@/ton/governance';
import type { ProposalSummary } from '@/types/ton';

import styles from './Governance.module.css';

export interface VoteProgressBarProps {
  proposal: ProposalSummary;
  variant?: 'compact' | 'large';
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

  const forWidthPct =
    cast > 0n ? Number((proposal.forVotes * 10000n) / cast) / 100 : proposal.quorumRequired > 0n ? 0 : 50;
  const againstWidthPct =
    cast > 0n ? Number((proposal.againstVotes * 10000n) / cast) / 100 : proposal.quorumRequired > 0n ? 0 : 50;

  let quorumMarkerPct: number | null = null;
  if (proposal.quorumRequired > 0n && denom > 0n) {
    quorumMarkerPct = Math.min(100, Number((proposal.quorumRequired * 10000n) / denom) / 100);
  }

  const wrapCls =
    variant === 'compact' ? `${styles.voteBarWrap} ${styles.voteBarWrapCompact}` : styles.voteBarWrap;

  return (
    <div className={wrapCls} role="group" aria-label={t('governance.ariaVoteProgress')}>
      <div className={styles.voteBarTrack} aria-hidden>
        <div className={styles.voteBarFor} style={{ width: `${forWidthPct}%` }} />
        <div className={styles.voteBarAgainst} style={{ width: `${againstWidthPct}%` }} />
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
            {proposal.quorumRequired > 0n ? ` (${progress.quorumMet ? '✓' : '…'})` : ''}
          </li>
          <li>
            {t('governance.progressThreshold')}:{' '}
            {proposal.thresholdRequired > 0n
              ? `${(Number(proposal.thresholdRequired) / 100).toFixed(2)}% FOR`
              : '—'}
            {proposal.thresholdRequired > 0n ? ` (${progress.thresholdMet ? '✓' : '…'})` : ''}
          </li>
        </ul>
      ) : null}
    </div>
  );
}
