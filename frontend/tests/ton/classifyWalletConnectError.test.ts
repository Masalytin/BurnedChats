// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tonconnect/ui', () => ({
  TonConnectUI: vi.fn(function TonConnectUI() {
    return {
      connected: false,
      disconnect: vi.fn(),
      wallet: null,
      connectionRestored: Promise.resolve(true),
      onStatusChange: vi.fn(() => () => {}),
      connectWallet: vi.fn(),
      setConnectRequestParameters: vi.fn(),
      sendTransaction: vi.fn(),
    };
  }),
  TonConnectUIError: class TonConnectUIError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TonConnectUIError';
    }
  },
}));

import { TonConnectUIError } from '@tonconnect/ui';
import { classifyWalletConnectError } from '../../src/ton/connector';

describe('classifyWalletConnectError', () => {
  it('classifies user rejection', () => {
    expect(classifyWalletConnectError(new Error('User rejected the request'))).toBe('user_rejected');
    expect(classifyWalletConnectError(new TonConnectUIError('Transaction was not sent'))).toBe(
      'user_rejected',
    );
  });

  it('classifies closing the TON Connect modal as user_rejected, not CSP', () => {
    // TonConnectUIError extends TonConnectError, which prefixes every message with
    // [TON_CONNECT_SDK_ERROR]. Closing the picker aborts connectWallet() with
    // "Wallet was not connected" (closeReason === 'action-cancelled').
    const closeModal = new TonConnectUIError('Wallet was not connected');
    closeModal.message = `[TON_CONNECT_SDK_ERROR] TonConnectUIError\nWallet was not connected`;
    expect(classifyWalletConnectError(closeModal)).toBe('user_rejected');

    // withTimeout() wraps the original into a plain Error — instanceof is lost.
    expect(
      classifyWalletConnectError(
        new Error(
          '[WalletAuth] connectWallet: [TON_CONNECT_SDK_ERROR] TonConnectUIError\nWallet was not connected',
        ),
      ),
    ).toBe('user_rejected');
  });

  it('classifies CSP / SDK abort after failed fetch', () => {
    expect(
      classifyWalletConnectError(
        new Error('[TON_CONNECT_SDK_ERROR] It Aborted after attempts 1. Failed to fetch'),
      ),
    ).toBe('csp_blocked');
    expect(classifyWalletConnectError(new Error('Refused to connect to https://config.ton.org'))).toBe(
      'csp_blocked',
    );
  });

  it('classifies manifest errors', () => {
    expect(classifyWalletConnectError(new Error('Manifest content error'))).toBe('manifest_invalid');
    expect(classifyWalletConnectError(new Error('Invalid manifest for dapp'))).toBe('manifest_invalid');
  });

  it('classifies transient network errors', () => {
    expect(classifyWalletConnectError(new Error('Network request failed'))).toBe('network');
    expect(classifyWalletConnectError(new Error('Connection timed out'))).toBe('network');
  });

  it('classifies proof / auth failures', () => {
    expect(classifyWalletConnectError(new Error('POST /api/auth/wallet 401'))).toBe('proof_failed');
  });

  it('classifies generic TonConnect UI errors as wallet_error', () => {
    expect(classifyWalletConnectError(new TonConnectUIError('Wallet returned unexpected payload'))).toBe(
      'wallet_error',
    );
  });

  it('falls back to unknown', () => {
    expect(classifyWalletConnectError(new Error('something completely unrelated'))).toBe('unknown');
    expect(classifyWalletConnectError(null)).toBe('unknown');
  });
});
