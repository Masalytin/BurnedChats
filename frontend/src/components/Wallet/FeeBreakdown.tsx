import { useTranslation } from 'react-i18next';

import {
  ESTIMATED_NET_FEE_MAX_NANO,
  ESTIMATED_NET_FEE_MIN_NANO,
} from '@/ton/estimateBurnTransferTon';
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
  tonGas?: { attachedNano: bigint; estimatedNetFeeNano: bigint };
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

/**
 * Real-time BURN transfer fee visualization (matches TOKENOMICS 0.5% / 0.3% / 0.2% defaults).
 */
export function FeeBreakdown({ amountNano, feeParams, tonGas }: FeeBreakdownProps) {
  const { t } = useTranslation();
  const p = feeParams ?? DEFAULT_WALLET_FEE_PARAMS;
  const { burn, staking, treasury, recipientGets } = splitBurnFees(amountNano, p);

  if (amountNano <= 0n) {
    return (
      <div className={styles.feeBox} aria-live="polite">
        <p className={styles.errorText} style={{ margin: 0 }}>
          {t('wallet.feeEnterAmount')}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.feeBox} aria-live="polite" aria-label={t('wallet.feeBreakdownAria')}>
      <div className={styles.feeRow}>
        <span>{t('wallet.feeYouSend')}</span>
        <span>{formatBurn(amountNano)}</span>
      </div>
      <div className={styles.feeRow}>
        <span>
          <span aria-hidden="true">🔥 </span>
          {t('wallet.feeBurnLine', { pct: (p.burnBps / 100).toFixed(1) })}
        </span>
        <span>−{formatBurn(burn)}</span>
      </div>
      <div className={styles.feeRow}>
        <span>
          <span aria-hidden="true">💰 </span>
          {t('wallet.feeStakingLine', { pct: (p.stakingBps / 100).toFixed(1) })}
        </span>
        <span>−{formatBurn(staking)}</span>
      </div>
      <div className={styles.feeRow}>
        <span>
          <span aria-hidden="true">🏦 </span>
          {t('wallet.feeTreasuryLine', { pct: (p.treasuryBps / 100).toFixed(1) })}
        </span>
        <span>−{formatBurn(treasury)}</span>
      </div>
      <div className={`${styles.feeRow} ${styles.feeRowTotal}`}>
        <span>{t('wallet.feeRecipientGets')}</span>
        <span>{formatBurn(recipientGets)}</span>
      </div>
      {tonGas ? (
        <div className={styles.feeTonSection}>
          <div className={styles.feeRow}>
            <span title={t('wallet.sendGasNetFeeHint')}>{t('wallet.feeTonNetwork')}</span>
            <span>{formatTonAmount(tonGas.attachedNano)} TON</span>
          </div>
          <p className={styles.feeHint}>
            {t('wallet.sendGasDepositHint', {
              attach: formatTonAmount(tonGas.attachedNano),
              netMin: formatTonAmount(ESTIMATED_NET_FEE_MIN_NANO),
              netMax: formatTonAmount(ESTIMATED_NET_FEE_MAX_NANO),
            })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
