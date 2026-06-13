import { useTranslation } from 'react-i18next';

import type { StakeInfo } from '@/types/ton';
import { formatTierName } from '@/utils/staking-format';

import { tierEmoji } from './TierBadge';
import { barScaleStyle } from './barScale';
import styles from './Staking.module.css';

function pct(now: number, start: number, end: number): number {
  if (end <= start) {
    return 100;
  }
  const p = ((now - start) / (end - start)) * 100;
  return Math.min(100, Math.max(0, p));
}

export interface UnlockTimelineProps {
  stakes: StakeInfo[];
}

/**
 * Gantt-style bars for locked positions (unlock in the future).
 */
export function UnlockTimeline({ stakes }: UnlockTimelineProps) {
  const { t } = useTranslation();
  const now = Math.floor(Date.now() / 1000);

  const locked = stakes.filter((s) => s.unlockTime > now && s.amount > 0n);

  if (locked.length === 0) {
    return (
      <div className={styles.timeline} role="region" aria-label={t('staking.timelineAria')}>
        <p className={`${styles.muted} ${styles.textReset}`}>
          {t('staking.timelineEmpty')}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.timeline} role="region" aria-label={t('staking.timelineAria')}>
      <div className={`${styles.sectionTitle} ${styles.sectionTitleFlush}`}>
        {t('staking.timelineTitle')}
      </div>
      {locked.map((s) => {
        const label = `${tierEmoji(s.tier)} ${formatTierName(s.tier, t)}`;
        const width = pct(now, s.startTime, s.unlockTime);
        return (
          <div key={s.tier} className={styles.timelineRow}>
            <div className={styles.timelineLabel}>
              <span>{label}</span>
              <span className={styles.muted}>
                {new Date(s.unlockTime * 1000).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            </div>
            <div className={styles.timelineTrack} aria-hidden="true">
              <div className={styles.timelineFill} style={barScaleStyle(width)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
