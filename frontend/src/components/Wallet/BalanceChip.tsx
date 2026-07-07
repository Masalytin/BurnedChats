import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { useHaptics } from '@/hooks/useHaptics';
import { formatNativeCoin } from '@/ton/nativeCoin';

import { WalletContext } from './WalletProvider';
import styles from './BalanceChip.module.css';

const NANOS_PER_BURN = 10n ** 9n;

function initials(addr: string | null): string {
  if (!addr || addr.length < 3) return '…';
  const tail = addr.replace(/[^a-zA-Z0-9]/g, '').slice(-2);
  return tail.toUpperCase() || '…';
}

/** Compact BURN label for narrow header chip (K/M suffix, trimmed decimals). */
function formatBurnChip(nano: bigint): string {
  const negative = nano < 0n;
  const abs = negative ? -nano : nano;
  const intPart = abs / NANOS_PER_BURN;
  const frac = (abs % NANOS_PER_BURN).toString().padStart(9, '0').replace(/0+$/, '');

  let intDisplay: string;
  if (intPart >= 1_000_000n) {
    const val = Number(intPart) / 1_000_000;
    intDisplay = `${val >= 100 ? Math.round(val) : val.toFixed(1)}M`;
  } else if (intPart >= 1_000n) {
    const val = Number(intPart) / 1_000;
    intDisplay = `${val >= 100 ? Math.round(val) : val.toFixed(1)}K`;
  } else {
    intDisplay = intPart.toString();
  }

  const fracDisplay = frac.length && intPart < 1_000n ? `.${frac.slice(0, 1)}` : '';
  return `${negative ? '−' : ''}${intDisplay}${fracDisplay} BURN`;
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

  const { burn, tonBalance } = wallet;

  const balLabel =
    burn.balance != null
      ? formatBurnChip(burn.balance)
      : burn.isLoading && !burn.error
        ? t('wallet.balanceLoading')
        : `— ${t('wallet.burnSymbol')}`;

  const gramInitialLoading = tonBalance.isLoading && tonBalance.nano == null;
  const gramAmount =
    tonBalance.nano != null && !gramInitialLoading
      ? formatNativeCoin(tonBalance.nano)
      : null;
  const gramSuffix = gramAmount ? t('wallet.chipGramSuffix', { amount: gramAmount }) : '';

  const chipLabel = gramSuffix ? `${balLabel}${gramSuffix}` : balLabel;

  return (
    <button
      type="button"
      className={styles.chip}
      onClick={handleClick}
      aria-label={t('wallet.openWalletAria', {
        address: wallet.ton.walletAddress ?? '',
        balance: balLabel,
        gramSuffix,
      })}
      aria-haspopup="dialog"
    >
      <span className={styles.chipAvatar} aria-hidden>
        {initials(wallet.ton.walletAddress)}
      </span>
      <span className={styles.chipLabel}>{chipLabel}</span>
    </button>
  );
}
