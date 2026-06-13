import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StakeInfo, StakingTier, TierConfig } from '@/types/ton';
import { formatBurn, parseBurn } from '@/utils/format';
import { formatTimeRemaining, formatTierName, formatLockDuration } from '@/utils/staking-format';

import styles from './Staking.module.css';

export interface UnstakeModalProps {
  open: boolean;
  onClose: () => void;
  tier: StakingTier;
  stake: StakeInfo | undefined;
  tierConfig: TierConfig | undefined;
  nowSec?: number;
  onConfirmUnstake: (amount: bigint) => Promise<{ ok: boolean }>;
  onSuggestClaim?: () => void;
}

/**
 * Partial unstake sheet with lock guard and claim-first hint when rewards are pending.
 */
export function UnstakeModal({
  open,
  onClose,
  tier,
  stake,
  tierConfig,
  nowSec = Math.floor(Date.now() / 1000),
  onConfirmUnstake,
  onSuggestClaim,
}: UnstakeModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [amountStr, setAmountStr] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'edit' | 'signing'>('edit');

  const maxNano = stake?.amount ?? 0n;
  const pendingReward = stake?.pendingReward ?? 0n;
  const unlocked = stake ? stake.unlockTime <= nowSec || stake.unlockTime === 0 : false;

  useEffect(() => {
    if (open) {
      setAmountStr('0');
      setError(null);
      setPhase('edit');
      queueMicrotask(() => closeRef.current?.focus());
    }
  }, [open, tier]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && phase === 'edit') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, phase]);

  const lockHint =
    stake && !unlocked
      ? t('staking.unstakeLockedUntil', {
          date: new Date(stake.unlockTime * 1000).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
          rel: formatTimeRemaining(stake.unlockTime, t, nowSec),
        })
      : null;

  const validateAndSubmit = useCallback(async () => {
    setError(null);
    if (!unlocked) {
      setError(lockHint ?? t('staking.unstakeLocked'));
      return;
    }
    let nano: bigint;
    try {
      nano = parseBurn(amountStr);
    } catch {
      setError(t('staking.amountInvalid'));
      return;
    }
    if (nano <= 0n) {
      setError(t('staking.amountPositive'));
      return;
    }
    if (nano > maxNano) {
      setError(t('staking.unstakeOverStake'));
      return;
    }
    setPhase('signing');
    const res = await onConfirmUnstake(nano);
    if (res.ok) {
      onClose();
    } else {
      setPhase('edit');
    }
  }, [amountStr, lockHint, maxNano, onClose, onConfirmUnstake, t, unlocked]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase === 'edit') {
          onClose();
        }
      }}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.sheetHeader}>
          <h2 id={titleId} className={styles.sheetTitle}>
            {t('staking.unstakeTitle', { tier: formatTierName(tier, t) })}
          </h2>
          <button
            type="button"
            ref={closeRef}
            className={styles.iconBtn}
            onClick={onClose}
            aria-label={t('staking.modalClose')}
            disabled={phase === 'signing'}
          >
            ×
          </button>
        </div>

        {phase === 'signing' ? (
          <div className={styles.progressBox}>
            <p className={styles.textReset}>{t('staking.unstakeSigning')}</p>
          </div>
        ) : (
          <>
            <p className={`${styles.muted} ${styles.mt0}`}>
              {t('staking.unstakeAvailable', { amount: formatBurn(maxNano) })}
            </p>
            {tierConfig ? (
              <p className={`${styles.muted} ${styles.mtSm}`}>
                {t('staking.unstakeLockMeta', {
                  lock: formatLockDuration(tierConfig.lockDurationSec, t),
                })}
              </p>
            ) : null}

            {pendingReward > 0n ? (
              <div className={styles.warnBox} role="status">
                <div>{t('staking.unstakeClaimFirst', { amount: formatBurn(pendingReward) })}</div>
                {onSuggestClaim ? (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSecondary} ${styles.mtSm}`}
                    onClick={() => {
                      onSuggestClaim();
                      onClose();
                    }}
                  >
                    {t('staking.goClaim')}
                  </button>
                ) : null}
              </div>
            ) : null}

            <label className={styles.fieldLabel} htmlFor="unstake-amount-input">
              {t('staking.unstakeAmountLabel')}
            </label>
            <div className={styles.inputRow}>
              <input
                id="unstake-amount-input"
                className={styles.input}
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                disabled={!unlocked}
                aria-invalid={error != null}
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                disabled={!unlocked}
                onClick={() => {
                  const s = formatBurn(maxNano).replace(/\s*BURN\s*$/i, '').trim();
                  setAmountStr(s || '0');
                }}
              >
                {t('staking.max')}
              </button>
            </div>

            {error ? (
              <p className={styles.errText} role="alert">
                {error}
              </p>
            ) : null}

            <div className={`${styles.stackSm} ${styles.mtMd}`}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={!unlocked}
                title={!unlocked ? lockHint ?? undefined : undefined}
                aria-disabled={!unlocked}
                onClick={() => void validateAndSubmit()}
              >
                {t('staking.unstakeConfirm')}
              </button>
              {!unlocked ? (
                <span className={`${styles.muted} ${styles.textSm}`} role="note">
                  {lockHint}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
