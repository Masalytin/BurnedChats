import type { TFunction } from 'i18next';

import { BurnTokenError } from '@/ton/burnToken';

/** Maps BURN balance load errors to localized UI copy (never exposes raw `error.message`). */
export function balanceErrorMessage(error: Error | null, t: TFunction): string {
  if (error instanceof BurnTokenError) {
    if (error.code === 'CONFIG') return t('wallet.balanceErrorConfig');
    if (error.code === 'NETWORK_ERROR') return t('wallet.balanceErrorNetwork');
  }
  return t('wallet.balanceError');
}

/** Whether the drawer should offer an explicit refetch control. */
export function isBalanceErrorRetryable(error: Error | null): boolean {
  return error instanceof BurnTokenError && error.retryable;
}
