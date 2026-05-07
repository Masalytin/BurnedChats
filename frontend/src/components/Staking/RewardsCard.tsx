import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StakingTier } from '@/types/ton';
import { formatBurn } from '@/utils/format';
import { formatTierName } from '@/utils/staking-format';

import styles from './Staking.module.css';

const CLAIM_LS_KEY = 'burn-staking-claim-log-v1';
const MAX_CLAIMS = 10;

export interface ClaimLogEntry {
  tier: StakingTier;
  at: number;
}

function readClaimLog(): ClaimLogEntry[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = localStorage.getItem(CLAIM_LS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: ClaimLogEntry[] = [];
    for (const row of parsed) {
      if (row && typeof row === 'object' && 'tier' in row && 'at' in row) {
        const tier = Number((row as { tier: unknown }).tier);
        const at = Number((row as { at: unknown }).at);
        if (tier >= 0 && tier <= 3 && Number.isFinite(at)) {
          out.push({ tier: tier as StakingTier, at });
        }
      }
    }
    return out.slice(0, MAX_CLAIMS);
  } catch {
    return [];
  }
}

export function appendStakingClaimLog(tier: StakingTier): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  const prev = readClaimLog();
  const next = [{ tier, at: Date.now() }, ...prev].slice(0, MAX_CLAIMS);
  try {
    localStorage.setItem(CLAIM_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

export interface RewardsCardProps {
  pendingRewards: Partial<Record<StakingTier, bigint>>;
  onClaimTier: (tier: StakingTier) => Promise<void>;
  onClaimAll: () => Promise<void>;
  busyTier: StakingTier | null;
  busyAll: boolean;
  /** When true, pending reward values just animated */
  highlight?: boolean;
}

const ORDER: StakingTier[] = [
  StakingTier.Diamond,
  StakingTier.Gold,
  StakingTier.Silver,
  StakingTier.Flexible,
];

/**
 * Pending rewards list, claim actions, and last local claim events.
 */
export function RewardsCard({
  pendingRewards,
  onClaimTier,
  onClaimAll,
  busyTier,
  busyAll,
  highlight,
}: RewardsCardProps) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<ClaimLogEntry[]>(() => readClaimLog());

  const rows = useMemo(() => {
    return ORDER.map((tier) => ({ tier, amount: pendingRewards[tier] ?? 0n })).filter((r) => r.amount > 0n);
  }, [pendingRewards]);

  const claimAllDisabled = rows.length === 0 || busyAll || busyTier !== null;

  const handleClaimOne = useCallback(
    async (tier: StakingTier) => {
      await onClaimTier(tier);
      appendStakingClaimLog(tier);
      setHistory(readClaimLog());
    },
    [onClaimTier],
  );

  const handleClaimAll = useCallback(async () => {
    await onClaimAll();
    for (const r of rows) {
      appendStakingClaimLog(r.tier);
    }
    setHistory(readClaimLog());
  }, [onClaimAll, rows]);

  return (
    <section className={styles.rewardsCard} aria-labelledby="staking-rewards-heading">
      <h2 id="staking-rewards-heading" className={styles.sectionTitle} style={{ marginTop: 0 }}>
        {t('staking.rewardsTitle')}
      </h2>
      {rows.length === 0 ? (
        <p className={styles.muted} style={{ margin: 0 }}>
          {t('staking.rewardsEmpty')}
        </p>
      ) : (
        <>
          {rows.map((r) => (
            <div key={r.tier} className={styles.rewardRow}>
              <div>
                <div>{formatTierName(r.tier, t)}</div>
                <div
                  className={highlight ? styles.pulse : undefined}
                  style={{ fontWeight: 700 }}
                  aria-live="polite"
                >
                  {formatBurn(r.amount)}
                </div>
              </div>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={busyTier !== null || busyAll || r.amount <= 0n}
                onClick={() => void handleClaimOne(r.tier)}
              >
                {busyTier === r.tier ? t('staking.claiming') : t('staking.claimTier')}
              </button>
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              disabled={claimAllDisabled}
              onClick={() => void handleClaimAll()}
            >
              {busyAll ? t('staking.claiming') : t('staking.claimAll')}
            </button>
          </div>
        </>
      )}

      <div className={styles.sectionTitle}>{t('staking.claimHistoryTitle')}</div>
      {history.length === 0 ? (
        <p className={styles.muted} style={{ margin: 0 }}>
          {t('staking.claimHistoryEmpty')}
        </p>
      ) : (
        <ul className={styles.claimHistory} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {history.map((h) => (
            <li key={`${h.tier}-${h.at}`} className={styles.claimRow}>
              {t('staking.claimHistoryRow', {
                tier: formatTierName(h.tier, t),
                time: new Date(h.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
