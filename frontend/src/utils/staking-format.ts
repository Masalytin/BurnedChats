import type { TFunction } from 'i18next';

import { StakingTier } from '@/types/ton';

const SEC_PER_DAY = 86_400;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

export function formatTierName(tier: StakingTier, t: TFunction): string {
  switch (tier) {
    case StakingTier.Flexible:
      return t('staking.tierFlexible');
    case StakingTier.Silver:
      return t('staking.tierSilver');
    case StakingTier.Gold:
      return t('staking.tierGold');
    case StakingTier.Diamond:
      return t('staking.tierDiamond');
    default:
      return t('staking.tierFlexible');
  }
}

/** Human-readable lock length from TOKENOMICS / on-chain seconds. */
export function formatLockDuration(lockDurationSec: number, t: TFunction): string {
  if (!lockDurationSec || lockDurationSec <= 0) {
    return t('staking.lockFlexible');
  }
  if (lockDurationSec <= 6 * 30 * SEC_PER_DAY + SEC_PER_DAY / 2) {
    return t('staking.lock6m');
  }
  if (lockDurationSec <= 365 * SEC_PER_DAY + SEC_PER_DAY / 2) {
    return t('staking.lock1y');
  }
  return t('staking.lock3y');
}

function pluralUnit(t: TFunction, keyBase: string, n: number): string {
  return t(`${keyBase}`, { count: n });
}

/**
 * Relative unlock string, e.g. "Unlocks in 2 months 5 days" / Russian equivalent via `t`.
 */
export function formatTimeRemaining(
  unlockTimeSec: number,
  t: TFunction,
  nowSec: number = Math.floor(Date.now() / 1000),
): string {
  if (unlockTimeSec <= nowSec) {
    return t('staking.unlocked');
  }
  let remaining = unlockTimeSec - nowSec;
  const years = Math.floor(remaining / (DAYS_PER_YEAR * SEC_PER_DAY));
  remaining -= years * DAYS_PER_YEAR * SEC_PER_DAY;
  const months = Math.floor(remaining / (DAYS_PER_MONTH * SEC_PER_DAY));
  remaining -= months * DAYS_PER_MONTH * SEC_PER_DAY;
  const days = Math.floor(remaining / SEC_PER_DAY);
  remaining -= days * SEC_PER_DAY;
  const hours = Math.floor(remaining / 3600);

  const parts: string[] = [];
  if (years > 0) {
    parts.push(pluralUnit(t, 'staking.timePartYear', years));
  }
  if (months > 0) {
    parts.push(pluralUnit(t, 'staking.timePartMonth', months));
  }
  if (days > 0) {
    parts.push(pluralUnit(t, 'staking.timePartDay', days));
  }
  if (parts.length === 0 && hours > 0) {
    parts.push(pluralUnit(t, 'staking.timePartHour', hours));
  }
  if (parts.length === 0) {
    parts.push(pluralUnit(t, 'staking.timePartHour', Math.max(1, hours)));
  }

  return t('staking.unlocksIn', { parts: parts.join(' ') });
}
