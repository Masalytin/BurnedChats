import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import {
  RECOMMENDED_EXCLUDED_PATH_NANO,
  RECOMMENDED_FEE_PATH_NANO,
  estimateBurnTransferTon,
} from '@/ton/estimateBurnTransferTon';
import { buildJettonTransferMsg } from '@/ton/transactionBuilder';
import { Address } from '@ton/core';

function formatTonAmount(nano: bigint): string {
  const nanosPerTon = 10n ** 9n;
  const intPart = nano / nanosPerTon;
  const frac = (nano % nanosPerTon).toString().padStart(9, '0').replace(/0+$/, '');
  return frac.length ? `${intPart}.${frac}` : `${intPart}`;
}

function hint(template: string, attachNano: bigint): string {
  return template.replace('{{attach}}', formatTonAmount(attachNano));
}

describe('IMP-JETTON-GAS-11 — excluded-path TON attach UX', () => {
  it('excluded path estimate yields post-F17 1.2 TON attach', () => {
    const estimate = estimateBurnTransferTon({ feePath: false });
    expect(estimate.recommendedNano).toBe(RECOMMENDED_EXCLUDED_PATH_NANO);
    expect(formatTonAmount(estimate.recommendedNano)).toBe('1.2');
  });

  it('fee path remains 1.5 TON for non-excluded users', () => {
    const estimate = estimateBurnTransferTon({ feePath: true });
    expect(estimate.recommendedNano).toBe(RECOMMENDED_FEE_PATH_NANO);
  });

  it('excluded attach unlocks send when TON balance is between 1.2 and 1.4 TON', () => {
    const excluded = estimateBurnTransferTon({ feePath: false }).recommendedNano;
    const fee = estimateBurnTransferTon({ feePath: true }).recommendedNano;
    const balance = 1_300_000_000n;
    expect(balance >= excluded).toBe(true);
    expect(balance < fee).toBe(true);
  });

  it('msg builder uses 1.2 TON when attachedTon is excluded estimate', () => {
    const attach = estimateBurnTransferTon({ feePath: false }).recommendedNano;
    const msg = buildJettonTransferMsg({
      jettonWallet: Address.parse(`0:${'aa'.repeat(32)}`),
      recipient: Address.parse(`0:${'bb'.repeat(32)}`),
      amount: 1_000_000_000n,
      attachedTon: attach,
    });
    expect(msg.amount).toBe('1200000000');
  });

  it('en excluded hint describes no BURN fee split and 1.2 TON deposit', () => {
    const text = hint(en.wallet.sendGasExcludedHint, RECOMMENDED_EXCLUDED_PATH_NANO);
    expect(text.toLowerCase()).toMatch(/no burn fee/i);
    expect(text).toContain('1.2');
  });

  it('ru excluded hint matches card copy', () => {
    const text = hint(ru.wallet.sendGasExcludedHint, RECOMMENDED_EXCLUDED_PATH_NANO);
    expect(text).toContain('без комиссии BURN');
    expect(text).toContain('1.2');
  });
});
