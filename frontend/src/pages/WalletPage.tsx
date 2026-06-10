import { useTranslation } from 'react-i18next';
import { StakingPage } from './StakingPage';

/**
 * Wallet tab page (stub until IMP-NAV-03 adds segment switcher).
 */
export function WalletPage() {
  const { t } = useTranslation();

  return (
    <div className="wallet-page">
      <h1 className="wallet-page__title">{t('nav.wallet')}</h1>
      <StakingPage />
    </div>
  );
}
