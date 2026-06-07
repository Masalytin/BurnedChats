import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { sendErrorFromTxResult, sendErrorMessage } from '@/components/Wallet/sendErrorMessage';
import { BurnTokenError } from '@/ton/burnToken';

const t = ((key: string) => key) as TFunction;

describe('sendErrorMessage', () => {
  it('maps each BurnTokenError code to wallet.sendError* i18n keys', () => {
    expect(sendErrorMessage(new BurnTokenError('USER_REJECTED', 'x'), t)).toBe('wallet.sendRejected');
    expect(sendErrorMessage(new BurnTokenError('NETWORK_ERROR', 'x'), t)).toBe('wallet.sendErrorNetwork');
    expect(sendErrorMessage(new BurnTokenError('CONFIG', 'x'), t)).toBe('wallet.sendErrorConfig');
    expect(sendErrorMessage(new BurnTokenError('JETTON_WALLET_UNRESOLVED', 'x'), t)).toBe(
      'wallet.sendErrorJettonWalletUnresolved',
    );
    expect(sendErrorMessage(new BurnTokenError('JETTON_WALLET_NOT_DEPLOYED', 'x'), t)).toBe(
      'wallet.sendErrorJettonWalletNotDeployed',
    );
    expect(sendErrorMessage(new BurnTokenError('INSUFFICIENT_BALANCE', 'x'), t)).toBe(
      'wallet.sendErrorInsufficientBalance',
    );
    expect(sendErrorMessage(new BurnTokenError('INSUFFICIENT_TON_GAS', 'x'), t)).toBe('wallet.sendErrorInsufficientGas');
    expect(sendErrorMessage(new BurnTokenError('UNKNOWN', 'Jetton wallet not deployed for this address'), t)).toBe(
      'wallet.sendFailed',
    );
  });

  it('never exposes raw error.message for generic errors', () => {
    expect(sendErrorMessage(new Error('Jetton wallet not deployed for this address'), t)).toBe('wallet.sendFailed');
  });
});

describe('sendErrorFromTxResult', () => {
  it('maps TxResult failure kinds to localized keys', () => {
    expect(sendErrorFromTxResult({ ok: false, kind: 'user_rejected' }, t)).toBe('wallet.sendRejected');
    expect(sendErrorFromTxResult({ ok: false, kind: 'network', message: 'raw' }, t)).toBe('wallet.sendErrorNetwork');
    expect(sendErrorFromTxResult({ ok: false, kind: 'insufficient_ton' }, t)).toBe('wallet.sendErrorInsufficientGas');
    expect(sendErrorFromTxResult({ ok: false, kind: 'unknown', message: 'raw' }, t)).toBe('wallet.sendFailed');
  });
});
