import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { useHaptics } from '@/hooks/useHaptics';
import { formatBurn } from '@/utils/format';

import { WalletContext } from './WalletProvider';
import styles from './BalanceChip.module.css';

function initials(addr: string | null): string {
  if (!addr || addr.length < 3) return '…';
  const tail = addr.replace(/[^a-zA-Z0-9]/g, '').slice(-2);
  return tail.toUpperCase() || '…';
}

/**
 * In-flow balance chip for Home header — opens WalletSheet on tap.
 * Renders null when wallet context is unavailable or TON is not connected.
 */
export function BalanceChip() {
  const wallet = useContext(WalletContext);
  const { t } = useTranslation();
  const { selectionChanged } = useHaptics();

  const handleClick = useCallback(() => {
    if (!wallet) return;
    selectionChanged();
    wallet.openSheet();
  }, [wallet, selectionChanged]);

  if (!wallet?.ton.isConnected) {
    return null;
  }

  const { burn, ton } = wallet;
  const balLabel =
    burn.balance != null
      ? formatBurn(burn.balance)
      : burn.isLoading && !burn.error
        ? t('wallet.balanceLoading')
        : `— ${t('wallet.burnSymbol')}`;

  return (
    <button
      type="button"
      className={styles.chip}
      onClick={handleClick}
      aria-label={t('wallet.openWalletAria', {
        address: ton.walletAddress ?? '',
        balance: balLabel,
      })}
      aria-haspopup="dialog"
    >
      <span className={styles.chipAvatar} aria-hidden>
        {initials(ton.walletAddress)}
      </span>
      <span className={styles.chipLabel}>{balLabel}</span>
    </button>
  );
}
