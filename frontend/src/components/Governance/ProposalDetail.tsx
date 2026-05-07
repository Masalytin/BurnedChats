import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { getProposal } from '@/ton/governance';
import { ProposalState, ProposalType, type ProposalDetail as ProposalDetailDto } from '@/types/ton';
import { formatBurn } from '@/utils/format';
import { useTonConnect } from '@/hooks/useTonConnect';

import { ProposalTimeline } from './ProposalTimeline';
import { VoteModal } from './VoteModal';
import { VoteProgressBar } from './VoteProgressBar';
import { truncateMiddle } from './governanceUi';
import { useGovernanceState } from './GovernanceStateProvider';
import styles from './Governance.module.css';

const TG_BOT = String(import.meta.env.VITE_TELEGRAM_BOT_URL ?? 'https://t.me/BurnedChatsBot').trim();

function bigIntish(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  return 0n;
}

function DecodedPayloadView({
  decoded,
  proposalType,
}: {
  decoded: unknown;
  proposalType: ProposalType;
}) {
  const { t } = useTranslation();

  if (decoded === null || decoded === undefined) {
    return <p className={styles.muted}>—</p>;
  }

  if (typeof decoded !== 'object') {
    return (
      <pre className={styles.pre}>{typeof decoded === 'string' ? decoded : JSON.stringify(decoded, null, 2)}</pre>
    );
  }

  const o = decoded as Record<string, unknown>;

  if ('treasuryRaw' in o && 'recipientRaw' in o) {
    const amount = bigIntish(o.amountNano ?? o.amount);
    const reason = String(o.reason ?? '');
    return (
      <div className={styles.payloadBox}>
        <p className={styles.payloadLead}>
          {t('governance.payloadTreasury', {
            amount: formatBurn(amount),
            recipient: truncateMiddle(String(o.recipientRaw ?? '')),
          })}
        </p>
        <p>
          <strong>{t('governance.payloadTreasuryReason')}:</strong> {reason || '—'}
        </p>
      </div>
    );
  }

  if ('targetRaw' in o && 'methodId' in o && 'reason' in o) {
    return (
      <div className={styles.payloadBox}>
        <span className={styles.emergencyBadge}>{t('governance.proposalType.emergency')}</span>
        <p className={styles.payloadLead}>
          {t('governance.payloadEmergency', {
            target: truncateMiddle(String(o.targetRaw ?? '')),
            method: String(o.methodId ?? ''),
          })}
        </p>
        <p>
          <strong>{t('governance.payloadEmergencyReason')}:</strong> {String(o.reason ?? '')}
        </p>
        <p className={styles.muted}>{t('governance.payloadArgsNote')}</p>
      </div>
    );
  }

  if ('targetRaw' in o && 'methodId' in o) {
    return (
      <div className={styles.payloadBox}>
        <p className={styles.payloadLead}>
          {t('governance.payloadParameterLine', {
            target: truncateMiddle(String(o.targetRaw ?? '')),
            method: String(o.methodId ?? ''),
          })}
        </p>
        <p className={styles.muted}>{t('governance.payloadArgsNote')}</p>
      </div>
    );
  }

  if ('description' in o || proposalType === ProposalType.FeaturePriority) {
    const desc = String(o.description ?? '');
    const cid = String(o.cid ?? '');
    return (
      <div className={styles.payloadBox}>
        <p className={styles.fieldLabel}>{t('governance.payloadFeatureBody')}</p>
        <div className={styles.mdWrap}>
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{desc || '_'}</ReactMarkdown>
        </div>
        {cid ? (
          <p className={styles.muted}>
            {t('governance.payloadCid')}: {cid}
          </p>
        ) : null}
      </div>
    );
  }

  return <pre className={styles.pre}>{JSON.stringify(decoded, null, 2)}</pre>;
}

