import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDebouncedValue } from '@/hooks/useDebouncedValue';

import { StakingTier, type TierConfig } from '@/types/ton';
import { formatBurn, parseBurn } from '@/utils/format';
import {
  MIN_MEANINGFUL_STAKE_NANO,
  phase1DailyEmissionNano,
  phase2DailyStakingPoolEmissionNano,
  resolvePreUserTierTotalNano,
  calculateApyForInput,
  type NetworkActivityPreset,
} from '@/utils/apy';
import { TierPickGrid } from './TierPickGrid';
import { TierComparisonChart } from './TierComparisonChart';
import styles from './Staking.module.css';

const TIER_ORDER: StakingTier[] = [
  StakingTier.Diamond,
  StakingTier.Gold,
  StakingTier.Silver,
  StakingTier.Flexible,
];

const DEBOUNCE_MS = 300;
const DEFAULT_MAX_STAKE_NANO = 100n * 1_000_000_000n;

export interface ApyCalculatorProps {
  initialAmount?: bigint;
  initialTier?: StakingTier;
  showPhaseToggle?: boolean;
  /** Used to personalize tier TVL (existing position) and cap slider. */
  existingStakeByTier?: Partial<Record<StakingTier, bigint>>;
  tierConfigs: TierConfig[];
  /** When set, amount slider uses this as 100%. */
  walletBalanceNano?: bigint | null;
}

