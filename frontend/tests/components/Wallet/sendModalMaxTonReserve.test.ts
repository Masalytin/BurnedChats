import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import {
  canAffordGasReserve,
  tryApplyMaxBurnAmount,
} from '@/components/Wallet/sendModalGasReserve';
import { RECOMMENDED_BURN_PATH_NANO, estimateBurnTransferTon } from '@/ton/estimateBurnTransferTon';

function formatTonAmount(nano: bigint): string {
  const nanosPerTon = 10n ** 9n;
  const intPart = nano / nanosPerTon;
  const frac = (nano % nanosPerTon).toString().padStart(9, '0').replace(/0+$/, '');
  return frac.length ? `${intPart}.${frac}` : `${intPart}`;
}

describe('IMP-TOKSIM-06 — SendModal MAX TON reserve', () => {
  const recommended = estimateBurnTransferTon().recommendedNano;

  it('recommended attach is 0.8 TON from gas profile', () => {
    expect(recommended).toBe(RECOMMENDED_BURN_PATH_NANO);
  });

  it('canAffordGasReserve rejects 0.5 TON when attach is 0.8 TON', () => {
    expect(canAffordGasReserve(500_000_000n, recommended)).toBe(false);
    expect(canAffordGasReserve(800_000_000n, recommended)).toBe(true);
  });

  it('tryApplyMaxBurnAmount blocks silent MAX when TON is below recommended attach', () => {
    const result = tryApplyMaxBurnAmount({
      maxNano: 5_000_000_000n,
      tonBalanceNano: 500_000_000n,
      recommendedNano: recommended,
    });
    expect(result.applied).toBe(false);
    expect(result.showTonReserveHint).toBe(true);
  });

  it('tryApplyMaxBurnAmount applies full BURN when TON covers attach', () => {
    const result = tryApplyMaxBurnAmount({
      maxNano: 5_000_000_000n,
      tonBalanceNano: 1_000_000_000n,
      recommendedNano: recommended,
    });
    expect(result.applied).toBe(true);
    expect(result.showTonReserveHint).toBe(false);
  });

  it('en/ru sendMaxTonReserveHint mentions attach amount', () => {
    const attach = formatTonAmount(recommended);
    const enHint = en.wallet.sendMaxTonReserveHint.replace('{{attach}}', attach);
    const ruHint = ru.wallet.sendMaxTonReserveHint.replace('{{attach}}', attach);
    expect(enHint).toContain('0.8');
    expect(ruHint).toContain('0.8');
    expect(ruHint.toLowerCase()).toMatch(/залог|ton/);
  });
});
