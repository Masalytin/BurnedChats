import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { GovernanceStateProvider } from '@/components/Governance/GovernanceStateProvider';
import styles from '@/components/Governance/Governance.module.css';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import { WalletSegmentBar } from '@/components/Wallet/WalletSegmentBar';
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

  const showVpSkeleton = isConnected && gov.isLoading && !gov.hasLoadedOnce;
  const showVpError = isConnected && gov.hasLoadedOnce && gov.error !== null;

  return (
    <GovernanceStateProvider value={gov}>
      <div className={styles.page}>
        <WalletSegmentBar activeSegment="governance" />
        <header className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t('governance.pageTitle')}</h1>
          <div className={styles.vpPill} aria-live="polite">
            {!isConnected ? (
              <span className={styles.muted}>{t('governance.vpUnavailable')}</span>
            ) : showVpSkeleton ? (
              <div
                className={styles.vpPillSkeleton}
                aria-busy="true"
                aria-label={t('governance.vpLoading')}
              >
                <Skeleton variant="text" width={96} height={14} />
                <Skeleton variant="text" width={72} height={18} />
              </div>
            ) : showVpError ? (
              <div className={styles.vpPillError} role="alert">
                <span className={styles.muted}>{t('governance.vpError')}</span>
                <button type="button" className={styles.inlineLink} onClick={() => void gov.refetch()}>
                  {t('governance.retry')}
                </button>
              </div>
            ) : (
              <>
                <div className={styles.vpPillMain}>
                  <span className={styles.muted}>{t('governance.yourVp')}</span>
                  <strong>{gov.votingPower > 0n ? formatBurn(gov.votingPower) : '0'}</strong>
                </div>
                <p className={styles.vpPillHint}>{t('governance.vpLockHint')}</p>
              </>
            )}
          </div>
        </header>
        <Outlet />
      </div>
    </GovernanceStateProvider>
  );
}
