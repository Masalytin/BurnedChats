import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import {
  ESTIMATED_NET_FEE_MAX_NANO,
  ESTIMATED_NET_FEE_MIN_NANO,
  RECOMMENDED_FEE_PATH_NANO,
  RECOMMENDED_FEE_PATH_WARM_NANO,
  estimateBurnTransferTon,
} from '@/ton/estimateBurnTransferTon';

function formatTonAmount(nano: bigint): string {
  const nanosPerTon = 10n ** 9n;
  const intPart = nano / nanosPerTon;
  const frac = (nano % nanosPerTon).toString().padStart(9, '0').replace(/0+$/, '');
  return frac.length ? `${intPart}.${frac}` : `${intPart}`;
}

function hint(template: string, attachNano: bigint): string {
  return template
    .replace('{{attach}}', formatTonAmount(attachNano))
    .replace('{{netMin}}', formatTonAmount(ESTIMATED_NET_FEE_MIN_NANO))
    .replace('{{netMax}}', formatTonAmount(ESTIMATED_NET_FEE_MAX_NANO));
}

describe('IMP-JETTON-GAS-08 — warm-path TON attach UX', () => {
  it('warm preflight yields 2.3 TON attach in estimate', () => {
    const estimate = estimateBurnTransferTon({
      feePath: true,
      recipientWalletDeployed: true,
      recipientFeeConfigActive: true,
    });
    expect(estimate.recommendedNano).toBe(RECOMMENDED_FEE_PATH_WARM_NANO);
    expect(formatTonAmount(estimate.recommendedNano)).toBe('2.3');
  });

  it('cold preflight yields 3.5 TON attach in estimate', () => {
    const estimate = estimateBurnTransferTon({ feePath: true });
    expect(estimate.recommendedNano).toBe(RECOMMENDED_FEE_PATH_NANO);
    expect(formatTonAmount(estimate.recommendedNano)).toBe('3.5');
  });

  it('warm unlocks send when TON balance is between 2.3 and 3.4 TON', () => {
    const warm = estimateBurnTransferTon({ feePath: true, recipientWalletDeployed: true }).recommendedNano;
    const cold = estimateBurnTransferTon({ feePath: true }).recommendedNano;
    const balance = 2_500_000_000n;
    expect(balance < cold).toBe(true);
    expect(balance >= warm).toBe(true);
  });

  it('en cold/warm hints describe first vs repeat transfer', () => {
    const cold = hint(en.wallet.sendGasColdHint, RECOMMENDED_FEE_PATH_NANO);
    const warm = hint(en.wallet.sendGasWarmHint, RECOMMENDED_FEE_PATH_WARM_NANO);
    expect(cold.toLowerCase()).toMatch(/first/);
    expect(warm.toLowerCase()).toMatch(/repeat/);
    expect(cold).toContain('3.5');
    expect(warm).toContain('2.3');
  });

  it('ru warm hint mentions repeat transfer and lower deposit', () => {
    const warm = hint(ru.wallet.sendGasWarmHint, RECOMMENDED_FEE_PATH_WARM_NANO);
    expect(warm).toContain('Повторный');
    expect(warm).toContain('2.3');
  });
});
