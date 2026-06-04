import { useTranslation } from 'react-i18next';

import type { UseBurnToken } from '@/hooks/useBurnToken';
import type { UseTonConnectResult } from '@/hooks/useTonConnect';
import { formatBurn } from '@/utils/format';
import styles from './Wallet.module.css';

export interface WalletButtonProps {
  burn: Pick<UseBurnToken, 'balance' | 'isLoading' | 'error'>;
  ton: Pick<UseTonConnectResult, 'isConnected' | 'connect' | 'walletAddress'>;
  onOpenDrawer: () => void;
}

function initials(addr: string | null): string {
  if (!addr || addr.length < 3) return '…';
  const tail = addr.replace(/[^a-zA-Z0-9]/g, '').slice(-2);
  return tail.toUpperCase() || '…';
}

/**
 * Compact header control: connect via Ton Connect or chip with BURN balance.
 */
export function WalletButton({ burn, ton, onOpenDrawer }: WalletButtonProps) {
  const { t } = useTranslation();

  if (!ton.isConnected) {
    return (
      <div className={styles.walletFab}>
        <button
          type="button"
          className={styles.connectBtn}
          onClick={() => void ton.connect()}
          aria-label={t('wallet.connectWalletAria')}
        >
          {t('wallet.connectWallet')}
        </button>
      </div>
    );
  }

  const balLabel =
    burn.balance != null
      ? formatBurn(burn.balance)
      : burn.isLoading && !burn.error
        ? t('wallet.balanceLoading')
        : `— ${t('wallet.burnSymbol')}`;

  return (
    <div className={styles.walletFab}>
      <button
        type="button"
        className={styles.chip}
        onClick={onOpenDrawer}
        aria-label={t('wallet.openWalletAria', { address: ton.walletAddress ?? '', balance: balLabel })}
        aria-haspopup="dialog"
      >
        <span className={styles.chipAvatar} aria-hidden>
          {initials(ton.walletAddress)}
        </span>
        <span>{balLabel}</span>
      </button>
    </div>
  );
}
