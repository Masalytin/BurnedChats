import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HelpSheet, HelpTrigger } from '@/components/HelpSheet';
import { useToast } from '@/components/Toast';
import { CloseIcon, SuccessIcon } from '@/icons';
import { canAffordGasReserve, nanoToAmountString } from '@/components/Wallet/sendModalGasReserve';
import { useTonConnect } from '@/hooks/useTonConnect';
import { estimateStakeNet, type StakeNetEstimate } from '@/ton/estimateStakeNet';
import { estimateStakeTon } from '@/ton/estimateStakeTon';
import { MIN_STAKE_NANO } from '@/ton/minStake';
import { getTonBalanceNano } from '@/ton/tonBalance';
import { StakingTier, type TierConfig } from '@/types/ton';
import { formatBurn, parseBurn } from '@/utils/format';
import { evaluateStakeAmount } from '@/utils/stakeAmountGate';

import { TierPickGrid } from './TierPickGrid';
import { StakeMiniApyBlock } from './StakeMiniApy';
import styles from './Staking.module.css';

const TIER_ORDER: StakingTier[] = [
  StakingTier.Diamond,
  StakingTier.Gold,
  StakingTier.Silver,
  StakingTier.Flexible,
];

export interface StakeModalProps {
  open: boolean;
  onClose: () => void;
  /** Initially selected tier when opening */
  initialTier: StakingTier;
  tierConfigs: TierConfig[];
  walletBalanceNano: bigint | null;
  /** Current on-chain stake in the selected tier (excludes the amount being typed). */
  existingStakeInTierNano: bigint;
  liveTierTotalNano?: bigint | null;
  /** Accrued pending reward in the selected tier (restake gas premium when > 0). */
  pendingRewardInTierNano?: bigint;
  onConfirmStake: (tier: StakingTier, amount: bigint) => Promise<{ ok: boolean }>;
}

/**
 * Bottom-sheet stake flow: tier cards, amount + slider, lock warning, indicative APY.
 */
