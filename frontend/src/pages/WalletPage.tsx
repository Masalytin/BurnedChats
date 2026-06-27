import { useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { StakingDashboard } from '@/components/Staking/StakingDashboard';
import { SkeletonCard } from '@/components/Skeleton/Skeleton';
import { WalletPanel } from '@/components/Wallet/WalletPanel';
import { WalletContext } from '@/components/Wallet/WalletProvider';
import { WalletSegmentBar } from '@/components/Wallet/WalletSegmentBar';
import { readWalletSegment, type WalletSegment } from '@/components/Wallet/WalletSegmentControl';
import { useWalletPageAutoRefresh } from '@/hooks/useWalletPageAutoRefresh';
import { RefreshIcon } from '@/icons';
import './WalletPage.css';

interface WalletRefreshButtonProps {
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  disabled: boolean;
}

function WalletRefreshButton({ onRefresh, isRefreshing, disabled }: WalletRefreshButtonProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={`wallet-page__refresh-btn${isRefreshing ? ' wallet-page__refresh-btn--spinning' : ''}`}
      onClick={() => void onRefresh()}
      disabled={disabled || isRefreshing}
      aria-label={t('aria.refreshWallet')}
      title={t('aria.refreshWallet')}
    >
      <RefreshIcon size={16} />
    </button>
  );
}

function WalletPanelSection() {
  const { t } = useTranslation();
  const walletCtx = useContext(WalletContext);

  if (!walletCtx) {
    return (
      <div className="wallet-page__panel-loading" aria-busy="true" aria-label={t('wallet.balanceLoading')}>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </div>
    );
  }

  return (
    <div className="wallet-page__panel">
      <WalletPanel />
    </div>
  );
}

/**
 * Wallet tab: Wallet | Staking | Governance segments (IMP-WSURF-03).
 * Governance navigates to `/app/governance`; segment choice persists in sessionStorage.
 */
export function WalletPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const walletCtx = useContext(WalletContext);
  const [segment, setSegment] = useState<WalletSegment>(() => readWalletSegment());
  const [isStakingRefreshing, setIsStakingRefreshing] = useState(false);
  const stakingRefetchRef = useRef<(() => Promise<void>) | null>(null);

  const handleStakingRefetchReady = useCallback((refetch: (() => Promise<void>) | null) => {
    stakingRefetchRef.current = refetch;
  }, []);

  const refreshWalletSegment = useCallback(async () => {
    if (!walletCtx?.ton.isConnected) {
      return;
    }
    await walletCtx.refreshWallet();
  }, [walletCtx]);

  const refreshStakingSegment = useCallback(async () => {
    if (!walletCtx?.ton.isConnected) {
      return;
    }
    setIsStakingRefreshing(true);
    try {
      const tasks: Promise<void>[] = [walletCtx.refreshWallet()];
      if (stakingRefetchRef.current) {
        tasks.push(stakingRefetchRef.current());
      }
      await Promise.all(tasks);
    } finally {
      setIsStakingRefreshing(false);
    }
  }, [walletCtx]);

  const activeRefresh = segment === 'staking' ? refreshStakingSegment : refreshWalletSegment;
  const walletIsRefreshing = walletCtx?.isRefreshing ?? false;
  const activeIsRefreshing =
    segment === 'staking' ? walletIsRefreshing || isStakingRefreshing : walletIsRefreshing;
  const refreshEnabled = walletCtx?.ton.isConnected ?? false;

  useWalletPageAutoRefresh({
    refresh: activeRefresh,
    enabled: refreshEnabled,
    isRefreshing: activeIsRefreshing,
  });

  useLayoutEffect(() => {
    if (segment === 'governance') {
      navigate('/app/governance', { replace: true });
    }
  }, [navigate, segment]);

  if (segment === 'governance') {
    return null;
  }

  return (
    <div className="wallet-page">
      <div className="wallet-page__header">
        <h1 className="wallet-page__title">{t('nav.wallet')}</h1>
        {segment === 'wallet' || segment === 'staking' ? (
          <WalletRefreshButton
            onRefresh={activeRefresh}
            isRefreshing={activeIsRefreshing}
            disabled={!refreshEnabled}
          />
        ) : null}
      </div>
      <WalletSegmentBar activeSegment={segment} onSegmentChange={setSegment} />
      {segment === 'wallet' ? (
        <WalletPanelSection />
      ) : (
        <StakingDashboard onRefetchReady={handleStakingRefetchReady} />
      )}
    </div>
  );
}
