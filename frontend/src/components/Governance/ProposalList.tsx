import { ScrollText } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { SkeletonCard } from '@/components/Skeleton';

import { useTonConnect } from '@/hooks/useTonConnect';
import { GovernanceError, getRecentProposals } from '@/ton/governance';
import { type ProposalSummary } from '@/types/ton';

import { ProposalCard } from './ProposalCard';
import {
  filterProposalsForTab,
  sortProposals,
  type FilterTab,
  type SortMode,
} from './governanceUi';
import { useGovernanceState } from './GovernanceStateProvider';
import styles from './Governance.module.css';

const TAB_KEYS: FilterTab[] = ['active', 'recent', 'my-votes', 'my-proposals'];

export function ProposalList() {
  const { t } = useTranslation();
  const { walletAddress, isConnected } = useTonConnect();
  const { proposals, userVotes, votingPower, isLoading, error, refetch } = useGovernanceState();
  const [tab, setTab] = useState<FilterTab>('active');
  const [sort, setSort] = useState<SortMode>('newest');
  const [recent, setRecent] = useState<ProposalSummary[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  const votedIds = useMemo(() => new Set(userVotes.keys()), [userVotes]);

  const loadRecent = useCallback(async (): Promise<void> => {
    setRecentLoading(true);
    try {
      const rows = await getRecentProposals(60);
      setRecent(rows);
    } catch {
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'recent' || tab === 'my-votes' || tab === 'my-proposals') {
      void loadRecent();
    }
  }, [tab, loadRecent]);

  const nowSec = Math.floor(Date.now() / 1000);
  const filtered = useMemo(() => {
    const rows = filterProposalsForTab(tab, proposals, recent, walletAddress, votedIds);
    return sortProposals(sort, rows, nowSec);
  }, [tab, proposals, recent, walletAddress, votedIds, sort, nowSec]);

  const showStakeHint = isConnected && votingPower > 0n;

  const tabLabel = (key: FilterTab): string => {
    switch (key) {
      case 'active':
        return t('governance.tabActive');
      case 'recent':
        return t('governance.tabRecent');
      case 'my-votes':
        return t('governance.tabMyVotes');
      case 'my-proposals':
        return t('governance.tabMyProposals');
      default:
        return key;
    }
  };

  const emptyCopy = (): string => {
    switch (tab) {
      case 'active':
        return t('governance.emptyActive');
      case 'recent':
        return t('governance.emptyRecent');
      case 'my-votes':
        return t('governance.emptyMyVotes');
      case 'my-proposals':
        return t('governance.emptyMyProposals');
      default:
        return '';
    }
  };

  const listBusy = isLoading || (tab === 'recent' && recentLoading);
  const notConfigured = error instanceof GovernanceError && error.code === 'CONFIG';

  return (
    <div className={styles.listRoot}>
      <div className={styles.toolbar}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label={t('governance.ariaProposalTabs')}
        >
          {TAB_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? styles.tabActiveBtn : styles.tabBtn}
              onClick={() => setTab(key)}
            >
              {tabLabel(key)}
            </button>
          ))}
        </div>
        <label className={styles.sortLabel}>
          <span className={styles.muted}>{t('governance.sortLabel')}</span>
          <select
            aria-label={t('governance.ariaSortProposals')}
            className={styles.sortSelect}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
          >
            <option value="newest">{t('governance.sortNewest')}</option>
            <option value="most-voted">{t('governance.sortMostVoted')}</option>
            <option value="ending-soon">{t('governance.sortEndingSoon')}</option>
          </select>
        </label>
      </div>

      {notConfigured ? (
        <div className={styles.empty}>
          <div className={styles.emptyIllu} aria-hidden>
            <ScrollText size={48} strokeWidth={1.5} />
          </div>
          <p className={styles.emptyTitle}>{t('governance.notConfiguredTitle')}</p>
          <p className={styles.muted}>{t('governance.notConfiguredHint')}</p>
        </div>
      ) : (
        <>
          <div className={styles.actionsRow}>
            <Link className={styles.primaryBtn} to="/app/governance/new">
              {t('governance.newProposal')}
            </Link>
            <button type="button" className={styles.ghostBtn} onClick={() => void refetch()}>
              {t('governance.refresh')}
            </button>
          </div>

          {error ? (
            <p className={styles.errorBanner} role="alert">
              {t('governance.errorLoad')}{' '}
              <button type="button" className={styles.inlineLink} onClick={() => void refetch()}>
                {t('governance.retry')}
              </button>
            </p>
          ) : null}

          {listBusy ? (
            <div className={styles.skeletonList} aria-busy="true" aria-label={t('governance.loadingList')}>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : null}

          {!listBusy && filtered.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIllu} aria-hidden>
                <ScrollText size={48} strokeWidth={1.5} />
              </div>
              <p>{emptyCopy()}</p>
              {showStakeHint && tab === 'active' ? (
                <Link className={styles.primaryBtn} to="/app/governance/new">
                  {t('governance.emptyCreateCta')}
                </Link>
              ) : null}
            </div>
          ) : (
            <ul className={styles.cardList}>
              {filtered.map((p) => (
                <li key={p.id}>
                  <ProposalCard proposal={p} userVote={userVotes.get(p.id)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
