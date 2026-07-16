import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonCard } from '@/components/Skeleton/Skeleton';
import { WalletPanel } from '@/components/Wallet/WalletPanel';
import { WalletContext } from '@/components/Wallet/WalletProvider';
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

/** Wallet tab: balance + send BURN (IMP-TOKSIM-05). */
export function WalletPage() {
  const { t } = useTranslation();
  const walletCtx = useContext(WalletContext);

  const refreshWallet = useCallback(async () => {
    if (!walletCtx?.ton.isConnected) {
      return;
    }
    await walletCtx.refreshWallet();
  }, [walletCtx]);

  const walletIsRefreshing = walletCtx?.isRefreshing ?? false;
  const refreshEnabled = walletCtx?.ton.isConnected ?? false;

  useWalletPageAutoRefresh({
    refresh: refreshWallet,
    enabled: refreshEnabled,
    isRefreshing: walletIsRefreshing,
  });

  return (
    <div className="wallet-page">
      <div className="wallet-page__header">
        <h1 className="wallet-page__title">{t('nav.wallet')}</h1>
        <WalletRefreshButton
          onRefresh={refreshWallet}
          isRefreshing={walletIsRefreshing}
          disabled={!refreshEnabled}
        />
      </div>
      <WalletPanelSection />
    </div>
  );
}
