import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import {
  canAffordGasReserve,
  tryApplyMaxBurnAmount,
} from '@/components/Wallet/sendModalGasReserve';
import {
  RECOMMENDED_FEE_PATH_WARM_NANO,
  estimateBurnTransferTon,
} from '@/ton/estimateBurnTransferTon';

function formatTonAmount(nano: bigint): string {
  const nanosPerTon = 10n ** 9n;
  const intPart = nano / nanosPerTon;
  const frac = (nano % nanosPerTon).toString().padStart(9, '0').replace(/0+$/, '');
  return frac.length ? `${intPart}.${frac}` : `${intPart}`;
}

describe('IMP-JETTON-GAS-10 — SendModal MAX TON reserve', () => {
  const warmRecommended = estimateBurnTransferTon({
    feePath: true,
    recipientWalletDeployed: true,
  }).recommendedNano;

  it('canAffordGasReserve rejects 1 TON when warm attach is 1.2 TON', () => {
    expect(warmRecommended).toBe(RECOMMENDED_FEE_PATH_WARM_NANO);
    expect(canAffordGasReserve(1_000_000_000n, warmRecommended)).toBe(false);
    expect(canAffordGasReserve(1_200_000_000n, warmRecommended)).toBe(true);
  });

  it('tryApplyMaxBurnAmount blocks silent MAX when TON is below recommended attach', () => {
    const result = tryApplyMaxBurnAmount({
      maxNano: 5_000_000_000n,
      tonBalanceNano: 1_000_000_000n,
      recommendedNano: warmRecommended,
    });
    expect(result.applied).toBe(false);
    expect(result.showTonReserveHint).toBe(true);
  });

  it('tryApplyMaxBurnAmount applies full BURN when TON covers attach', () => {
    const result = tryApplyMaxBurnAmount({
      maxNano: 5_000_000_000n,
      tonBalanceNano: 3_000_000_000n,
      recommendedNano: warmRecommended,
    });
    expect(result.applied).toBe(true);
    expect(result.showTonReserveHint).toBe(false);
  });

  it('slider 100% guard matches MAX — insufficient TON shows hint, no apply', () => {
    const at100 = tryApplyMaxBurnAmount({
      maxNano: 10n ** 12n,
      tonBalanceNano: 1_000_000_000n,
      recommendedNano: warmRecommended,
    });
    expect(at100.applied).toBe(false);
    expect(at100.showTonReserveHint).toBe(true);
  });

  it('en/ru sendMaxTonReserveHint mentions attach amount', () => {
    const attach = formatTonAmount(warmRecommended);
    const enHint = en.wallet.sendMaxTonReserveHint.replace('{{attach}}', attach);
    const ruHint = ru.wallet.sendMaxTonReserveHint.replace('{{attach}}', attach);
    expect(enHint).toContain('1.2');
    expect(ruHint).toContain('1.2');
    expect(ruHint.toLowerCase()).toMatch(/залог|ton/);
  });
});
