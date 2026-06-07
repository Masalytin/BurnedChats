import type { TFunction } from 'i18next';

import { BurnTokenError } from '@/ton/burnToken';
import type { TxResult } from '@/ton/types';

/** Maps BURN send errors to localized UI copy (never exposes raw `error.message`). */
export function sendErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof BurnTokenError) {
    switch (error.code) {
      case 'USER_REJECTED':
        return t('wallet.sendRejected');
      case 'NETWORK_ERROR':
        return t('wallet.sendErrorNetwork');
      case 'CONFIG':
        return t('wallet.sendErrorConfig');
      case 'JETTON_WALLET_UNRESOLVED':
        return t('wallet.sendErrorJettonWalletUnresolved');
      case 'JETTON_WALLET_NOT_DEPLOYED':
        return t('wallet.sendErrorJettonWalletNotDeployed');
      case 'INSUFFICIENT_BALANCE':
        return t('wallet.sendErrorInsufficientBalance');
      case 'INSUFFICIENT_TON_GAS':
        return t('wallet.sendErrorInsufficientGas');
      default:
        return t('wallet.sendFailed');
    }
  }
  return t('wallet.sendFailed');
}

/** Maps Ton Connect `TxResult` failures to localized send error copy. */
export function sendErrorFromTxResult(res: Exclude<TxResult, { ok: true }>, t: TFunction): string {
  if (res.kind === 'user_rejected') {
    return t('wallet.sendRejected');
  }
  if (res.kind === 'network') {
    return t('wallet.sendErrorNetwork');
  }
  if (res.kind === 'insufficient_ton') {
    return t('wallet.sendErrorInsufficientGas');
  }
  return t('wallet.sendFailed');
}
