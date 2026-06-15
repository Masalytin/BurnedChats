import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { calculateProposalProgress } from '@/ton/governance';
import { ProposalState, ProposalType, type ProposalSummary, type UserVote } from '@/types/ton';
import { formatEndsInRemaining, truncateMiddle } from './governanceUi';
import styles from './Governance.module.css';

function typeBadgeClass(type: ProposalType): string {
  switch (type) {
    case ProposalType.ParameterChange:
      return styles.badgeParameter;
    case ProposalType.FeaturePriority:
      return styles.badgeFeature;
    case ProposalType.TreasurySpend:
      return styles.badgeTreasury;
    case ProposalType.Emergency:
      return styles.badgeEmergency;
    default:
      return styles.badgeNeutral;
  }
}

function stateBadgeClass(state: ProposalState): string {
  switch (state) {
    case ProposalState.Active:
      return styles.stateActive;
    case ProposalState.Succeeded:
      return styles.statePassed;
    case ProposalState.Defeated:
      return styles.stateDefeated;
    case ProposalState.Queued:
      return styles.stateQueued;
    case ProposalState.Executed:
      return styles.stateExecuted;
    default:
      return styles.stateOther;
  }
}

function proposalStateLabel(state: ProposalState, t: (k: string) => string): string {
  switch (state) {
    case ProposalState.Active:
      return t('governance.proposalState.active');
    case ProposalState.Succeeded:
      return t('governance.proposalState.succeeded');
    case ProposalState.Defeated:
      return t('governance.proposalState.defeated');
    case ProposalState.Queued:
      return t('governance.proposalState.queued');
    case ProposalState.Executed:
      return t('governance.proposalState.executed');
    case ProposalState.Cancelled:
      return t('governance.proposalState.cancelled');
    default:
      return t('governance.proposalState.unknown');
  }
}

function proposalTypeLabel(type: ProposalType, t: (k: string) => string): string {
  switch (type) {
    case ProposalType.ParameterChange:
      return t('governance.proposalType.parameterChange');
    case ProposalType.FeaturePriority:
      return t('governance.proposalType.featurePriority');
    case ProposalType.TreasurySpend:
      return t('governance.proposalType.treasurySpend');
    case ProposalType.Emergency:
      return t('governance.proposalType.emergency');
    default:
      return t('governance.proposalType.unknown');
  }
}

export interface ProposalCardProps {
  proposal: ProposalSummary;
  userVote?: UserVote;
}

export function ProposalCard({ proposal, userVote }: ProposalCardProps) {
  const { t } = useTranslation();
  const progress = calculateProposalProgress(proposal);
  const now = Math.floor(Date.now() / 1000);
  const timing =
    proposal.state === ProposalState.Active && progress.timeRemainingSec > 0
      ? formatEndsInRemaining(proposal.endTime, t, now)
      : t('governance.ended');

  const cast = proposal.forVotes + proposal.againstVotes;
  const miniDenom = cast > 0n ? cast : 1n;
  const forMini = cast > 0n ? Number((proposal.forVotes * 10000n) / miniDenom) / 100 : 50;

  return (
    <Link
      className={styles.cardLink}
      to={`/app/governance/${proposal.id}`}
      aria-label={t('governance.openProposal', { id: proposal.id })}
    >
      <article className={styles.card}>
        <div className={styles.cardTop}>
          <span className={`${styles.typeBadge} ${typeBadgeClass(proposal.type)}`}>
            {proposalTypeLabel(proposal.type, t)}
          </span>
          <span className={`${styles.stateBadge} ${stateBadgeClass(proposal.state)}`}>
            {proposalStateLabel(proposal.state, t)}
          </span>
        </div>
        <h3 className={styles.cardTitle}>{proposal.title || `#${proposal.id}`}</h3>
        <div className={styles.cardMeta}>
          <span>{truncateMiddle(proposal.proposer)}</span>
          <span className={styles.cardDot} aria-hidden>
            ·
          </span>
          <time dateTime={new Date(proposal.startTime * 1000).toISOString()}>
            {new Date(proposal.startTime * 1000).toLocaleDateString()}
          </time>
        </div>
        <div className={styles.miniBar} aria-hidden>
          <div
            className={styles.miniBarSegment}
            style={{ '--bar-flex': forMini } as React.CSSProperties}
          >
            <div className={`${styles.miniBarFill} ${styles.miniBarFor}`} />
          </div>
          <div
            className={styles.miniBarSegment}
            style={{ '--bar-flex': 100 - forMini } as React.CSSProperties}
          >
            <div className={`${styles.miniBarFill} ${styles.miniBarAgainst}`} />
          </div>
          {proposal.quorumRequired > 0n && cast > 0n ? (
            <span
              className={styles.miniBarQuorum}
              style={{
                left: `${Math.min(100, Number((proposal.quorumRequired * 10000n) / (proposal.quorumRequired > cast ? proposal.quorumRequired : cast)) / 100)}%`,
              }}
            />
          ) : null}
        </div>
        <div className={styles.cardFooter}>
          <span>{timing}</span>
          {userVote?.support !== undefined && userVote.support !== null ? (
            <span className={styles.cardVoteHint}>
              {userVote.support ? t('governance.voteSideFor') : t('governance.voteSideAgainst')}
            </span>
          ) : null}
        </div>
      </article>
    </Link>
  );
}
