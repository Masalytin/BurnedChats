import { Coins } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useToast } from '@/components/Toast';
import { useWallet } from '@/components/Wallet/WalletProvider';
import { useStaking } from '@/hooks/useStaking';
import { useTonConnect } from '@/hooks/useTonConnect';
import { StakingTier, type StakeInfo, type TierConfig } from '@/types/ton';
import { formatBurn } from '@/utils/format';
import { formatTimeRemaining, formatTierName } from '@/utils/staking-format';
import { StakingError } from '@/ton/staking';
import type { TxResult } from '@/ton/types';

import { ApyCalculator } from './ApyCalculator';
import { RewardsCard } from './RewardsCard';
import { StakeModal } from './StakeModal';
import { TierBadge } from './TierBadge';
import { UnlockTimeline } from './UnlockTimeline';
import { UnstakeModal } from './UnstakeModal';
import styles from './Staking.module.css';

const TIER_ORDER: StakingTier[] = [
  StakingTier.Diamond,
  StakingTier.Gold,
  StakingTier.Silver,
  StakingTier.Flexible,
];

function sortConfigs(configs: TierConfig[]): TierConfig[] {
  return [...configs].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
}

function totalStakedNano(stakes: StakeInfo[]): bigint {
  return stakes.reduce((a, s) => a + s.amount, 0n);
}

function totalPendingNano(stakes: StakeInfo[]): bigint {
  return stakes.reduce((a, s) => a + s.pendingReward, 0n);
}

function formatVpScore(
  stakes: StakeInfo[],
  configs: TierConfig[],
  opts: { voteEligibleOnly?: boolean } = {},
): string {
  const mult = new Map(configs.map((c) => [c.tier, c.multiplier]));
  let score = 0;
  for (const s of stakes) {
    if (opts.voteEligibleOnly && s.tier === StakingTier.Flexible) {
      continue;
    }
    score += (Number(s.amount) / 1e9) * (mult.get(s.tier) ?? 1);
  }
  if (!Number.isFinite(score) || score === 0) {
    return '0';
  }
  if (score >= 1000) {
    return score.toFixed(0);
  }
  return score.toFixed(2);
}

function txFailMessage(r: TxResult, fallback: string): string {
  if (r.ok) {
    return fallback;
  }
  return r.message && r.message.length > 0 ? r.message : fallback;
}

/**
 * Main staking dashboard: header, tier cards, timeline, rewards.
 */
