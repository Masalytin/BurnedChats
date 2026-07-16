import { Flame } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  RECOMMENDED_BURN_PATH_NANO,
  type BurnTransferGasEstimate,
} from '@/ton/estimateBurnTransferTon';
import { formatNativeCoin, nativeCoinSymbol } from '@/ton/nativeCoin';
import { BURN_TRANSFER_FEE_BPS } from '@/types/ton';
import { formatBurn } from '@/utils/format';

import styles from './Wallet.module.css';

const TON_DECIMALS = 9n;
const NANOS_PER_TON = 10n ** TON_DECIMALS;

function formatTonAmount(nano: bigint): string {
  const intPart = nano / NANOS_PER_TON;
  const frac = (nano % NANOS_PER_TON).toString().padStart(Number(TON_DECIMALS), '0').replace(/0+$/, '');
  return frac.length ? `${intPart}.${frac}` : `${intPart}`;
}

/**
 * Splits a send amount into 1% burn fee and net to recipient (integer bps rounding).
 */
export function splitBurnFees(amountNano: bigint): { burn: bigint; recipientGets: bigint } {
  const burn = (amountNano * BigInt(BURN_TRANSFER_FEE_BPS)) / 10000n;
  return { burn, recipientGets: amountNano - burn };
}

/**
 * Minimum gross send amount so `splitBurnFees(gross).recipientGets >= netNano`.
 */
export function grossFromNetRecipientAmount(netNano: bigint): bigint {
  if (netNano <= 0n) {
    return 0n;
  }

  let low = netNano;
  let high = (netNano * 10000n) / (10000n - BigInt(BURN_TRANSFER_FEE_BPS)) + 2n;

  while (low < high) {
    const mid = (low + high) / 2n;
    const { recipientGets } = splitBurnFees(mid);
    if (recipientGets >= netNano) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }
  return low;
}

export interface FeeBreakdownProps {
  amountNano: bigint;
  tonGas?: {
    attachedNano: bigint;
    breakdown?: BurnTransferGasEstimate['breakdown'];
    preflightLoading?: boolean;
  };
}

type TonBreakdownRow = {
  key: string;
  label: string;
  nano: bigint;
};

function buildTonBreakdownRows(
  breakdown: BurnTransferGasEstimate['breakdown'],
  t: (key: string) => string,
): TonBreakdownRow[] {
  const rows: TonBreakdownRow[] = [
    {
      key: 'deliver',
      label: t('wallet.feeTonDeliver'),
      nano: breakdown.deliverNano,
    },
  ];
  if (breakdown.burnNotifyNano > 0n) {
    rows.push({
      key: 'burnNotify',
      label: t('wallet.feeTonBurnNotify'),
      nano: breakdown.burnNotifyNano,
    });
  }
  rows.push({
    key: 'headroom',
    label: t('wallet.feeTonHeadroom'),
    nano: breakdown.headroomNano,
  });
  return rows;
}

/** Real-time BURN transfer fee visualization (fixed 1% burn). */
export function FeeBreakdown({ amountNano, tonGas }: FeeBreakdownProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { burn, recipientGets } = splitBurnFees(amountNano);

  if (amountNano <= 0n) {
    return (
      <div className={styles.feeBox} aria-live="polite">
        <p className={styles.errorText} style={{ margin: 0 }}>
          {t('wallet.feeEnterAmount')}
        </p>
      </div>
    );
  }

  const tonBreakdownRows =
    tonGas?.breakdown && !tonGas.preflightLoading
      ? buildTonBreakdownRows(tonGas.breakdown, t)
      : [];

  const attachNano = tonGas?.attachedNano ?? RECOMMENDED_BURN_PATH_NANO;

  return (
    <div className={styles.feeBox} aria-live="polite" aria-label={t('wallet.feeBreakdownAria')}>
      <div className={styles.feeRow}>
        <span>{t('wallet.feeYouSend')}</span>
        <span>{formatBurn(amountNano)}</span>
      </div>
      <div className={styles.feeRow}>
        <span className={styles.feeRowLabel}>
          <Flame className={styles.feeRowIcon} size={14} strokeWidth={2.2} aria-hidden />
          {t('wallet.feeBurnLine')}
        </span>
        <span>−{formatBurn(burn)}</span>
      </div>
      <div className={`${styles.feeRow} ${styles.feeRowTotal}`}>
        <span>{t('wallet.feeRecipientGets')}</span>
        <span>{formatBurn(recipientGets)}</span>
      </div>
      {tonGas ? (
        <div className={styles.feeTonSection}>
          <div className={styles.feeRow}>
            <span className={styles.feeTonNetworkLabel} title={t('wallet.sendGasNetFeeHint')}>
              {tonGas.preflightLoading ? t('wallet.sendGasChecking') : t('wallet.feeTonNetwork')}
            </span>
            <span>
              {tonGas.preflightLoading ? '…' : formatNativeCoin(tonGas.attachedNano)}
            </span>
          </div>
          {!tonGas.preflightLoading && tonBreakdownRows.length > 0 ? (
            <div className={styles.feeTonDetails}>
              <button
                type="button"
                className={styles.feeTonDetailsToggle}
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((open) => !open)}
              >
                {t('wallet.feeTonDetails')}
              </button>
              {detailsOpen ? (
                <div className={styles.feeTonSubRows}>
                  {tonBreakdownRows.map((row) => (
                    <div key={row.key} className={styles.feeTonSubRow}>
                      <span className={styles.feeTonSubLabel}>{row.label}</span>
                      <span>{formatNativeCoin(row.nano)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {!tonGas.preflightLoading ? (
            <p className={styles.feeHint}>
              {t('wallet.sendGasHint', {
                attach: formatTonAmount(attachNano),
                symbol: nativeCoinSymbol(),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