export function ProposalDetail() {
  const { t } = useTranslation();
  const { proposalId: rawId } = useParams();
  const id = Number(rawId ?? 'NaN');
  const { isConnected } = useTonConnect();
  const { userVotes, refetch } = useGovernanceState();
  const [detail, setDetail] = useState<ProposalDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [voteOpen, setVoteOpen] = useState(false);
  const [voteSupport, setVoteSupport] = useState(true);

  useEffect(() => {
    if (!Number.isFinite(id) || id < 0) {
      setLoading(false);
      setLoadErr('bad id');
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getProposal(id)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setLoadErr(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setLoadErr(t('governance.errorLoad'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  const summary = detail?.summary;
  const userVote = summary ? userVotes.get(summary.id) : undefined;

  const canVote = useMemo(() => {
    if (!summary) return false;
    return (
      isConnected &&
      summary.state === ProposalState.Active &&
      Math.floor(Date.now() / 1000) < summary.endTime &&
      (userVote === undefined || userVote.support === null)
    );
  }, [summary, userVote, isConnected]);

  const openVote = (support: boolean): void => {
    setVoteSupport(support);
    setVoteOpen(true);
  };

  const headerType = (type: ProposalType): string => {
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
  };

  const headerState = (state: ProposalState): string => {
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
  };

  const stateBadgeStyleFn = (state: ProposalState): string => {
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
  };

  if (!Number.isFinite(id) || id < 0) {
    return (
      <p className={styles.errorBanner}>
        <Link to="/app/governance">{t('governance.backToList')}</Link>
      </p>
    );
  }

  if (loading) {
    return <p className={styles.muted}>{t('governance.loadingDetail')}</p>;
  }

  if (!summary || !detail || loadErr) {
    return (
      <div className={styles.empty}>
        <p>{loadErr ?? '—'}</p>
        <Link className={styles.primaryBtn} to="/app/governance">
          {t('governance.backToList')}
        </Link>
      </div>
    );
  }

  const voteSummary = t('governance.votesSummary', {
    forAmount: formatBurn(summary.forVotes),
    againstAmount: formatBurn(summary.againstVotes),
  });

  return (
    <div className={styles.detailRoot}>
      <Link className={styles.backLink} to="/app/governance">
        {t('governance.backToList')}
      </Link>

      <header className={styles.detailHeader}>
        <div className={styles.detailBadges}>
          <span className={`${styles.typeBadge} ${styles.badgeNeutral}`}>{headerType(summary.type)}</span>
          <span className={`${styles.stateBadge} ${stateBadgeStyleFn(summary.state)}`}>
            {headerState(summary.state)}
          </span>
        </div>
        <h1 className={styles.detailTitle}>{summary.title || `#${summary.id}`}</h1>
        <p className={styles.detailMeta}>
          #{summary.id}
          <span className={styles.cardDot} aria-hidden>
            {' '}
            ·{' '}
          </span>
          {truncateMiddle(summary.proposer)}
        </p>
      </header>

      <section className={styles.section} aria-labelledby="payload-heading">
        <h2 id="payload-heading" className={styles.h2}>
          {t('governance.createReviewPayload')}
        </h2>
        <DecodedPayloadView decoded={detail.decodedPayload} proposalType={summary.type} />
      </section>

      <section className={styles.section} aria-labelledby="vote-heading">
        <h2 id="vote-heading" className={styles.h2}>
          {t('governance.progressVotesCast')}
        </h2>
        <p className={styles.muted}>{voteSummary}</p>
        <VoteProgressBar proposal={summary} variant="large" />
        {userVote?.support !== undefined && userVote.support !== null ? (
          <p className={styles.votedLine}>
            {t('governance.voteAlready', {
              side: userVote.support ? t('governance.voteSideFor') : t('governance.voteSideAgainst'),
              vp: formatBurn(userVote.vp),
            })}
          </p>
        ) : null}
        <div className={styles.voteActions}>
          <button type="button" className={styles.voteForBtn} disabled={!canVote} onClick={() => openVote(true)}>
            {t('governance.voteFor')}
          </button>
          <button
            type="button"
            className={styles.voteAgainstBtn}
            disabled={!canVote}
            onClick={() => openVote(false)}
          >
            {t('governance.voteAgainst')}
          </button>
        </div>
        {!isConnected ? <p className={styles.muted}>{t('governance.voteDisabledNeedWallet')}</p> : null}
        {summary.state !== ProposalState.Active ? (
          <p className={styles.muted}>{t('governance.voteDisabledEnded')}</p>
        ) : null}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>{t('governance.detailTimeline')}</h2>
        <ProposalTimeline proposal={summary} />
      </section>

      <section className={styles.section} aria-labelledby="comments-heading">
        <h2 id="comments-heading" className={styles.h2}>
          {t('governance.commentsTitle')}
        </h2>
        <p className={styles.muted}>{t('governance.commentsHint')}</p>
        <a className={styles.primaryBtn} href={TG_BOT} target="_blank" rel="noreferrer">
          {t('governance.commentsOpen')}
        </a>
      </section>

      <VoteModal
        open={voteOpen}
        proposalId={summary.id}
        support={voteSupport}
        onClose={() => setVoteOpen(false)}
        onComplete={() => {
          void refetch();
          void getProposal(id)
            .then(setDetail)
            .catch(() => {});
        }}
      />
    </div>
  );
}