export function StakingDashboard({
  onRefetchReady,
}: {
  onRefetchReady?: (refetch: (() => Promise<void>) | null) => void;
} = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const ton = useTonConnect();
  const { burn } = useWallet();
  const {
    stakes,
    tierConfigs,
    liveTierTvls,
    tierConfigsFallback,
    pendingRewards,
    rewardsRefreshing,
    isLoading,
    error,
    refetch,
    stake,
    unstake,
    claim,
  } = useStaking();

  useEffect(() => {
    onRefetchReady?.(refetch);
    return () => onRefetchReady?.(null);
  }, [onRefetchReady, refetch]);

  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [stakeModalTier, setStakeModalTier] = useState<StakingTier>(StakingTier.Flexible);
  const [unstakeModalOpen, setUnstakeModalOpen] = useState(false);
  const [unstakeModalTier, setUnstakeModalTier] = useState<StakingTier>(StakingTier.Flexible);
  const [busyClaimTier, setBusyClaimTier] = useState<StakingTier | null>(null);
  const [busyClaimAll, setBusyClaimAll] = useState(false);
  const [rewardHighlight, setRewardHighlight] = useState(false);
  const [mainTab, setMainTab] = useState<'overview' | 'calculator'>('overview');
  const nowSec = Math.floor(Date.now() / 1000);

  const sortedConfigs = useMemo(() => sortConfigs(tierConfigs), [tierConfigs]);

  const stakeByTier = useMemo(() => {
    const m = new Map<StakingTier, StakeInfo>();
    for (const s of stakes) {
      m.set(s.tier, s);
    }
    return m;
  }, [stakes]);

  const totalStaked = totalStakedNano(stakes);
  const totalPending = totalPendingNano(stakes);
  const vpDisplay = formatVpScore(stakes, tierConfigs);
  const vpVoteEligible = formatVpScore(stakes, tierConfigs, { voteEligibleOnly: true });
  const flexibleOnlyVote = vpDisplay !== '0' && vpVoteEligible === '0';

  useEffect(() => {
    setRewardHighlight(true);
    const id = window.setTimeout(() => setRewardHighlight(false), 450);
    return () => window.clearTimeout(id);
  }, [pendingRewards]);

  const openStake = useCallback((tier: StakingTier) => {
    setStakeModalTier(tier);
    setStakeModalOpen(true);
  }, []);

  const openUnstake = useCallback((tier: StakingTier) => {
    setUnstakeModalTier(tier);
    setUnstakeModalOpen(true);
  }, []);

  const handleClaimTier = useCallback(
    async (tier: StakingTier) => {
      setBusyClaimTier(tier);
      try {
        const r = await claim({ tier });
        if (!r.ok) {
          toast.error(txFailMessage(r, t('staking.txFailed')), { title: t('staking.claimFailed') });
        } else {
          toast.success(t('staking.claimSuccess'));
        }
      } finally {
        setBusyClaimTier(null);
      }
    },
    [claim, t, toast],
  );

  const handleClaimAll = useCallback(async () => {
    setBusyClaimAll(true);
    try {
      for (const tier of TIER_ORDER) {
        const amt = pendingRewards[tier] ?? 0n;
        if (amt <= 0n) {
          continue;
        }
        const r = await claim({ tier });
        if (!r.ok) {
          toast.error(txFailMessage(r, t('staking.txFailed')), { title: t('staking.claimFailed') });
          return;
        }
      }
      toast.success(t('staking.claimAllSuccess'));
    } finally {
      setBusyClaimAll(false);
    }
  }, [claim, pendingRewards, t, toast]);

  const onConfirmStake = useCallback(
    async (tierParam: StakingTier, amount: bigint) => {
      const r = await stake({ tier: tierParam, amount });
      if (!r.ok) {
        const message =
          r.code === 'JETTON_WALLET_NOT_DEPLOYED'
            ? t('staking.noJettonWallet')
            : txFailMessage(r, t('staking.txFailed'));
        toast.error(message, { title: t('staking.stakeFailed') });
        return { ok: false };
      }
      void burn.refetch();
      return { ok: true };
    },
    [burn, stake, t, toast],
  );

  const onConfirmUnstake = useCallback(
    async (amount: bigint) => {
      const r = await unstake({ tier: unstakeModalTier, amount });
      if (!r.ok) {
        toast.error(txFailMessage(r, t('staking.txFailed')), { title: t('staking.unstakeFailed') });
        return { ok: false };
      }
      void burn.refetch();
      return { ok: true };
    },
    [burn, unstake, unstakeModalTier, t, toast],
  );

  const unstakeStake = stakeByTier.get(unstakeModalTier);
  const unstakeCfg = tierConfigs.find((c) => c.tier === unstakeModalTier);

  const existingStakeByTier = useMemo(() => {
    const p: Partial<Record<StakingTier, bigint>> = {};
    for (const s of stakes) {
      p[s.tier] = s.amount;
    }
    return p;
  }, [stakes]);

  const stakeModalExisting = stakeByTier.get(stakeModalTier)?.amount ?? 0n;
  const stakeModalPending = stakeByTier.get(stakeModalTier)?.pendingReward ?? 0n;
  const notConfigured = error instanceof StakingError && error.code === 'CONFIG';

  if (notConfigured) {
    return (
      <div className={styles.page}>
        <div className={styles.topBar}>
          <button type="button" className={styles.backBtn} onClick={() => navigate('/app')}>
            {t('staking.back')}
          </button>
          <h1 className={styles.title}>{t('staking.pageTitle')}</h1>
        </div>
        <div className={styles.banner} role="status">
          <p className={styles.textStrong}>{t('staking.notConfiguredTitle')}</p>
          <p className={`${styles.muted} ${styles.mb0}`}>
            {t('staking.notConfiguredHint')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button type="button" className={styles.backBtn} onClick={() => navigate('/app')}>
          {t('staking.back')}
        </button>
        <h1 className={styles.title}>{t('staking.pageTitle')}</h1>
      </div>

      {!ton.isConnected ? (
        <div className={styles.banner} role="status">
          <p className={`${styles.muted} ${styles.mt0}`}>
            {t('staking.connectHint')}
          </p>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void ton.connect()}>
            {t('staking.connectWallet')}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className={styles.banner} role="alert">
          <p className={`${styles.errText} ${styles.textReset}`}>
            {error.message}
          </p>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary} ${styles.mtSm}`}
            onClick={() => void refetch()}
          >
            {t('staking.retry')}
          </button>
        </div>
      ) : null}

      <div className={styles.banner}>
        <div className={styles.bannerRow}>
          <div>
            <div className={styles.statLabel}>{t('staking.headerTotalStaked')}</div>
            <div className={styles.statValue} aria-busy={isLoading || undefined}>
              {isLoading ? <span className={styles.statSkeleton} aria-hidden="true" /> : formatBurn(totalStaked)}
            </div>
          </div>
          <div>
            <div className={styles.statLabel}>{t('staking.headerTotalVp')}</div>
            <div className={styles.statValue} aria-busy={isLoading || undefined}>
              {isLoading ? <span className={styles.statSkeleton} aria-hidden="true" /> : vpDisplay}
            </div>
          </div>
          <div>
            <div className={styles.statLabel}>{t('staking.headerVoteVp')}</div>
            <div className={styles.statValue} aria-busy={isLoading || undefined}>
              {isLoading ? <span className={styles.statSkeleton} aria-hidden="true" /> : vpVoteEligible}
            </div>
          </div>
          <div>
            <div className={styles.statLabel}>{t('staking.headerPending')}</div>
            <div
              className={`${styles.statValue} ${rewardHighlight ? styles.pulse : ''}`}
              aria-live="polite"
              aria-busy={isLoading || undefined}
            >
              {isLoading ? <span className={styles.statSkeleton} aria-hidden="true" /> : formatBurn(totalPending)}
            </div>
          </div>
        </div>
      </div>

      {tierConfigsFallback ? (
        <p className={styles.errText} role="status">
          {t('staking.tierConfigFallback')}
        </p>
      ) : null}

      {flexibleOnlyVote ? (
        <p className={styles.errText} role="status">
          {t('staking.flexibleNoVoteHint')}
        </p>
      ) : null}

      {ton.isConnected && !isLoading && stakes.length === 0 ? (
        <div className={styles.banner}>
          <div className={styles.emptyIllu} aria-hidden>
            <Coins size={48} strokeWidth={1.5} />
          </div>
          <p className={styles.textStrong}>{t('staking.emptyTitle')}</p>
          <p className={styles.muted}>{t('staking.emptyHint')}</p>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${styles.mtSm}`}
            onClick={() => openStake(StakingTier.Diamond)}
          >
            {t('staking.emptyCta')}
          </button>
        </div>
      ) : null}

      <div className={styles.calcMainTabRow} role="tablist" aria-label={t('staking.calculator.mainTabsAria')}>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'overview'}
          className={`${styles.calcMainTab} ${mainTab === 'overview' ? styles.calcMainTabOn : ''}`}
          onClick={() => setMainTab('overview')}
        >
          {t('staking.calculator.tabOverview')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'calculator'}
          className={`${styles.calcMainTab} ${mainTab === 'calculator' ? styles.calcMainTabOn : ''}`}
          onClick={() => setMainTab('calculator')}
        >
          {t('staking.calculator.tabCalculator')}
        </button>
      </div>

      {mainTab === 'calculator' ? (
        <ApyCalculator
          tierConfigs={tierConfigs}
          walletBalanceNano={burn.balance}
          existingStakeByTier={existingStakeByTier}
          liveTierTvls={liveTierTvls}
          initialTier={StakingTier.Gold}
        />
      ) : null}

      {mainTab === 'overview' ? (
        <>
      <UnlockTimeline stakes={stakes} />

      <RewardsCard
        pendingRewards={pendingRewards}
        onClaimTier={handleClaimTier}
        onClaimAll={handleClaimAll}
        busyTier={busyClaimTier}
        busyAll={busyClaimAll}
        highlight={rewardHighlight}
        refreshing={rewardsRefreshing}
      />

      <h2 className={styles.sectionTitle}>{t('staking.tiersSection')}</h2>
      <div className={styles.grid}>
        {sortedConfigs.map((cfg) => {
          const s = stakeByTier.get(cfg.tier);
          const hasStake = s !== undefined && s.amount > 0n;
          const unlocked = s ? s.unlockTime <= nowSec || s.unlockTime === 0 : true;
          const lockLabel =
            s && !unlocked
              ? formatTimeRemaining(s.unlockTime, t, nowSec)
              : t('staking.unlocked');

          return (
            <article
              key={cfg.tier}
              className={`${styles.tierCard} ${cfg.tier === StakingTier.Diamond ? styles.tierCardAccent : ''}`}
              aria-labelledby={`tier-${cfg.tier}-title`}
            >
              <div className={styles.tierHead}>
                <div className={styles.tierMeta}>
                  <TierBadge tier={cfg.tier} config={cfg} id={`tier-${cfg.tier}-title`} showLockHint />
                  {hasStake && s ? (
                    <div className={`${styles.muted} ${styles.textSmMd}`}>
                      <div>
                        {t('staking.positionAmount')}: {formatBurn(s.amount)}
                      </div>
                      <div>
                        {t('staking.positionStarted')}:{' '}
                        {new Date(s.startTime * 1000).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </div>
                      <div>
                        {t('staking.positionReward')}: {formatBurn(s.pendingReward)}
                      </div>
                      <div>
                        {t('staking.positionUnlock')}: {lockLabel}
                      </div>
                    </div>
                  ) : (
                    <p className={`${styles.muted} ${styles.textReset}`}>
                      {t('staking.noStakeTier')}
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.tierActions}>
                {hasStake ? (
                  <>
                    <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => openStake(cfg.tier)}>
                      {t('staking.stakeMore')}
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnGhost}`}
                      disabled={!unlocked}
                      title={!unlocked ? t('staking.unstakeDisabledTip', { when: new Date(s!.unlockTime * 1000).toLocaleString() }) : undefined}
                      onClick={() => openUnstake(cfg.tier)}
                    >
                      {t('staking.unstake')}
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      disabled={busyClaimTier !== null || busyClaimAll || (s?.pendingReward ?? 0n) <= 0n}
                      aria-busy={busyClaimTier === cfg.tier || undefined}
                      onClick={() => void handleClaimTier(cfg.tier)}
                    >
                      {busyClaimTier === cfg.tier ? t('staking.claiming') : t('staking.claim')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={() => openStake(cfg.tier)}
                    disabled={!ton.isConnected}
                  >
                    {t('staking.stakeInto', { tier: formatTierName(cfg.tier, t) })}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      </>
      ) : null}

      <StakeModal
        open={stakeModalOpen}
        onClose={() => setStakeModalOpen(false)}
        initialTier={stakeModalTier}
        tierConfigs={tierConfigs}
        walletBalanceNano={burn.balance}
        existingStakeInTierNano={stakeModalExisting}
        liveTierTotalNano={liveTierTvls[stakeModalTier] ?? null}
        pendingRewardInTierNano={stakeModalPending}
        onConfirmStake={onConfirmStake}
      />

      <UnstakeModal
        open={unstakeModalOpen}
        onClose={() => setUnstakeModalOpen(false)}
        tier={unstakeModalTier}
        stake={unstakeStake}
        tierConfig={unstakeCfg}
        nowSec={nowSec}
        onConfirmUnstake={onConfirmUnstake}
        onSuggestClaim={() => void handleClaimTier(unstakeModalTier)}
      />
    </div>
  );
}
