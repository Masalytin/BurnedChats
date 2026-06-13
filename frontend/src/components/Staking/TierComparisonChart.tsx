import { useTranslation } from 'react-i18next';

import { StakingTier, type TierConfig } from '@/types/ton';
import { ILLUSTRATIVE_PRE_USER_NANO, calculateApyForInput } from '@/utils/apy';
import { formatTierName } from '@/utils/staking-format';

import { barScaleStyle } from './barScale';
import styles from './Staking.module.css';

const TIER_ORDER: StakingTier[] = [
  StakingTier.Flexible,
  StakingTier.Silver,
  StakingTier.Gold,
  StakingTier.Diamond,
];

export interface TierComparisonChartProps {
  amountNano: bigint;
  dailyEmissionNano: bigint;
  cfgByTier: Map<StakingTier, TierConfig>;
  selectedTier: StakingTier;
}

/**
 * Horizontal bars: APY % for each tier at the same stake amount (illustrative TVL per tier).
 */
export function TierComparisonChart({ amountNano, dailyEmissionNano, cfgByTier, selectedTier }: TierComparisonChartProps) {
  const { t } = useTranslation();

  const rows = TIER_ORDER.map((tier) => {
    const cfg = cfgByTier.get(tier);
    const pre =
      cfg !== undefined
        ? calculateApyForInput(
            amountNano,
            tier,
            ILLUSTRATIVE_PRE_USER_NANO[tier],
            dailyEmissionNano,
            cfg.rewardSharePercent,
          )
        : null;
    return { tier, apy: pre?.apy ?? 0 };
  });

  const maxApy = Math.max(1e-6, ...rows.map((r) => r.apy));

  return (
    <div className={styles.calcChart} role="img" aria-label={t('staking.calculator.chartAria')}>
      <div className={styles.calcChartTitle}>{t('staking.calculator.chartTitle')}</div>
      {rows.map(({ tier, apy }) => (
        <div key={tier} className={styles.calcChartRow}>
          <div className={styles.calcChartLabel}>
            <span className={tier === selectedTier ? styles.calcChartLabelHi : undefined}>
              {formatTierName(tier, t)}
            </span>
            <span className={styles.muted}>{apy.toFixed(1)}%</span>
          </div>
          <div className={styles.calcChartTrack}>
            <div
              className={`${styles.calcChartFill} ${tier === selectedTier ? styles.calcChartFillHi : ''}`}
              style={barScaleStyle(Math.min(100, (apy / maxApy) * 100))}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
