import { useTranslation } from 'react-i18next';

import { StakingTier, type TierConfig } from '@/types/ton';
import { formatLockDuration, formatTierName } from '@/utils/staking-format';

import styles from './Staking.module.css';

export function tierEmoji(tier: StakingTier): string {
  switch (tier) {
    case StakingTier.Flexible:
      return '🥉';
    case StakingTier.Silver:
      return '🥈';
    case StakingTier.Gold:
      return '🥇';
    case StakingTier.Diamond:
      return '💎';
    default:
      return '';
  }
}

export interface TierBadgeProps {
  tier: StakingTier;
  config: TierConfig;
  /** When true, include lock duration snippet after the name */
  showLockHint?: boolean;
  /** Optional id for aria-labelledby wiring */
  id?: string;
}

/**
 * Emoji + tier label + multiplier chip for staking tiers.
 */
export function TierBadge({ tier, config, showLockHint, id }: TierBadgeProps) {
  const { t } = useTranslation();
  const lock = showLockHint ? formatLockDuration(config.lockDurationSec, t) : null;

  return (
    <span id={id} className={styles.badge} aria-label={formatTierName(tier, t)}>
      <span aria-hidden="true">{tierEmoji(tier)}</span>
      <span>{formatTierName(tier, t)}</span>
      {lock ? <span className={styles.muted}>· {lock}</span> : null}
      <span>
        {t('staking.multiplierShort', { value: config.multiplier.toFixed(1) })}
      </span>
    </span>
  );
}
