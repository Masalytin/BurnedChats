import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';

import { debugLog } from '@/components/DebugPanel';
import type { UseBurnToken } from '@/hooks/useBurnToken';
import type { UseTonConnectResult } from '@/hooks/useTonConnect';
import { BurnTokenError } from '@/ton/burnToken';
import { shortenTonDisplayAddress } from '@/ton/connector';
import { formatNativeCoin, nativeCoinSymbol } from '@/ton/nativeCoin';
import { getTonBalanceNano } from '@/ton/tonBalance';
import { formatBurn } from '@/utils/format';

import { Skeleton } from '@/components/Skeleton/Skeleton';
import { balanceErrorMessage, isBalanceErrorRetryable } from './balanceErrorMessage';
import styles from './Wallet.module.css';

export interface BalanceProps {
  burn: Pick<UseBurnToken, 'balance' | 'isLoading' | 'error' | 'refetch'>;
  ton: Pick<UseTonConnectResult, 'walletAddress' | 'isConnected'>;
  onReceiveToggle: () => void;
  receiveExpanded: boolean;
  onSend: () => void;
  onHistory: () => void;
}

/**
 * Primary BURN balance + TON for gas; quick actions for receive / send / history.
 */
export function Balance({
  burn,
  ton,
  onReceiveToggle,
  receiveExpanded,
  onSend,
  onHistory,
}: BalanceProps) {
  const { t } = useTranslation();
  const [tonNano, setTonNano] = useState<bigint | null>(null);
  const [tonLoading, setTonLoading] = useState(false);
  const [tonFailed, setTonFailed] = useState(false);

  useEffect(() => {
    const addr = ton.walletAddress?.trim();
    if (!ton.isConnected || !addr) {
      setTonNano(null);
      setTonLoading(false);
      setTonFailed(false);
      return;
    }

    let cancelled = false;
    setTonLoading(true);
    setTonFailed(false);

    void getTonBalanceNano(addr)
      .then((nano) => {
        if (cancelled) return;
        setTonNano(nano);
        setTonFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTonNano(null);
        setTonFailed(true);
      })
      .finally(() => {
        if (!cancelled) setTonLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ton.isConnected, ton.walletAddress]);

  useEffect(() => {
    if (!(burn.error instanceof BurnTokenError) || burn.error.code !== 'CONFIG') {
      return;
    }
    const configured = Boolean((import.meta.env.VITE_BURN_JETTON_MASTER ?? '').trim());
    debugLog('warn', '[Wallet] BURN balance CONFIG — check VITE_BURN_JETTON_MASTER', { configured });
  }, [burn.error]);

  const showBurnRetry = burn.error != null && isBalanceErrorRetryable(burn.error) && !burn.isLoading;

  const burnLoading = burn.isLoading && burn.balance == null && burn.error == null;

  const burnLine = burnLoading
    ? null
    : burn.balance != null
      ? formatBurn(burn.balance)
      : burn.error
        ? balanceErrorMessage(burn.error, t)
        : '—';

  const tonLine = tonLoading
    ? t('wallet.balanceLoading')
    : tonFailed || tonNano == null
      ? t('wallet.tonBalanceUnavailable')
      : formatNativeCoin(tonNano);

  const addr = ton.walletAddress ?? '';
  const tonUri = addr ? `ton://transfer/${encodeURIComponent(addr)}?text=BURN` : '';

  return (
    <section aria-labelledby="wallet-balance-heading">
      <h2 id="wallet-balance-heading" className={styles.srOnly}>
        {t('wallet.balanceSectionTitle')}
      </h2>
      <div className={styles.balanceHero}>
        {burnLoading ? (
          <>
            <Skeleton
              variant="rounded"
              height={36}
              width="100%"
              className={styles.balanceSkeleton}
              animation="pulse"
            />
            <Skeleton
              variant="text"
              height={16}
              width="100%"
              className={styles.balanceSecondarySkeleton}
              animation="pulse"
            />
          </>
        ) : (
          <div className={styles.balancePrimary} role={burn.error ? 'alert' : undefined}>
            {burnLine}
          </div>
        )}
        {showBurnRetry ? (
          <button
            type="button"
            className={styles.balanceRetryBtn}
            onClick={() => void burn.refetch()}
          >
            {t('wallet.balanceRetry')}
          </button>
        ) : null}
        <div
          className={styles.balanceSecondary}
          aria-label={t('wallet.tonForGasAria', { symbol: nativeCoinSymbol() })}
        >
          {t('wallet.tonForGas', { symbol: nativeCoinSymbol() })}:{' '}
          {tonLoading ? (
            <Skeleton variant="text" width="5rem" height={14} animation="pulse" />
          ) : (
            tonLine
          )}
        </div>
        {addr ? (
          <p className={styles.mono} aria-label={t('wallet.walletAddressAria')}>
            {shortenTonDisplayAddress(addr)}
          </p>
        ) : null}
      </div>

      <div className={styles.actionsRow}>
        <button type="button" className={styles.actionBtn} onClick={onReceiveToggle} aria-expanded={receiveExpanded}>
          {receiveExpanded ? t('wallet.receiveHide') : t('wallet.receive')}
        </button>
        <button type="button" className={styles.actionBtn} onClick={onSend}>
          {t('wallet.send')}
        </button>
        <button type="button" className={styles.actionBtn} onClick={onHistory}>
          {t('wallet.history')}
        </button>
      </div>

      {receiveExpanded && addr ? (
        <div className={styles.receivePanel}>
          <p className={styles.receiveHint}>{t('wallet.receiveHint')}</p>
          <div className={styles.qrWrap} aria-label={t('wallet.receiveQrAria')}>
            <QRCodeSVG value={tonUri} size={168} level="M" />
          </div>
          <p className={styles.mono}>{tonUri}</p>
          <button type="button" className={`${styles.actionBtn} ${styles.actionBtnFull}`} onClick={() => void navigator.clipboard.writeText(addr)}>
            {t('common.copy')} — {t('wallet.copyAddress')}
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnFull}`}
            onClick={() => void navigator.clipboard.writeText(tonUri)}
          >
            {t('common.copy')} — {t('wallet.copyTonLink')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
