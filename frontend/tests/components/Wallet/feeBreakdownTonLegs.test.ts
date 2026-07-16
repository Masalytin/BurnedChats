import { toNano } from '@ton/core';
import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import {
  BURN_NOTIFY_NANO,
  PER_INTERNAL_DEPLOY_NANO,
  TRANSFER_HEADROOM_NANO,
  estimateBurnTransferTon,
} from '@/ton/estimateBurnTransferTon';
import { formatNativeCoin, NATIVE_COIN_SYMBOL } from '@/ton/nativeCoin';

describe('IMP-TOKSIM-06 — TON breakdown legs (burn-only)', () => {
  it('default path breakdown matches gas-profile anchors', () => {
    const { breakdown, recommendedNano } = estimateBurnTransferTon();
    expect(breakdown.deliverNano).toBe(PER_INTERNAL_DEPLOY_NANO);
    expect(breakdown.burnNotifyNano).toBe(BURN_NOTIFY_NANO);
    expect(breakdown.headroomNano).toBe(TRANSFER_HEADROOM_NANO);
    expect(recommendedNano).toBe(toNano('0.8'));
  });

  it('dust amount skips burn-notify leg in breakdown', () => {
    const { breakdown } = estimateBurnTransferTon({ amountNano: 50n });
    expect(breakdown.burnNotifyNano).toBe(0n);
    expect(breakdown.deliverNano).toBe(PER_INTERNAL_DEPLOY_NANO);
  });

  it('formatNativeCoin labels breakdown leg amounts with display symbol', () => {
    const { breakdown } = estimateBurnTransferTon();
    expect(formatNativeCoin(breakdown.burnNotifyNano)).toMatch(
      new RegExp(`\\d+(\\.\\d+)? ${NATIVE_COIN_SYMBOL}$`),
    );
  });

  it('en/ru i18n keys for simplified TON breakdown legs exist', () => {
    expect(en.wallet.feeTonDeliver).toBeTruthy();
    expect(en.wallet.feeTonBurnNotify).toBeTruthy();
    expect(en.wallet.feeTonHeadroom).toBeTruthy();
    expect(en.wallet.feeBurnLine).toBe('1% burns');
    expect(ru.wallet.feeBurnLine).toBe('1% сгорит');
    expect(ru.wallet.feeTonDeliver).toBeTruthy();
  });
});
