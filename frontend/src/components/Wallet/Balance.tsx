import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';

import { debugLog } from '@/components/DebugPanel';
import type { UseBurnToken } from '@/hooks/useBurnToken';
import type { UseTonConnectResult } from '@/hooks/useTonConnect';
import { BurnTokenError } from '@/ton/burnToken';
import { shortenTonDisplayAddress } from '@/ton/connector';
import { estimateBurnTransferTon } from '@/ton/estimateBurnTransferTon';
import { formatNativeCoin, nativeCoinSymbol } from '@/ton/nativeCoin';
import { formatBurn } from '@/utils/format';

import { Skeleton } from '@/components/Skeleton/Skeleton';
import { balanceErrorMessage, isBalanceErrorRetryable } from './balanceErrorMessage';
import { canAffordGasReserve } from './sendModalGasReserve';
import { useWallet } from './WalletProvider';
import styles from './Wallet.module.css';

/** Minimum native attach for any BURN transfer (recommended burn-only path). */
const MIN_GRAM_FOR_SEND_NANO = estimateBurnTransferTon().recommendedNano;

export interface BalanceProps {
  burn: Pick<UseBurnToken, 'balance' | 'isLoading' | 'error' | 'refetch'>;
  ton: Pick<UseTonConnectResult, 'walletAddress' | 'isConnected'>;
  onReceiveToggle: () => void;
  receiveExpanded: boolean;
  onSend: () => void;
  onHistory: () => void;
}

/**
 * Primary BURN balance + GRAM card; quick actions for receive / send / history.
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
  const { tonBalance, isRefreshing, refreshWallet } = useWallet();

  useEffect(() => {
    if (!(burn.error instanceof BurnTokenError) || burn.error.code !== 'CONFIG') {
      return;
    }
    const configured = Boolean((import.meta.env.VITE_BURN_JETTON_MASTER ?? '').trim());
    debugLog('warn', '[Wallet] BURN balance CONFIG — check VITE_BURN_JETTON_MASTER', { configured });
  }, [burn.error]);

  const showBurnRetry =
    burn.error != null && isBalanceErrorRetryable(burn.error) && !burn.isLoading && !isRefreshing;

  const burnLoading = burn.isLoading && burn.balance == null && burn.error == null;

  const burnLine = burnLoading
    ? null
    : burn.balance != null
      ? formatBurn(burn.balance)
      : burn.error
        ? balanceErrorMessage(burn.error, t)
        : '—';

  const gramInitialLoading = tonBalance.isLoading && tonBalance.nano == null;
  const gramFailedNoSnapshot =
    tonBalance.failed && tonBalance.nano == null && !gramInitialLoading;
  const gramRefreshFailed =
    tonBalance.refreshFailed && tonBalance.nano != null && !gramInitialLoading;

  const gramAmountLine = gramInitialLoading
    ? null
    : tonBalance.nano != null
      ? formatNativeCoin(tonBalance.nano)
      : gramFailedNoSnapshot
        ? t('wallet.tonBalanceUnavailable')
        : '—';

  const showGramRetry = (gramFailedNoSnapshot || gramRefreshFailed) && !isRefreshing;

  const showGramDevHint =
    import.meta.env.DEV &&
    (gramFailedNoSnapshot || gramRefreshFailed) &&
    tonBalance.errorKind != null;

  const showLowGram =
    tonBalance.nano != null &&
    !gramInitialLoading &&
    !canAffordGasReserve(tonBalance.nano, MIN_GRAM_FOR_SEND_NANO);

  const gramAriaAmount =
    tonBalance.nano != null && !gramInitialLoading
      ? t('wallet.gramBalanceAria', { amount: formatNativeCoin(tonBalance.nano) })
      : undefined;

  const addr = ton.walletAddress ?? '';
  const tonUri = addr ? `ton://transfer/${encodeURIComponent(addr)}?text=BURN` : '';

  return (
    <section aria-labelledby="wallet-balance-heading">
      <h2 id="wallet-balance-heading" className={styles.srOnly}>
        {t('wallet.balanceSectionTitle')}
      </h2>
      <div className={styles.balanceHero} aria-busy={isRefreshing || undefined}>
        {burnLoading ? (
          <Skeleton
            variant="rounded"
            height={36}
            width="100%"
            className={styles.balanceSkeleton}
            animation="pulse"
          />
        ) : (
          <div
            className={styles.balancePrimary}
            role={burn.error ? 'alert' : undefined}
            data-refreshing={isRefreshing && burn.balance != null ? true : undefined}
            key={burn.balance?.toString() ?? (burn.error ? 'error' : 'empty')}
          >
            {burnLine}
          </div>
        )}
        {showBurnRetry ? (
          <button
            type="button"
            className={styles.balanceRetryBtn}
            onClick={() => void refreshWallet()}
          >
            {t('wallet.balanceRetry')}
          </button>
        ) : null}
        {addr ? (
          <p className={styles.mono} aria-label={t('wallet.walletAddressAria')}>
            {shortenTonDisplayAddress(addr)}
          </p>
        ) : null}

        <div
          className={styles.balanceAssetCard}
          aria-labelledby="wallet-gram-balance-heading"
          aria-busy={gramInitialLoading || undefined}
        >
          <h3 id="wallet-gram-balance-heading" className={styles.balanceAssetLabel}>
            {t('wallet.gramBalanceLabel')}
          </h3>
          <div className={styles.balanceAssetAmount} aria-label={gramAriaAmount}>
            {gramInitialLoading ? (
              <Skeleton
                variant="text"
                width="6rem"
                height={20}
                className={styles.balanceAssetSkeleton}
                animation="pulse"
              />
            ) : (
              <span
                className={styles.balanceAmountValue}
                data-refreshing={isRefreshing && tonBalance.nano != null ? true : undefined}
                key={tonBalance.nano?.toString() ?? (gramFailedNoSnapshot ? 'unavailable' : 'empty')}
              >
                {gramAmountLine}
              </span>
            )}
          </div>
          {showLowGram ? (
            <p className={styles.balanceAssetWarning}>
              {t('wallet.gramLowBalance', { symbol: nativeCoinSymbol() })}
            </p>
          ) : null}
          {showGramRetry ? (
            <button
              type="button"
              className={styles.balanceRetryBtn}
              onClick={() => void refreshWallet()}
            >
              {t('wallet.balanceRetry')}
            </button>
          ) : null}
          {showGramDevHint ? (
            <p className={styles.balanceDevHint} aria-hidden="true">
              RPC: {tonBalance.errorKind}
            </p>
          ) : null}
          <p className={styles.balanceAssetHint}>{t('wallet.gramTopUpHint')}</p>
        </div>
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
