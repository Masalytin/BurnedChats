// @vitest-environment happy-dom
import type { Wallet } from '@tonconnect/sdk';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTonConnect } from '@/hooks/useTonConnect';
import { getTonConnectUI, resetTonConnectUI } from '@/ton/connector';

type StatusListener = (wallet: Wallet | null) => void;

function mockWallet(): Wallet {
  return {
    account: {
      address: '0:0000000000000000000000000000000000000000000000000000000000000000',
      chain: '-239',
      publicKey: 'aa'.repeat(32),
      walletStateInit: 'bb'.repeat(32),
    },
    device: {
      appName: 'mock',
      appVersion: '1.0',
      maxProtocolVersion: 2,
      platform: 'browser',
    },
  } as Wallet;
}

function createMockTonConnectUi(label: string) {
  let currentWallet: Wallet | null = null;
  const listeners = new Set<StatusListener>();

  return {
    label,
    get wallet() {
      return currentWallet;
    },
    connectionRestored: Promise.resolve(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onStatusChange: vi.fn((listener: StatusListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(wallet: Wallet | null) {
      currentWallet = wallet;
      for (const listener of listeners) {
        listener(wallet);
      }
    },
  };
}

vi.mock('@/ton/connector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ton/connector')>();
  return {
    ...actual,
    getTonConnectUI: vi.fn(actual.getTonConnectUI),
    connectWalletWithTonProof: vi.fn(),
    sendTonTransaction: vi.fn(),
  };
});

describe('useTonConnect', () => {
  beforeEach(() => {
    resetTonConnectUI();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetTonConnectUI();
  });

  it('re-subscribes to TonConnect UI after resetTonConnectUI (burn-all cleanup)', async () => {
    const uiBeforeBurn = createMockTonConnectUi('before');
    const uiAfterBurn = createMockTonConnectUi('after');
    let activeUi = uiBeforeBurn;

    vi.mocked(getTonConnectUI).mockImplementation(() => activeUi as never);

    const { result } = renderHook(() => useTonConnect());

    await waitFor(() => {
      expect(uiBeforeBurn.onStatusChange).toHaveBeenCalled();
    });

    act(() => {
      uiBeforeBurn.emit(mockWallet());
    });
    expect(result.current.isConnected).toBe(true);

    activeUi = uiAfterBurn;
    act(() => {
      resetTonConnectUI();
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
      expect(uiAfterBurn.onStatusChange).toHaveBeenCalled();
    });

    act(() => {
      uiAfterBurn.emit(mockWallet());
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.walletAddress).toBeTruthy();
  });
});
