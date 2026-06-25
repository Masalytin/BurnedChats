import { Flame, Building2, Coins } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ESTIMATED_NET_FEE_MAX_NANO,
  ESTIMATED_NET_FEE_MIN_NANO,
  PROPAGATE_FEE_CONFIG_NANO,
  type BurnTransferGasEstimate,
} from '@/ton/estimateBurnTransferTon';
import { formatNativeCoin, nativeCoinSymbol } from '@/ton/nativeCoin';
import type { EffectiveFeeParams } from '@/types/ton';
import { formatBurn } from '@/utils/format';

import styles from './Wallet.module.css';

const TON_DECIMALS = 9n;
const NANOS_PER_TON = 10n ** TON_DECIMALS;

function formatTonAmount(nano: bigint): string {
  const intPart = nano / NANOS_PER_TON;
  const frac = (nano % NANOS_PER_TON).toString().padStart(Number(TON_DECIMALS), '0').replace(/0+$/, '');
  return frac.length ? `${intPart}.${frac}` : `${intPart}`;
}

/** TOKENOMICS default when chain params are not loaded yet. */
export const DEFAULT_WALLET_FEE_PARAMS: EffectiveFeeParams = {
  burnBps: 50,
  stakingBps: 30,
  treasuryBps: 20,
};

export interface FeeBreakdownProps {
  amountNano: bigint;
  feeParams: EffectiveFeeParams | null;
  tonGas?: {
    attachedNano: bigint;
    estimatedNetFeeNano: bigint;
    breakdown?: BurnTransferGasEstimate['breakdown'];
    path?: 'cold' | 'warm' | 'excluded';
    excludedPath?: boolean;
    propagateSkippedHint?: boolean;
    preflightLoading?: boolean;
  };
}

/**
 * Splits a send amount into burn / staking / treasury fee components (basis points).
 * Recipient receives the remainder so nano units stay consistent.
 */
export function splitBurnFees(amountNano: bigint, fee: EffectiveFeeParams): {
  burn: bigint;
  staking: bigint;
  treasury: bigint;
  recipientGets: bigint;
} {
  const burn = (amountNano * BigInt(fee.burnBps)) / 10000n;
  const staking = (amountNano * BigInt(fee.stakingBps)) / 10000n;
  const treasury = (amountNano * BigInt(fee.treasuryBps)) / 10000n;
  const recipientGets = amountNano - burn - staking - treasury;
  return { burn, staking, treasury, recipientGets };
}

/** Total BURN fee basis points (burn + staking + treasury). */
export function totalBurnFeeBps(fee: EffectiveFeeParams): number {
  return fee.burnBps + fee.stakingBps + fee.treasuryBps;
}

/**
 * Minimum gross send amount so `splitBurnFees(gross).recipientGets >= netNano`.
 * Matches on-chain integer bps rounding (separate floors per leg).
 */
export function grossFromNetRecipientAmount(netNano: bigint, fee: EffectiveFeeParams): bigint {
  if (netNano <= 0n) {
    return 0n;
  }
  const totalBps = totalBurnFeeBps(fee);
  if (totalBps <= 0) {
    return netNano;
  }
  if (totalBps >= 10000) {
    return netNano;
  }

  let low = netNano;
  let high = (netNano * 10000n) / (10000n - BigInt(totalBps)) + 2n;

  while (low < high) {
    const mid = (low + high) / 2n;
    const { recipientGets } = splitBurnFees(mid, fee);
    if (recipientGets >= netNano) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }
  return low;
}

type TonBreakdownRow = {
  key: string;
  label: string;
  nano: bigint;
  skipped?: boolean;
  skippedLabel?: string;
};

function buildTonBreakdownRows(
  breakdown: BurnTransferGasEstimate['breakdown'],
  t: (key: string) => string,
  propagateSkippedHint: boolean,
  excludedPath: boolean,
): TonBreakdownRow[] {
  const rows: TonBreakdownRow[] = [];

  if (breakdown.deployLegsNano > 0n) {
    rows.push({
      key: 'deploy',
      label: excludedPath ? t('wallet.feeTonDeployLegExcluded') : t('wallet.feeTonDeployLegs'),
      nano: breakdown.deployLegsNano,
    });
  }
  if (breakdown.burnNotifyNano > 0n) {
    rows.push({
      key: 'burnNotify',
      label: t('wallet.feeTonBurnNotify'),
      nano: breakdown.burnNotifyNano,
    });
  }
  if (breakdown.propagateNano > 0n || propagateSkippedHint) {
    rows.push({
      key: 'propagate',
      label: t('wallet.feeTonPropagate'),
      nano: propagateSkippedHint ? PROPAGATE_FEE_CONFIG_NANO : breakdown.propagateNano,
      skipped: propagateSkippedHint,
      skippedLabel: propagateSkippedHint ? t('wallet.feeTonPropagateSkipped') : undefined,
    });
  }
  if (breakdown.forwardNano > 0n) {
    rows.push({
      key: 'forward',
      label: t('wallet.feeTonForward'),
      nano: breakdown.forwardNano,
    });
  }

  return rows;
}

