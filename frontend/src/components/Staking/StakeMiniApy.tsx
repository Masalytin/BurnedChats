import { useTranslation } from 'react-i18next';

import { StakingTier } from '@/types/ton';
import { formatBurn } from '@/utils/format';
import {
  MIN_MEANINGFUL_STAKE_NANO,
  calculateApyForInput,
  phase1DailyEmissionNano,
  resolvePreUserTierTotalNano,
} from '@/utils/apy';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

import styles from './Staking.module.css';

const DEBOUNCE_MS = 300;

/** Phase 1 emission + TOKENOMICS tier TVL; debounced while typing. */
export function StakeMiniApyBlock({
  tier,
  amountNano,
  existingStakeInTierNano,
  rewardSharePercent,
  liveTierTotalNano = null,
}: {
  tier: StakingTier;
  amountNano: bigint;
  existingStakeInTierNano: bigint;
  rewardSharePercent: number;
  liveTierTotalNano?: bigint | null;
}) {
  const { t } = useTranslation();
  const amt = useDebouncedValue(amountNano, DEBOUNCE_MS);
  const pre = resolvePreUserTierTotalNano(tier, existingStakeInTierNano, liveTierTotalNano);
  const res =
    amt >= MIN_MEANINGFUL_STAKE_NANO
      ? calculateApyForInput(amt, tier, pre, phase1DailyEmissionNano(), rewardSharePercent)
      : null;

  if (amt <= 0n) {
    return (
      <div className={styles.miniApyBox} role="status">
        <p className={`${styles.muted} ${styles.textReset}`}>
          {t('staking.calculator.modalNeedAmount')}
        </p>
      </div>
    );
  }

  if (amt < MIN_MEANINGFUL_STAKE_NANO) {
    return (
      <div className={styles.miniApyBox} role="status">
        <p className={`${styles.muted} ${styles.textReset}`}>
          {t('staking.calculator.minAmount', { min: formatBurn(MIN_MEANINGFUL_STAKE_NANO) })}
        </p>
      </div>
    );
  }

  if (!res) {
    return null;
  }

  return (
    <div className={styles.miniApyBox}>
      <div className={styles.apyRow}>
        <span>{t('staking.indicativeApy', { pct: res.apy.toFixed(1) })}</span>
        <span
          className={styles.apyHelp}
          tabIndex={0}
          title={t('staking.calculator.apyTooltip')}
          aria-label={t('staking.calculator.apyTooltip')}
        >
          ?
        </span>
      </div>
      <div className={styles.miniApyMeta}>
        <span title={t('staking.calculator.shareTierTooltip')}>
          {t('staking.calculator.modalShare', { pct: (res.shareOfTier * 100).toFixed(2) })}
        </span>
        <span title={t('staking.calculator.rewardDayTooltip')}>
          {t('staking.calculator.modalDay', { amount: formatBurn(res.dailyReward) })}
        </span>
        <span title={t('staking.calculator.rewardMonthTooltip')}>
          {t('staking.calculator.modalMonth', { amount: formatBurn(res.monthlyReward) })}
        </span>
        <span title={t('staking.calculator.rewardYearTooltip')}>
          {t('staking.calculator.modalYear', { amount: formatBurn(res.yearlyReward) })}
        </span>
      </div>
    </div>
  );
}
