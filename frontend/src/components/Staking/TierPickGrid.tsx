import { useTranslation } from 'react-i18next';

import { StakingTier, type TierConfig } from '@/types/ton';
import { formatLockDuration, formatTierName } from '@/utils/staking-format';

import { TierIcon } from './TierIcon';
import styles from './Staking.module.css';

export interface TierPickGridProps {
  tierConfigs: TierConfig[];
  selectedTier: StakingTier;
  onSelect: (tier: StakingTier) => void;
  /** Optional id of external label (e.g. calculator field label). */
  ariaLabelledBy?: string;
  /** Accessible name when no external label is wired. */
  ariaLabel?: string;
}

/**
 * Vertical tier cards for stake modal and APY calculator pickers.
 */
export function TierPickGrid({
  tierConfigs,
  selectedTier,
  onSelect,
  ariaLabelledBy,
  ariaLabel,
}: TierPickGridProps) {
  const { t } = useTranslation();

  return (
    <div
      className={styles.tierPickGrid}
      role="group"
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
    >
      {tierConfigs.map((cfg) => {
        const selected = cfg.tier === selectedTier;
        return (
          <button
            key={cfg.tier}
            type="button"
            className={`${styles.tierPick} ${selected ? styles.tierPickSelected : ''}`}
            onClick={() => onSelect(cfg.tier)}
            aria-pressed={selected}
            aria-label={formatTierName(cfg.tier, t)}
          >
            <span className={styles.tierPickIconWrap}>
              <TierIcon tier={cfg.tier} size={22} />
            </span>
            <span className={styles.tierPickName}>{formatTierName(cfg.tier, t)}</span>
            <span className={styles.tierPickMeta}>
              {t('staking.tierPickHint', {
                mult: cfg.multiplier.toFixed(1),
                lock: formatLockDuration(cfg.lockDurationSec, t),
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