export function ApyCalculator({
  initialAmount,
  initialTier = StakingTier.Gold,
  showPhaseToggle = true,
  existingStakeByTier,
  tierConfigs,
  walletBalanceNano,
}: ApyCalculatorProps) {
  const { t } = useTranslation();
  const headingId = useId();

  const [tier, setTier] = useState<StakingTier>(initialTier);
  const [amountStr, setAmountStr] = useState(() =>
    initialAmount !== undefined && initialAmount > 0n ? formatBurn(initialAmount).replace(/\s*BURN\s*$/i, '').trim() : '10',
  );
  const [phase, setPhase] = useState<'phase1' | 'phase2'>('phase1');
  const [activity, setActivity] = useState<NetworkActivityPreset>('medium');

  useEffect(() => {
    if (initialAmount !== undefined && initialAmount > 0n) {
      const s = formatBurn(initialAmount).replace(/\s*BURN\s*$/i, '').trim();
      setAmountStr(s || '10');
    }
  }, [initialAmount]);

  useEffect(() => {
    setTier(initialTier);
  }, [initialTier]);

  const cfgByTier = useMemo(() => {
    const m = new Map<StakingTier, TierConfig>();
    for (const c of tierConfigs) {
      m.set(c.tier, c);
    }
    return m;
  }, [tierConfigs]);

  const selectedCfg = cfgByTier.get(tier);

  const amountNanoRaw = useMemo(() => {
    try {
      return parseBurn(amountStr);
    } catch {
      return 0n;
    }
  }, [amountStr]);

  const debouncedAmount = useDebouncedValue(amountNanoRaw, DEBOUNCE_MS);

  const maxSliderNano = useMemo(() => {
    if (walletBalanceNano != null && walletBalanceNano > 0n) {
      return walletBalanceNano;
    }
    return DEFAULT_MAX_STAKE_NANO;
  }, [walletBalanceNano]);

  const dailyEmissionNano = useMemo(() => {
    if (phase === 'phase1') {
      return phase1DailyEmissionNano();
    }
    return phase2DailyStakingPoolEmissionNano(activity);
  }, [phase, activity]);

  const preUserNano = useMemo(() => {
    const existing = existingStakeByTier?.[tier] ?? 0n;
    return resolvePreUserTierTotalNano(tier, existing);
  }, [tier, existingStakeByTier]);

  const result =
    selectedCfg !== undefined
      ? calculateApyForInput(debouncedAmount, tier, preUserNano, dailyEmissionNano, selectedCfg.rewardSharePercent)
      : null;

  const setFromSlider = useCallback(
    (pct: number) => {
      if (maxSliderNano <= 0n) {
        setAmountStr('0');
        return;
      }
      const x = (maxSliderNano * BigInt(Math.round(pct * 1000))) / 100_000n;
      const s = x === 0n ? '0' : formatBurn(x).replace(/\s*BURN\s*$/i, '').trim();
      setAmountStr(s || '0');
    },
    [maxSliderNano],
  );

  const sliderPct =
    maxSliderNano > 0n
      ? Math.min(100, Math.max(0, Number((amountNanoRaw * 10000n) / maxSliderNano) / 100))
      : 0;

  const sortedConfigs = useMemo(() => [...tierConfigs].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)), [tierConfigs]);

  const tooSmall = debouncedAmount > 0n && debouncedAmount < MIN_MEANINGFUL_STAKE_NANO;

  return (
    <section className={styles.calcSection} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionTitle}>
        {t('staking.calculator.title')}
      </h2>

      {showPhaseToggle ? (
        <div className={styles.calcPhaseRow} role="group" aria-label={t('staking.calculator.phaseGroup')}>
          <button
            type="button"
            className={`${styles.calcPhaseBtn} ${phase === 'phase1' ? styles.calcPhaseBtnOn : ''}`}
            onClick={() => setPhase('phase1')}
          >
            {t('staking.calculator.phase1')}
          </button>
          <button
            type="button"
            className={`${styles.calcPhaseBtn} ${phase === 'phase2' ? styles.calcPhaseBtnOn : ''}`}
            onClick={() => setPhase('phase2')}
          >
            {t('staking.calculator.phase2')}
          </button>
        </div>
      ) : null}

      {phase === 'phase2' ? (
        <>
          <div className={styles.warnBox} role="note">
            {t('staking.calculator.phase2Disclaimer')}
          </div>
          <div className={styles.fieldLabel}>{t('staking.calculator.activityLabel')}</div>
          <div className={styles.calcActivityRow}>
            {(['low', 'medium', 'high'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`${styles.calcActivityBtn} ${activity === p ? styles.calcActivityBtnOn : ''}`}
                onClick={() => setActivity(p)}
              >
                {t(`staking.calculator.activity.${p}`)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className={styles.fieldLabel}>
        <span id="calc-amt-lbl">{t('staking.calculator.amountLabel')}</span>
        <span className={styles.fieldHint} tabIndex={0} title={t('staking.calculator.amountTooltip')}>
          ⓘ
        </span>
      </div>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          inputMode="decimal"
          autoComplete="off"
          aria-labelledby="calc-amt-lbl"
          aria-describedby="calc-amt-tip"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
        />
      </div>
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
        aria-label={t('staking.calculator.amountSliderAria')}
      />
      <p id="calc-amt-tip" className={`${styles.muted} ${styles.mtXs}`}>
        {t('staking.calculator.amountHint', { max: formatBurn(maxSliderNano) })}
      </p>

      <div className={`${styles.fieldLabel} ${styles.fieldLabelSpaced}`}>
        <span id="calc-tier-lbl">{t('staking.calculator.tierLabel')}</span>
        <span className={styles.fieldHint} tabIndex={0} title={t('staking.calculator.tierTooltip')}>
          ⓘ
        </span>
      </div>
      <TierPickGrid
        tierConfigs={sortedConfigs}
        selectedTier={tier}
        onSelect={setTier}
        ariaLabelledBy="calc-tier-lbl"
      />

      <div className={styles.calcResults}>
        {debouncedAmount <= 0n ? (
          <p className={styles.muted}>{t('staking.calculator.needAmount')}</p>
        ) : tooSmall ? (
          <p className={styles.muted}>{t('staking.calculator.minAmount', { min: formatBurn(MIN_MEANINGFUL_STAKE_NANO) })}</p>
        ) : result ? (
          <>
            <div className={styles.calcStatRow}>
              <span className={styles.muted}>
                <span title={t('staking.calculator.apyTooltip')}>{t('staking.calculator.apy')}</span>
              </span>
              <span className={styles.calcStatEm}>{result.apy.toFixed(1)}%</span>
            </div>
            <div className={styles.calcStatRow}>
              <span className={styles.muted}>{t('staking.calculator.shareTier')}</span>
              <span>{(result.shareOfTier * 100).toFixed(2)}%</span>
            </div>
            <div className={styles.calcStatRow}>
              <span className={styles.muted} title={t('staking.calculator.rewardDayTooltip')}>
                {t('staking.calculator.rewardDay')}
              </span>
              <span>{formatBurn(result.dailyReward)}</span>
            </div>
            <div className={styles.calcStatRow}>
              <span className={styles.muted} title={t('staking.calculator.rewardMonthTooltip')}>
                {t('staking.calculator.rewardMonth')}
              </span>
              <span>{formatBurn(result.monthlyReward)}</span>
            </div>
            <div className={styles.calcStatRow}>
              <span className={styles.muted} title={t('staking.calculator.rewardYearTooltip')}>
                {t('staking.calculator.rewardYear')}
              </span>
              <span>{formatBurn(result.yearlyReward)}</span>
            </div>
          </>
        ) : (
          <p className={styles.muted}>{t('staking.calculator.noEmission')}</p>
        )}
      </div>

      {debouncedAmount >= MIN_MEANINGFUL_STAKE_NANO && dailyEmissionNano > 0n ? (
        <TierComparisonChart
          amountNano={debouncedAmount}
          dailyEmissionNano={dailyEmissionNano}
          cfgByTier={cfgByTier}
          selectedTier={tier}
        />
      ) : null}
    </section>
  );
}
