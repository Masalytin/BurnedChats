import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import {
  ESTIMATED_NET_FEE_MAX_NANO,
  ESTIMATED_NET_FEE_MIN_NANO,
  RECOMMENDED_FEE_PATH_NANO,
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
    .replace('{{attach}}', formatTonAmount(RECOMMENDED_FEE_PATH_NANO))
    .replace('{{netMin}}', formatTonAmount(ESTIMATED_NET_FEE_MIN_NANO))
    .replace('{{netMax}}', formatTonAmount(ESTIMATED_NET_FEE_MAX_NANO));
}

describe('IMP-JETTON-GAS-05 — fee path gas deposit UX', () => {
  it('formatNativeCoin appends display symbol to gas attach amount', () => {
    const estimate = estimateBurnTransferTon({ feePath: true });
    expect(formatNativeCoin(estimate.recommendedNano)).toBe(`3.5 ${NATIVE_COIN_SYMBOL}`);
  });

  it('en deposit hint contains recommended attach, net fee range, and native coin symbol', () => {
    const hint = depositHint(en.wallet.sendGasDepositHint);
    expect(hint).toContain('3.5');
    expect(hint).toContain('0.05');
    expect(hint).toContain('0.1');
    expect(hint).toContain(NATIVE_COIN_SYMBOL);
    expect(hint.toLowerCase()).toMatch(/refund/);
  });

  it('ru deposit hint contains recommended attach and refund wording', () => {
    const hint = depositHint(ru.wallet.sendGasDepositHint);
    expect(hint).toContain('3.5');
    expect(hint).toContain('вернётся');
  });

  it('preflight treats TON balance below recommended attach as insufficient gas', () => {
    const recommended = estimateBurnTransferTon({ feePath: true }).recommendedNano;
    expect(1_000_000_000n < recommended).toBe(true);
    expect(10_000_000_000n < recommended).toBe(false);
  });
});