export function StakeModal({
  open,
  onClose,
  initialTier,
  tierConfigs,
  walletBalanceNano,
  existingStakeInTierNano,
  liveTierTotalNano = null,
  pendingRewardInTierNano = 0n,
  onConfirmStake,
}: StakeModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { walletAddress } = useTonConnect();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [tonBalanceNano, setTonBalanceNano] = useState<bigint | null>(null);
  const [stakeNetEstimate, setStakeNetEstimate] = useState<StakeNetEstimate | null>(null);
  const [stakeNetStatus, setStakeNetStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const alertSlotId = 'stake-amount-error';

  const stakingMasterAddress = (import.meta.env.VITE_STAKING_MASTER ?? '').trim();

  const [tier, setTier] = useState<StakingTier>(initialTier);
  const [amountStr, setAmountStr] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'edit' | 'signing' | 'done'>('edit');
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setTier(initialTier);
      setAmountStr('0');
      setError(null);
      setPhase('edit');
      setHelpOpen(false);
      queueMicrotask(() => closeRef.current?.focus());
    }
  }, [open, initialTier]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && phase === 'edit' && !helpOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, phase, helpOpen]);

  useEffect(() => {
    const addr = walletAddress?.trim();
    if (!open || !addr) {
      setTonBalanceNano(null);
      return;
    }

    let cancelled = false;
    void getTonBalanceNano(addr)
      .then((nano) => {
        if (!cancelled) setTonBalanceNano(nano);
      })
      .catch(() => {
        if (!cancelled) setTonBalanceNano(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open, walletAddress]);

  const amountNano = useMemo(() => {
    try {
      return parseBurn(amountStr);
    } catch {
      return 0n;
    }
  }, [amountStr]);

  useEffect(() => {
    const addr = walletAddress?.trim();
    if (!open || !addr || amountNano <= 0n) {
      setStakeNetEstimate(null);
      setStakeNetStatus('idle');
      return;
    }
    if (!stakingMasterAddress) {
      setStakeNetEstimate(null);
      setStakeNetStatus('failed');
      return;
    }

    let cancelled = false;
    setStakeNetStatus('loading');
    setStakeNetEstimate(null);
    void estimateStakeNet({
      ownerAddress: addr,
      stakingMaster: stakingMasterAddress,
      grossNano: amountNano,
    })
      .then((est) => {
        if (!cancelled) {
          setStakeNetEstimate(est);
          setStakeNetStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStakeNetEstimate(null);
          setStakeNetStatus('failed');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, walletAddress, stakingMasterAddress, amountNano]);

  const tonEstimate = useMemo(
    () =>
      estimateStakeTon({
        hasExistingStakeInTier: existingStakeInTierNano > 0n,
        hasPendingReward: pendingRewardInTierNano > 0n,
        /** Match stakeTx fee-path attach (IMP-STKGATE-02). */
        feePath: true,
      }),
    [existingStakeInTierNano, pendingRewardInTierNano],
  );

  const insufficientTon =
    tonBalanceNano !== null && !canAffordGasReserve(tonBalanceNano, tonEstimate.recommendedNano);

  const cfgByTier = useMemo(() => {
    const m = new Map<StakingTier, TierConfig>();
    for (const c of tierConfigs) {
      m.set(c.tier, c);
    }
    return m;
  }, [tierConfigs]);

  const selectedCfg = cfgByTier.get(tier);
  const balance = walletBalanceNano ?? 0n;

  const unlockDate = useMemo((): Date | null => {
    if (!selectedCfg || selectedCfg.lockDurationSec <= 0) {
      return null;
    }
    return new Date(Date.now() + selectedCfg.lockDurationSec * 1000);
  }, [selectedCfg]);

  const setFromSlider = useCallback(
    (pct: number) => {
      if (balance <= 0n) {
        setAmountStr('0');
        return;
      }
      const x = (balance * BigInt(Math.round(pct * 1000))) / 100_000n;
      const s = x === 0n ? '0' : formatBurn(x).replace(/\s*BURN\s*$/i, '').trim();
      setAmountStr(s || '0');
    },
    [balance],
  );

  const sliderPct =
    balance > 0n ? Math.min(100, Math.max(0, Number((amountNano * 10000n) / balance) / 100)) : 0;

  const handleMax = useCallback(() => {
    if (balance <= 0n) {
      setAmountStr('0');
      return;
    }
    const s = formatBurn(balance).replace(/\s*BURN\s*$/i, '').trim();
    setAmountStr(s || '0');
  }, [balance]);

  const minChipDisabled = walletBalanceNano === null || walletBalanceNano < MIN_STAKE_NANO;

  const handleMin = useCallback(() => {
    if (minChipDisabled) {
      return;
    }
    const s = formatBurn(MIN_STAKE_NANO).replace(/\s*BURN\s*$/i, '').trim();
    setAmountStr(s || '0.01');
  }, [minChipDisabled]);

  const estimateReady = amountNano <= 0n || stakeNetStatus === 'ready';

  const gate = useMemo(
    () =>
      evaluateStakeAmount({
        amountStr,
        balanceNano: walletBalanceNano,
        netNano: stakeNetEstimate?.netNano ?? null,
        estimateReady,
        insufficientTon,
      }),
    [amountStr, estimateReady, insufficientTon, stakeNetEstimate?.netNano, walletBalanceNano],
  );

  const gateAlertText = gate.i18nKey
    ? t(gate.i18nKey, {
        ...gate.i18nParams,
        attach: nanoToAmountString(tonEstimate.recommendedNano),
      })
    : null;

  const validateAndSubmit = useCallback(async () => {
    setError(null);
    const live = evaluateStakeAmount({
      amountStr,
      balanceNano: walletBalanceNano,
      netNano: stakeNetEstimate?.netNano ?? null,
      estimateReady,
      insufficientTon,
    });
    if (!live.confirmEnabled) {
      if (live.i18nKey) {
        const msg = t(live.i18nKey, {
          ...live.i18nParams,
          attach: nanoToAmountString(tonEstimate.recommendedNano),
        });
        setError(msg);
        if (live.state === 'noTon') {
          toast.error(msg, { title: t('staking.stakeFailed') });
        }
      }
      return;
    }
    let nano: bigint;
    try {
      nano = parseBurn(amountStr);
    } catch {
      setError(t('staking.amountInvalid'));
      return;
    }
    setPhase('signing');
    const res = await onConfirmStake(tier, nano);
    if (res.ok) {
      setPhase('done');
    } else {
      setPhase('edit');
    }
  }, [
    amountStr,
    estimateReady,
    insufficientTon,
    onConfirmStake,
    stakeNetEstimate?.netNano,
    t,
    tier,
    toast,
    tonEstimate.recommendedNano,
    walletBalanceNano,
  ]);

  const confirmDisabled = !gate.confirmEnabled || phase === 'signing';

  if (!open) {
    return null;
  }

  const sortedConfigs = [...tierConfigs].sort(
    (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier),
  );

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase === 'edit' && !helpOpen) {
          onClose();
        }
      }}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.sheetHeader}>
          <h2 id={titleId} className={styles.sheetTitle}>
            {t('staking.stakeModalTitle')}
          </h2>
          <button
            type="button"
            ref={closeRef}
            className={styles.iconBtn}
            onClick={onClose}
            aria-label={t('staking.modalClose')}
            disabled={phase === 'signing'}
          >
            <CloseIcon size={20} aria-hidden />
          </button>
        </div>

        {phase === 'done' ? (
          <div className={styles.progressBox}>
            <div className={`${styles.checkPop} ${styles.textReset}`} aria-hidden="true">
              <SuccessIcon size={32} />
            </div>
            <p className={styles.textReset}>{t('staking.stakeSuccess')}</p>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.mtMd}`} onClick={onClose}>
              {t('staking.done')}
            </button>
          </div>
        ) : null}

        {phase === 'signing' ? (
          <div className={styles.progressBox}>
            <p className={styles.textReset}>{t('staking.stakeSigning')}</p>
          </div>
        ) : null}

        {phase === 'edit' ? (
          <>
            <p className={`${styles.muted} ${styles.mt0}`}>
              {t('staking.stakePickTier')}
            </p>
            <TierPickGrid tierConfigs={sortedConfigs} selectedTier={tier} onSelect={setTier} />

            <div className={styles.fieldLabel}>
              <label htmlFor="stake-amount-input">{t('staking.amountLabel')}</label>
              <HelpTrigger onOpen={() => setHelpOpen(true)} />
            </div>
            <p className={`${styles.muted} ${styles.textSm}`}>{t('staking.minStakeHint')}</p>
            <div className={styles.inputRow}>
              <input
                id="stake-amount-input"
                className={styles.input}
                inputMode="decimal"
                autoComplete="off"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                aria-invalid={
                  gate.state === 'parsing' || gate.state === 'dust' || gate.state === 'overBalance'
                }
                aria-describedby={`${alertSlotId} stake-balance-hint`}
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={handleMin}
                disabled={minChipDisabled}
              >
                {t('staking.minChip')}
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={handleMax}>
                {t('staking.max')}
              </button>
            </div>
            <div id="stake-balance-hint" className={`${styles.muted} ${styles.textSm} ${styles.mtSm}`}>
              {t('staking.walletBalance', { amount: formatBurn(balance) })}
              {tonBalanceNano !== null ? (
                <>
                  {' · '}
                  {t('staking.tonBalanceLabel', { amount: nanoToAmountString(tonBalanceNano) })}
                </>
              ) : null}
            </div>
            <p className={`${styles.muted} ${styles.textSm} ${styles.mtSm}`} role="status">
              {t('staking.tonGasDepositHint', {
                attach: nanoToAmountString(tonEstimate.recommendedNano),
              })}
            </p>
            <input
              type="range"
              className={styles.slider}
              min={0}
              max={100}
              step={1}
              value={Math.round(sliderPct)}
              onChange={(e) => setFromSlider(Number(e.target.value))}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(sliderPct)}
              aria-label={t('staking.amountSliderAria')}
              disabled={balance <= 0n}
            />

            {unlockDate ? (
              <div className={styles.lockWarn} role="status">
                {t('staking.lockConfirm', {
                  date: unlockDate.toLocaleDateString(undefined, { dateStyle: 'long' }),
                })}
              </div>
            ) : null}

            {selectedCfg ? (
              <StakeMiniApyBlock
                tier={tier}
                amountNano={
                  stakeNetEstimate?.willChargeFee ? stakeNetEstimate.netNano : amountNano
                }
                existingStakeInTierNano={existingStakeInTierNano}
                liveTierTotalNano={liveTierTotalNano}
                rewardSharePercent={selectedCfg.rewardSharePercent}
              />
            ) : null}

            {stakeNetEstimate?.willChargeFee && stakeNetEstimate.feeNano > 0n ? (
              <p className={`${styles.muted} ${styles.textSm} ${styles.mtSm}`} role="status">
                {t('staking.stakeNetWithFee', {
                  net: formatBurn(stakeNetEstimate.netNano),
                  fee: formatBurn(stakeNetEstimate.feeNano),
                })}
              </p>
            ) : null}

            <div id={alertSlotId} className={styles.alertSlot}>
              {gateAlertText || error ? (
                <p
                  className={`${styles.alertSlotText} ${styles.alertSlotTextVisible} ${styles.errText}`}
                  role={gate.state === 'blocked' ? 'status' : 'alert'}
                >
                  {gateAlertText ?? error}
                </p>
              ) : (
                <p className={styles.alertSlotText} aria-hidden="true" />
              )}
            </div>

            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.fullWidth} ${styles.mtMd}`}
              disabled={confirmDisabled}
              aria-describedby={alertSlotId}
              onClick={() => void validateAndSubmit()}
            >
              {t('staking.stakeConfirm')}
            </button>
          </>
        ) : null}
      </div>
      <HelpSheet
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        topicKey="staking.minStake"
      />
    </div>
  );
}
