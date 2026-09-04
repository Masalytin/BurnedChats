import { describe, expect, it } from 'vitest';

import { MIN_STAKE_NANO } from '@/ton/minStake';
import { formatBurn } from '@/utils/format';
import { evaluateStakeAmount, grossForNetMin, netAfterFeeBps } from '@/utils/stakeAmountGate';

const TEN_BURN = 10n * 1_000_000_000n;
const DUST_INCIDENT = 4_950n;
const FEE_ON_NET_FROM_MIN = 9_900_000n; // 0.01 BURN minus 1%
const TYPICAL_FEE = { burnBps: 50, stakingBps: 30, treasuryBps: 20 };
const ZERO_FEE = { burnBps: 0, stakingBps: 0, treasuryBps: 0 };

function gate(
  overrides: Partial<Parameters<typeof evaluateStakeAmount>[0]> = {},
): ReturnType<typeof evaluateStakeAmount> {
  return evaluateStakeAmount({
    amountStr: '0',
    balanceNano: TEN_BURN,
    netNano: 0n,
    estimateReady: true,
    insufficientTon: false,
    ...overrides,
  });
}

describe('MIN_STAKE_NANO', () => {
  it('mirrors StakingMaster.MinStakeNano / staking-helpers.ts (10_000_000n)', () => {
    expect(MIN_STAKE_NANO).toBe(10_000_000n);
  });
});

describe('evaluateStakeAmount', () => {
  it('treats empty, whitespace, zero and drafts as empty (no i18n, confirm off)', () => {
    for (const amountStr of ['', '   ', '0', '-0', '0.', '.', '.0']) {
      const r = gate({ amountStr, netNano: 0n });
      expect(r.state, amountStr).toBe('empty');
      expect(r.confirmEnabled, amountStr).toBe(false);
      expect(r.i18nKey, amountStr).toBeNull();
    }
  });

  it('flags incident dust 4950 nano with shortfall (excluded net = gross)', () => {
    const r = gate({
      amountStr: '0.00000495',
      netNano: DUST_INCIDENT,
    });
    expect(r.state).toBe('dust');
    expect(r.confirmEnabled).toBe(false);
    expect(r.i18nKey).toBe('staking.amountNeedMore');
    expect(r.i18nParams?.shortfall).toBe(formatBurn(MIN_STAKE_NANO - DUST_INCIDENT));
  });

  it('is blocked when loaded balance is below min (not amountPositive)', () => {
    const r = gate({
      amountStr: '0',
      balanceNano: DUST_INCIDENT,
      netNano: 0n,
    });
    expect(r.state).toBe('blocked');
    expect(r.confirmEnabled).toBe(false);
    expect(r.i18nKey).toBe('staking.balanceBelowMin');
  });

  it('is ok on exactly 0.01 BURN when net equals min (excluded)', () => {
    const r = gate({
      amountStr: '0.01',
      netNano: MIN_STAKE_NANO,
    });
    expect(r.state).toBe('ok');
    expect(r.confirmEnabled).toBe(true);
    expect(r.i18nKey).toBeNull();
  });

  it('does not let a large existing stake rescue dust on the new leg', () => {
    void TEN_BURN; // existing stake is not an input — threshold is incoming net only
    const r = gate({
      amountStr: '0.00000495',
      netNano: DUST_INCIDENT,
      balanceNano: TEN_BURN,
    });
    expect(r.state).toBe('dust');
    expect(r.confirmEnabled).toBe(false);
  });

  it('treats hypothetic fee-on 0.01 gross as dust when net < min', () => {
    const r = gate({
      amountStr: '0.01',
      netNano: FEE_ON_NET_FROM_MIN,
    });
    expect(r.state).toBe('dust');
    expect(r.confirmEnabled).toBe(false);
    expect(r.i18nKey).toBe('staking.amountNeedMore');
  });

  it('is overBalance when the parsed amount exceeds the wallet', () => {
    const r = gate({
      amountStr: '11',
      netNano: 11n * 1_000_000_000n,
      balanceNano: TEN_BURN,
    });
    expect(r.state).toBe('overBalance');
    expect(r.confirmEnabled).toBe(false);
    expect(r.i18nKey).toBe('staking.amountOverBalance');
  });

  it('is parsing for invalid non-draft input', () => {
    for (const amountStr of ['abc', '1.2.3']) {
      const r = gate({ amountStr });
      expect(r.state, amountStr).toBe('parsing');
      expect(r.confirmEnabled, amountStr).toBe(false);
      expect(r.i18nKey, amountStr).toBe('staking.amountInvalid');
    }
  });

  it('is noTon when BURN is ok but TON attach is short', () => {
    const r = gate({
      amountStr: '0.01',
      netNano: MIN_STAKE_NANO,
      insufficientTon: true,
    });
    expect(r.state).toBe('noTon');
    expect(r.confirmEnabled).toBe(false);
    expect(r.i18nKey).toBe('staking.insufficientTonForStake');
  });

  it('does not accuse balanceBelowMin while balance is still loading', () => {
    const r = gate({
      amountStr: '0',
      balanceNano: null,
      netNano: 0n,
    });
    expect(r.state).toBe('empty');
    expect(r.confirmEnabled).toBe(false);
    expect(r.i18nKey).not.toBe('staking.balanceBelowMin');
  });

  it('fail-closes confirm while the net estimate is in-flight', () => {
    const r = gate({
      amountStr: '0.01',
      netNano: null,
      estimateReady: false,
    });
    expect(r.confirmEnabled).toBe(false);
    expect(r.state).not.toBe('ok');
  });
});

describe('grossForNetMin', () => {
  it('returns MIN_STAKE_NANO when excluded', () => {
    expect(grossForNetMin(MIN_STAKE_NANO, { excluded: true, fee: TYPICAL_FEE })).toBe(MIN_STAKE_NANO);
  });

  it('returns MIN_STAKE_NANO when fee is zero or omitted', () => {
    expect(grossForNetMin(MIN_STAKE_NANO, { excluded: false, fee: ZERO_FEE })).toBe(MIN_STAKE_NANO);
    expect(grossForNetMin(MIN_STAKE_NANO, { excluded: false, fee: null })).toBe(MIN_STAKE_NANO);
    expect(grossForNetMin(MIN_STAKE_NANO, { excluded: false })).toBe(MIN_STAKE_NANO);
  });

  it('covers typical 50/30/20 so net ≥ min and gross ≥ ceil(min / 0.99)', () => {
    const keepBps = 10000n - 100n;
    const ceilGross = (MIN_STAKE_NANO * 10000n + keepBps - 1n) / keepBps;
    const gross = grossForNetMin(MIN_STAKE_NANO, { excluded: false, fee: TYPICAL_FEE });

    expect(gross).toBeGreaterThan(MIN_STAKE_NANO);
    expect(gross).toBeGreaterThanOrEqual(ceilGross);
    expect(netAfterFeeBps(gross, TYPICAL_FEE)).toBeGreaterThanOrEqual(MIN_STAKE_NANO);
  });
});
