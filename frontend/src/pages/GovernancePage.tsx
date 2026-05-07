import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { GovernanceStateProvider } from '@/components/Governance/GovernanceStateProvider';
import styles from '@/components/Governance/Governance.module.css';
import { useGovernance } from '@/hooks/useGovernance';
import { useTonConnect } from '@/hooks/useTonConnect';
import { formatBurn } from '@/utils/format';

/**
 * Governance routes shell: shared polling via {@link useGovernance} + VP header.
 */
export function GovernancePage() {
  const { t } = useTranslation();
  const gov = useGovernance();
  const { isConnected } = useTonConnect();

  return (
    <GovernanceStateProvider value={gov}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t('governance.pageTitle')}</h1>
          <div className={styles.vpPill} aria-live="polite">
            {isConnected ? (
              <>
                <span className={styles.muted}>{t('governance.yourVp')}</span>
                <strong>{gov.votingPower > 0n ? formatBurn(gov.votingPower) : '0'}</strong>
              </>
            ) : (
              <span className={styles.muted}>{t('governance.vpUnavailable')}</span>
            )}
          </div>
        </header>
        <Outlet />
      </div>
    </GovernanceStateProvider>
  );
}
