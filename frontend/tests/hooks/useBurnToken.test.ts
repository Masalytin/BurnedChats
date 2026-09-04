// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBurnToken } from '@/hooks/useBurnToken';
import { useTonConnect } from '@/hooks/useTonConnect';
import * as burnToken from '@/ton/burnToken';
import type { JettonSupply } from '@/ton/burnSupply';
import type { EffectiveFeeParams } from '@/types/ton';

const WALLET = '0QBNxdjqjhQP2OPaZHSRj06NRTd4z6-Trd6BdZ0DX0_9WJPD';

const mockFees: EffectiveFeeParams = { burnBps: 50, stakingBps: 30, treasuryBps: 20 };

const mockSupplyMintOpen: JettonSupply = {
  circulating: 990_000_000_000n,
  mintable: true,
  burned: null,
};

const mockSupplyMintClosed: JettonSupply = {
  circulating: 990_000_000_000n,
  mintable: false,
  burned: 10_000_000_000n,
};

vi.mock('@/hooks/useTonConnect', () => ({
  useTonConnect: vi.fn(),
}));

const mockUseTonConnect = vi.mocked(useTonConnect);

describe('useBurnToken isolated load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTonConnect.mockReturnValue({
      walletAddress: WALLET,
      isConnected: true,
    } as ReturnType<typeof useTonConnect>);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call getBurnHistory on mount (history is lazy)', async () => {
    vi.spyOn(burnToken, 'getBurnBalance').mockResolvedValue(42_000_000_000n);
    const getBurnHistory = vi.spyOn(burnToken, 'getBurnHistory').mockResolvedValue([]);
    vi.spyOn(burnToken, 'getEffectiveFeeParams').mockResolvedValue(mockFees);
    vi.spyOn(burnToken, 'getJettonSupply').mockResolvedValue(mockSupplyMintOpen);

    const { result } = renderHook(() => useBurnToken());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.balance).toBe(42_000_000_000n);
    });

    expect(getBurnHistory).not.toHaveBeenCalled();
    expect(result.current.history).toEqual([]);
    expect(result.current.feeParams).toEqual(mockFees);
  });

  it('shows balance when getBurnHistory fails (error only for balance path)', async () => {
    vi.spyOn(burnToken, 'getBurnBalance').mockResolvedValue(42_000_000_000n);
    vi.spyOn(burnToken, 'getBurnHistory').mockRejectedValue(new Error('Ton Center 429'));
    vi.spyOn(burnToken, 'getEffectiveFeeParams').mockResolvedValue(mockFees);
    vi.spyOn(burnToken, 'getJettonSupply').mockResolvedValue(mockSupplyMintOpen);

    const { result } = renderHook(() => useBurnToken());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.balance).toBe(42_000_000_000n);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.history).toEqual([]);
    expect(result.current.feeParams).toEqual(mockFees);
  });

  it('sets error only when getBurnBalance fails', async () => {
    const balanceErr = new burnToken.BurnTokenError('CONFIG', 'jetton master missing');
    vi.spyOn(burnToken, 'getBurnBalance').mockRejectedValue(balanceErr);
    vi.spyOn(burnToken, 'getBurnHistory').mockResolvedValue([]);
    vi.spyOn(burnToken, 'getEffectiveFeeParams').mockResolvedValue(mockFees);
    vi.spyOn(burnToken, 'getJettonSupply').mockResolvedValue(mockSupplyMintOpen);

    const { result } = renderHook(() => useBurnToken());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(balanceErr);
    });

    expect(result.current.balance).toBeNull();
    expect(result.current.history).toEqual([]);
  });

  it('clears error and updates balance when poll succeeds after failed initial load', async () => {
    vi.useFakeTimers();

    const getBurnBalance = vi
      .spyOn(burnToken, 'getBurnBalance')
      .mockRejectedValueOnce(new burnToken.BurnTokenError('NETWORK_ERROR', 'RPC down'))
      .mockResolvedValue(99_000_000_000n);
    vi.spyOn(burnToken, 'getBurnHistory').mockResolvedValue([]);
    vi.spyOn(burnToken, 'getEffectiveFeeParams').mockResolvedValue(mockFees);
    vi.spyOn(burnToken, 'getJettonSupply').mockResolvedValue(mockSupplyMintOpen);

    const { result } = renderHook(() => useBurnToken());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).not.toBeNull();
    expect(result.current.balance).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
    });

    expect(result.current.balance).toBe(99_000_000_000n);
    expect(result.current.error).toBeNull();
    expect(getBurnBalance).toHaveBeenCalledTimes(2);
  });

  it('exposes supply from getJettonSupply on initial load', async () => {
    vi.spyOn(burnToken, 'getBurnBalance').mockResolvedValue(42_000_000_000n);
    vi.spyOn(burnToken, 'getBurnHistory').mockResolvedValue([]);
    vi.spyOn(burnToken, 'getEffectiveFeeParams').mockResolvedValue(mockFees);
    vi.spyOn(burnToken, 'getJettonSupply').mockResolvedValue(mockSupplyMintClosed);

    const { result } = renderHook(() => useBurnToken());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.supply).toEqual(mockSupplyMintClosed);
    });
  });

  it('keeps the balance snapshot when getJettonSupply fails', async () => {
    vi.spyOn(burnToken, 'getBurnBalance').mockResolvedValue(42_000_000_000n);
    vi.spyOn(burnToken, 'getBurnHistory').mockResolvedValue([]);
    vi.spyOn(burnToken, 'getEffectiveFeeParams').mockResolvedValue(mockFees);
    vi.spyOn(burnToken, 'getJettonSupply').mockRejectedValue(
      new burnToken.BurnTokenError('NETWORK_ERROR', 'supply RPC down'),
    );

    const { result } = renderHook(() => useBurnToken());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.balance).toBe(42_000_000_000n);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.supply).toBeNull();
  });

  it('does not call getBurnHistory on the 30s poll', async () => {
    vi.useFakeTimers();

    vi.spyOn(burnToken, 'getBurnBalance').mockResolvedValue(42_000_000_000n);
    const getBurnHistory = vi.spyOn(burnToken, 'getBurnHistory').mockResolvedValue([]);
    vi.spyOn(burnToken, 'getEffectiveFeeParams').mockResolvedValue(mockFees);
    vi.spyOn(burnToken, 'getJettonSupply').mockResolvedValue(mockSupplyMintOpen);

    renderHook(() => useBurnToken());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getBurnHistory).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
    });

    expect(getBurnHistory).not.toHaveBeenCalled();
  });

  it('loadHistory fills history without changing balance', async () => {
    const historyRow = {
      hash: 'tx-1',
      type: 'receive' as const,
      amount: 1_000_000_000n,
      counterparty: 'EQPeer',
      timestamp: 1_700_000_000_000,
      fee: null,
      status: 'confirmed' as const,
    };
    vi.spyOn(burnToken, 'getBurnBalance').mockResolvedValue(42_000_000_000n);
    vi.spyOn(burnToken, 'getBurnHistory').mockResolvedValue([historyRow]);
    vi.spyOn(burnToken, 'getEffectiveFeeParams').mockResolvedValue(mockFees);
    vi.spyOn(burnToken, 'getJettonSupply').mockResolvedValue(mockSupplyMintOpen);

    const { result } = renderHook(() => useBurnToken());

    await waitFor(() => {
      expect(result.current.balance).toBe(42_000_000_000n);
    });

    expect(result.current.history).toEqual([]);

    await act(async () => {
      await result.current.loadHistory();
    });

    expect(result.current.history).toEqual([historyRow]);
    expect(result.current.balance).toBe(42_000_000_000n);
    expect(result.current.error).toBeNull();
  });

  it('loadHistory reject leaves balance visible and history empty', async () => {
    vi.spyOn(burnToken, 'getBurnBalance').mockResolvedValue(42_000_000_000n);
    vi.spyOn(burnToken, 'getBurnHistory').mockRejectedValue(new Error('Ton Center 429'));
    vi.spyOn(burnToken, 'getEffectiveFeeParams').mockResolvedValue(mockFees);
    vi.spyOn(burnToken, 'getJettonSupply').mockResolvedValue(mockSupplyMintOpen);

    const { result } = renderHook(() => useBurnToken());

    await waitFor(() => {
      expect(result.current.balance).toBe(42_000_000_000n);
    });

    await act(async () => {
      await result.current.loadHistory();
    });

    expect(result.current.balance).toBe(42_000_000_000n);
    expect(result.current.error).toBeNull();
    expect(result.current.history).toEqual([]);
  });

  it('refetches supply on the 30s poll and keeps last snapshots if supply fails', async () => {
    vi.useFakeTimers();

    vi.spyOn(burnToken, 'getBurnBalance').mockResolvedValue(42_000_000_000n);
    vi.spyOn(burnToken, 'getBurnHistory').mockResolvedValue([]);
    vi.spyOn(burnToken, 'getEffectiveFeeParams').mockResolvedValue(mockFees);
    const getJettonSupply = vi
      .spyOn(burnToken, 'getJettonSupply')
      .mockResolvedValueOnce(mockSupplyMintClosed)
      .mockRejectedValueOnce(new burnToken.BurnTokenError('NETWORK_ERROR', 'supply poll failed'));

    const { result } = renderHook(() => useBurnToken());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.balance).toBe(42_000_000_000n);
    expect(result.current.supply).toEqual(mockSupplyMintClosed);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
    });

    expect(result.current.balance).toBe(42_000_000_000n);
    expect(result.current.supply).toEqual(mockSupplyMintClosed);
    expect(getJettonSupply).toHaveBeenCalledTimes(2);
  });
});

