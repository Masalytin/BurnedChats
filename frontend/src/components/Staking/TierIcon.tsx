import { Award, Clock, Crown, Gem, type LucideIcon } from 'lucide-react';

import { StakingTier } from '@/types/ton';

import styles from './Staking.module.css';

const TIER_ICONS: Record<StakingTier, LucideIcon> = {
  [StakingTier.Diamond]: Gem,
  [StakingTier.Gold]: Crown,
  [StakingTier.Silver]: Award,
  [StakingTier.Flexible]: Clock,
};

const TIER_ICON_TONE: Record<StakingTier, string> = {
  [StakingTier.Diamond]: styles.tierIconDiamond,
  [StakingTier.Gold]: styles.tierIconGold,
  [StakingTier.Silver]: styles.tierIconSilver,
  [StakingTier.Flexible]: styles.tierIconFlexible,
};

export interface TierIconProps {
  tier: StakingTier;
  /** Icon glyph size in px (lucide `size` prop). */
  size?: number;
  className?: string;
}

/** Lucide tier glyph with semantic tier color from design tokens. */
export function TierIcon({ tier, size = 20, className }: TierIconProps) {
  const Icon = TIER_ICONS[tier];
  const tone = TIER_ICON_TONE[tier];
  const extra = className ?? '';
  return <Icon size={size} className={`${tone} ${extra}`.trim()} aria-hidden />;
}
