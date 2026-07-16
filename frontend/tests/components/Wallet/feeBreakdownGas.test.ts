import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import {
  RECOMMENDED_BURN_PATH_NANO,
  estimateBurnTransferTon,
} from '@/ton/estimateBurnTransferTon';
import { formatNativeCoin, NATIVE_COIN_SYMBOL } from '@/ton/nativeCoin';

function formatTonAmount(nano: bigint): string {
  const nanosPerTon = 10n ** 9n;
  const intPart = nano / nanosPerTon;
  const frac = (nano % nanosPerTon).toString().padStart(9, '0').replace(/0+$/, '');
  return frac.length ? `${intPart}.${frac}` : `${intPart}`;
}

function depositHint(template: string): string {
  return template
    .replace(/\{\{symbol\}\}/g, NATIVE_COIN_SYMBOL)
    .replace('{{attach}}', formatTonAmount(RECOMMENDED_BURN_PATH_NANO));
}

describe('IMP-TOKSIM-06 — burn-only gas deposit UX', () => {
  it('formatNativeCoin appends display symbol to recommended 0.8 TON attach', () => {
    const estimate = estimateBurnTransferTon();
    expect(estimate.recommendedNano).toBe(RECOMMENDED_BURN_PATH_NANO);
    expect(formatNativeCoin(estimate.recommendedNano)).toBe(`0.8 ${NATIVE_COIN_SYMBOL}`);
  });

  it('en sendGasHint contains recommended attach and refund wording', () => {
    const hint = depositHint(en.wallet.sendGasHint);
    expect(hint).toContain('0.8');
    expect(hint).toContain(NATIVE_COIN_SYMBOL);
    expect(hint.toLowerCase()).toMatch(/refund/);
  });

  it('ru sendGasHint contains recommended attach and refund wording', () => {
    const hint = depositHint(ru.wallet.sendGasHint);
    expect(hint).toContain('0.8');
    expect(hint).toContain('вернётся');
  });

  it('preflight treats TON balance below recommended attach as insufficient gas', () => {
    const recommended = estimateBurnTransferTon().recommendedNano;
    expect(500_000_000n < recommended).toBe(true);
    expect(1_000_000_000n >= recommended).toBe(true);
  });
});
