import { useContext, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SkeletonCard } from '@/components/Skeleton/Skeleton';
import { WalletPanel } from '@/components/Wallet/WalletPanel';
import { WalletContext } from '@/components/Wallet/WalletProvider';
import { WalletSegmentBar } from '@/components/Wallet/WalletSegmentBar';
import { readWalletSegment, type WalletSegment } from '@/components/Wallet/WalletSegmentControl';
import { RefreshIcon } from '@/icons';
import { StakingPage } from './StakingPage';
import './WalletPage.css';

function WalletRefreshButton() {
  const { t } = useTranslation();
  const walletCtx = useContext(WalletContext);

  if (!walletCtx) {
    return null;
  }

  const { refreshWallet, isRefreshing, ton } = walletCtx;

  return (
    <button
      type="button"
      className={`wallet-page__refresh-btn${isRefreshing ? ' wallet-page__refresh-btn--spinning' : ''}`}
      onClick={() => void refreshWallet()}
      disabled={!ton.isConnected || isRefreshing}
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
  const [segment, setSegment] = useState<WalletSegment>(() => readWalletSegment());

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
        {segment === 'wallet' ? <WalletRefreshButton /> : null}
      </div>
      <WalletSegmentBar activeSegment={segment} onSegmentChange={setSegment} />
      {segment === 'wallet' ? <WalletPanelSection /> : <StakingPage />}
    </div>
  );
}
