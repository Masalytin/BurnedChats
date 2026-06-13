import { useTranslation } from 'react-i18next';

import { StakingTier, type TierConfig } from '@/types/ton';
import { formatLockDuration, formatTierName } from '@/utils/staking-format';

import { TierIcon } from './TierIcon';
import styles from './Staking.module.css';

export interface TierBadgeProps {
  tier: StakingTier;
  config: TierConfig;
  /** When true, include lock duration snippet after the name */
  showLockHint?: boolean;
  /** Optional id for aria-labelledby wiring */
  id?: string;
}

/**
 * Compact tier chip: icon + label + optional lock / VP multiplier (dashboard, tier cards).
 */
export function TierBadge({ tier, config, showLockHint, id }: TierBadgeProps) {
  const { t } = useTranslation();
  const lock = showLockHint ? formatLockDuration(config.lockDurationSec, t) : null;

  return (
    <span id={id} className={styles.badge} aria-label={formatTierName(tier, t)}>
      <TierIcon tier={tier} size={16} className={styles.badgeIcon} />
      <span className={styles.badgeName}>{formatTierName(tier, t)}</span>
      {lock ? <span className={styles.badgeMeta}>· {lock}</span> : null}
      <span className={styles.badgeMeta}>
        {t('staking.multiplierShort', { value: config.multiplier.toFixed(1) })}
      </span>
    </span>
  );
}
