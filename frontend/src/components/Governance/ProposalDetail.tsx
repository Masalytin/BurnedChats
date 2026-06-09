import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { getProposal, getProposalLifecycleMeta, type ProposalLifecycleMeta } from '@/ton/governance';
import { ProposalState, ProposalType, type ProposalDetail as ProposalDetailDto } from '@/types/ton';
import { formatBurn } from '@/utils/format';
import { useTonConnect } from '@/hooks/useTonConnect';
import { useToast } from '@/components/Toast';

import { ProposalTimeline } from './ProposalTimeline';
import { VoteModal } from './VoteModal';
import { VoteProgressBar } from './VoteProgressBar';
import { formatEndsInRemaining, truncateMiddle } from './governanceUi';
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
  const toast = useToast();
  const { userVotes, refetch, queue, execute } = useGovernanceState();
  const [detail, setDetail] = useState<ProposalDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [voteOpen, setVoteOpen] = useState(false);
  const [voteSupport, setVoteSupport] = useState(true);
  const [lifecycle, setLifecycle] = useState<ProposalLifecycleMeta | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [executeBusy, setExecuteBusy] = useState(false);

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

  useEffect(() => {
    if (!Number.isFinite(id) || id < 0) {
      return;
    }
    const state = detail?.summary.state;
    if (
      state === undefined ||
      state === ProposalState.Active ||
      state === ProposalState.Defeated ||
      state === ProposalState.Cancelled ||
      state === ProposalState.Executed
    ) {
      setLifecycle(null);
      return;
    }
    let cancelled = false;
    void getProposalLifecycleMeta(id)
      .then((meta) => {
        if (!cancelled) setLifecycle(meta);
      })
      .catch(() => {
        if (!cancelled) setLifecycle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id, detail?.summary.state]);

  const summary = detail?.summary;
  const userVote = summary ? userVotes.get(summary.id) : undefined;

  const nowSec = Math.floor(Date.now() / 1000);

  const canVote = useMemo(() => {
    if (!summary) return false;
    return (
      isConnected &&
      summary.state === ProposalState.Active &&
      nowSec < summary.endTime &&
      (userVote === undefined || userVote.support === null)
    );
  }, [summary, userVote, isConnected, nowSec]);

  const executeAfterSec = useMemo(() => {
    if (!lifecycle) return 0;
    return lifecycle.succeededAt + lifecycle.timelockDelaySec;
  }, [lifecycle]);

  const timelockReady = useMemo(() => {
    if (!summary) return false;
    if (summary.type === ProposalType.FeaturePriority || summary.type === ProposalType.Emergency) {
      return true;
    }
    if (!lifecycle || executeAfterSec <= 0) {
      return false;
    }
    return nowSec >= executeAfterSec;
  }, [summary, lifecycle, executeAfterSec, nowSec]);

  const canQueue = useMemo(() => {
    if (!summary) return false;
    return isConnected && summary.state === ProposalState.Active && nowSec > summary.endTime;
  }, [summary, isConnected, nowSec]);

  const canExecute = useMemo(() => {
    if (!summary) return false;
    return (
      isConnected &&
      (summary.state === ProposalState.Succeeded || summary.state === ProposalState.Queued) &&
      timelockReady
    );
  }, [summary, isConnected, timelockReady]);

  const showExecuteWaiting = useMemo(() => {
    if (!summary || !isConnected) return false;
    return (
      (summary.state === ProposalState.Succeeded || summary.state === ProposalState.Queued) &&
      !timelockReady &&
      executeAfterSec > nowSec
    );
  }, [summary, isConnected, timelockReady, executeAfterSec, nowSec]);

  const refreshDetail = useCallback((): void => {
    void refetch();
    void getProposal(id)
      .then(setDetail)
      .catch(() => {});
  }, [refetch, id]);

  const handleQueue = async (): Promise<void> => {
    if (!summary) return;
    setQueueBusy(true);
    try {
      const res = await queue({ proposalId: summary.id });
      if (res.ok) {
        toast.success(t('governance.queueSuccess'));
        refreshDetail();
      } else {
        toast.error(res.message && res.message.length > 0 ? res.message : t('governance.queueFail'));
      }
    } finally {
      setQueueBusy(false);
    }
  };

  const handleExecute = async (): Promise<void> => {
    if (!summary) return;
    setExecuteBusy(true);
    try {
      const res = await execute({ proposalId: summary.id, proposalType: summary.type });
      if (res.ok) {
        toast.success(t('governance.executeSuccess'));
        refreshDetail();
      } else {
        toast.error(res.message && res.message.length > 0 ? res.message : t('governance.executeFail'));
      }
    } finally {
      setExecuteBusy(false);
    }
  };

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

      {(canQueue || canExecute || showExecuteWaiting) && (
        <section className={styles.section} aria-labelledby="timelock-heading">
          <h2 id="timelock-heading" className={styles.h2}>
            {t('governance.timelockSectionTitle')}
          </h2>
          <div className={styles.voteActions}>
            {canQueue ? (
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={queueBusy}
                onClick={() => void handleQueue()}
              >
                {queueBusy ? t('governance.queueSubmitting') : t('governance.queueProposal')}
              </button>
            ) : null}
            {canExecute ? (
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={executeBusy}
                onClick={() => void handleExecute()}
              >
                {executeBusy ? t('governance.executeSubmitting') : t('governance.executeProposal')}
              </button>
            ) : null}
          </div>
          {showExecuteWaiting ? (
            <p className={styles.muted}>
              {t('governance.executeWaiting', {
                remaining: formatEndsInRemaining(executeAfterSec, t, nowSec),
              })}
            </p>
          ) : null}
          {!isConnected ? <p className={styles.muted}>{t('governance.timelockDisabledNeedWallet')}</p> : null}
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.h2}>{t('governance.detailTimeline')}</h2>
        <ProposalTimeline proposal={summary} executeAfterSec={executeAfterSec > 0 ? executeAfterSec : undefined} />
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
        onComplete={refreshDetail}
      />
    </div>
  );
}
