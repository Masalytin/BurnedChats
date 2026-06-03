import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';

import type { UseBurnToken } from '@/hooks/useBurnToken';
import type { UseTonConnectResult } from '@/hooks/useTonConnect';
import { shortenTonDisplayAddress } from '@/ton/connector';
import { getTonBalanceNano } from '@/ton/tonBalance';
import { formatBurn } from '@/utils/format';

import styles from './Wallet.module.css';

const TON_DECIMALS = 9n;
const NANOS_PER_TON = 10n ** TON_DECIMALS;

function formatTonBalance(nano: bigint): string {
  const neg = nano < 0n;
  const a = neg ? -nano : nano;
  const intPart = a / NANOS_PER_TON;
  const frac = (a % NANOS_PER_TON).toString().padStart(Number(TON_DECIMALS), '0').replace(/0+$/, '');
  const fracDisplay = frac.length ? `.${frac}` : '';
  return `${neg ? '−' : ''}${intPart}${fracDisplay} TON`;
}

export interface BalanceProps {
  burn: Pick<UseBurnToken, 'balance' | 'isLoading' | 'error'>;
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

  const burnLine =
    burn.balance != null
      ? formatBurn(burn.balance)
      : burn.isLoading
        ? t('wallet.balanceLoading')
        : burn.error
          ? t('wallet.balanceError')
          : '—';

  const tonLine = tonLoading
    ? t('wallet.balanceLoading')
    : tonFailed || tonNano == null
      ? t('wallet.tonBalanceUnavailable')
      : formatTonBalance(tonNano);

  const addr = ton.walletAddress ?? '';
  const tonUri = addr ? `ton://transfer/${encodeURIComponent(addr)}?text=BURN` : '';

  return (
    <section aria-labelledby="wallet-balance-heading">
      <h2 id="wallet-balance-heading" className={styles.srOnly}>
        {t('wallet.balanceSectionTitle')}
      </h2>
      <div className={styles.balanceHero}>
        <div className={styles.balancePrimary}>{burnLine}</div>
        <div className={styles.balanceSecondary} aria-label={t('wallet.tonForGasAria')}>
          {t('wallet.tonForGas')}: {tonLine}
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
          <button
            type="button"
            className={styles.actionBtn}
            style={{ width: '100%' }}
            onClick={() => void navigator.clipboard.writeText(addr)}
          >
            {t('common.copy')} — {t('wallet.copyAddress')}
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => void navigator.clipboard.writeText(tonUri)}
          >
            {t('common.copy')} — {t('wallet.copyTonLink')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
