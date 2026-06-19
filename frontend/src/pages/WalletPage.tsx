import { useContext, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SkeletonCard } from '@/components/Skeleton/Skeleton';
import { WalletPanel } from '@/components/Wallet/WalletPanel';
import { WalletContext } from '@/components/Wallet/WalletProvider';
import { WalletSegmentBar } from '@/components/Wallet/WalletSegmentBar';
import { readWalletSegment, type WalletSegment } from '@/components/Wallet/WalletSegmentControl';
import { StakingPage } from './StakingPage';
import './WalletPage.css';

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
      <h1 className="wallet-page__title">{t('nav.wallet')}</h1>
      <WalletSegmentBar activeSegment={segment} onSegmentChange={setSegment} />
      {segment === 'wallet' ? <WalletPanelSection /> : <StakingPage />}
    </div>
  );
}