/**
 * Real-time BURN transfer fee visualization (matches TOKENOMICS 0.5% / 0.3% / 0.2% defaults).
 */
export function FeeBreakdown({ amountNano, feeParams, tonGas }: FeeBreakdownProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const p = feeParams ?? DEFAULT_WALLET_FEE_PARAMS;
  const excludedPath = tonGas?.excludedPath === true;
  const { burn, staking, treasury, recipientGets } = splitBurnFees(amountNano, p);
  const displayRecipientGets = excludedPath ? amountNano : recipientGets;

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
      ? buildTonBreakdownRows(
          tonGas.breakdown,
          t,
          tonGas.propagateSkippedHint === true,
          excludedPath,
        )
      : [];

  return (
    <div className={styles.feeBox} aria-live="polite" aria-label={t('wallet.feeBreakdownAria')}>
      <div className={styles.feeRow}>
        <span>{t('wallet.feeYouSend')}</span>
        <span>{formatBurn(amountNano)}</span>
      </div>
      {excludedPath ? (
        <div className={styles.feeRow}>
          <span>{t('wallet.feeExcludedTransfer')}</span>
          <span>{t('wallet.feeExcludedNoSplit')}</span>
        </div>
      ) : (
        <>
          <div className={styles.feeRow}>
            <span className={styles.feeRowLabel}>
              <Flame className={styles.feeRowIcon} size={14} strokeWidth={2.2} aria-hidden />
              {t('wallet.feeBurnLine', { pct: (p.burnBps / 100).toFixed(1) })}
            </span>
            <span>−{formatBurn(burn)}</span>
          </div>
          <div className={styles.feeRow}>
            <span className={styles.feeRowLabel}>
              <Coins className={styles.feeRowIcon} size={14} strokeWidth={2.2} aria-hidden />
              {t('wallet.feeStakingLine', { pct: (p.stakingBps / 100).toFixed(1) })}
            </span>
            <span>−{formatBurn(staking)}</span>
          </div>
          <div className={styles.feeRow}>
            <span className={styles.feeRowLabel}>
              <Building2 className={styles.feeRowIcon} size={14} strokeWidth={2.2} aria-hidden />
              {t('wallet.feeTreasuryLine', { pct: (p.treasuryBps / 100).toFixed(1) })}
            </span>
            <span>−{formatBurn(treasury)}</span>
          </div>
        </>
      )}
      <div className={`${styles.feeRow} ${styles.feeRowTotal}`}>
        <span>{t('wallet.feeRecipientGets')}</span>
        <span>{formatBurn(displayRecipientGets)}</span>
      </div>
      {tonGas ? (
        <div className={styles.feeTonSection}>
          <div className={styles.feeRow}>
            <span className={styles.feeTonNetworkLabel} title={t('wallet.sendGasNetFeeHint')}>
              {tonGas.preflightLoading ? t('wallet.sendGasChecking') : t('wallet.feeTonNetwork')}
              {!tonGas.preflightLoading && tonGas.path ? (
                <span
                  className={
                    tonGas.path === 'warm'
                      ? styles.feeTonPathBadgeWarm
                      : tonGas.path === 'excluded'
                        ? styles.feeTonPathBadgeCold
                        : styles.feeTonPathBadgeCold
                  }
                >
                  {tonGas.path === 'warm'
                    ? t('wallet.feeTonPathWarm')
                    : tonGas.path === 'excluded'
                      ? t('wallet.feeTonPathExcluded')
                      : t('wallet.feeTonPathCold')}
                </span>
              ) : null}
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
                      <span className={styles.feeTonSubLabel}>
                        {row.label}
                        {row.skippedLabel ? (
                          <span className={styles.feeTonSkippedHint}> ({row.skippedLabel})</span>
                        ) : null}
                      </span>
                      <span className={row.skipped ? styles.feeTonSkippedAmount : undefined}>
                        {formatNativeCoin(row.nano)}
                      </span>
                    </div>
                  ))}
                  {tonGas.propagateSkippedHint ? (
                    <p className={styles.feeTonFootnote}>{t('wallet.feeTonPropagateSkippedFootnote')}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {!tonGas.preflightLoading ? (
            <p className={styles.feeHint}>
              {tonGas.path === 'excluded'
                ? t('wallet.sendGasExcludedHint', {
                    attach: formatTonAmount(tonGas.attachedNano),
                    symbol: nativeCoinSymbol(),
                  })
                : tonGas.path === 'warm'
                  ? t('wallet.sendGasWarmHint', {
                      attach: formatTonAmount(tonGas.attachedNano),
                      netMin: formatTonAmount(ESTIMATED_NET_FEE_MIN_NANO),
                      netMax: formatTonAmount(ESTIMATED_NET_FEE_MAX_NANO),
                      symbol: nativeCoinSymbol(),
                    })
                  : t('wallet.sendGasColdHint', {
                      attach: formatTonAmount(tonGas.attachedNano),
                      netMin: formatTonAmount(ESTIMATED_NET_FEE_MIN_NANO),
                      netMax: formatTonAmount(ESTIMATED_NET_FEE_MAX_NANO),
                      symbol: nativeCoinSymbol(),
                    })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
