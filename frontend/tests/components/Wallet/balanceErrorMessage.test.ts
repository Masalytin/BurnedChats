import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { balanceErrorMessage, isBalanceErrorRetryable } from '@/components/Wallet/balanceErrorMessage';
import { BurnTokenError } from '@/ton/burnToken';

const t = ((key: string) => key) as TFunction;

describe('balanceErrorMessage', () => {
  it('maps CONFIG to balanceErrorConfig', () => {
    expect(balanceErrorMessage(new BurnTokenError('CONFIG', 'internal'), t)).toBe('wallet.balanceErrorConfig');
  });

  it('maps NETWORK_ERROR to balanceErrorNetwork', () => {
    expect(balanceErrorMessage(new BurnTokenError('NETWORK_ERROR', '429'), t)).toBe('wallet.balanceErrorNetwork');
  });

  it('falls back to generic balanceError for unknown errors', () => {
    expect(balanceErrorMessage(new Error('oops'), t)).toBe('wallet.balanceError');
    expect(balanceErrorMessage(null, t)).toBe('wallet.balanceError');
  });

  it('marks NETWORK_ERROR as retryable', () => {
    expect(isBalanceErrorRetryable(new BurnTokenError('NETWORK_ERROR', 'down'))).toBe(true);
    expect(isBalanceErrorRetryable(new BurnTokenError('CONFIG', 'missing'))).toBe(false);
  });
});
