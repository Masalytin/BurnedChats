import { useCallback, useContext, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SkeletonCard } from '@/components/Skeleton/Skeleton';
import { WalletPanel } from '@/components/Wallet/WalletPanel';
import { WalletContext } from '@/components/Wallet/WalletProvider';
import {
  readWalletSegment,
  WalletSegmentControl,
  writeWalletSegment,
  type WalletSegment,
} from '@/components/Wallet/WalletSegmentControl';
import { useTelegram } from '../hooks/useTelegram';
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
  const { selectionChanged } = useTelegram();
  const [segment, setSegment] = useState<WalletSegment>(() => readWalletSegment());

  useLayoutEffect(() => {
    if (segment === 'governance') {
      navigate('/app/governance', { replace: true });
    }
  }, [navigate, segment]);

  const handleSegmentChange = useCallback(
    (next: WalletSegment) => {
      if (next === segment) {
        return;
      }

      selectionChanged();
      writeWalletSegment(next);
      setSegment(next);

      if (next === 'governance') {
        navigate('/app/governance');
      }
    },
    [navigate, segment, selectionChanged],
  );

  if (segment === 'governance') {
    return null;
  }

  return (
    <div className="wallet-page">
      <h1 className="wallet-page__title">{t('nav.wallet')}</h1>
      <WalletSegmentControl activeSegment={segment} onChange={handleSegmentChange} />
      {segment === 'wallet' ? <WalletPanelSection /> : <StakingPage />}
    </div>
  );
}
