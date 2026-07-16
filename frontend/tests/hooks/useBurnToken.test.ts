// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBurnToken } from '@/hooks/useBurnToken';
import { useTonConnect } from '@/hooks/useTonConnect';
import * as burnToken from '@/ton/burnToken';

const WALLET = '0QBNxdjqjhQP2OPaZHSRj06NRTd4z6-Trd6BdZ0DX0_9WJPD';

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

  it('shows balance when getBurnHistory fails (error only for balance path)', async () => {
    vi.spyOn(burnToken, 'getBurnBalance').mockResolvedValue(42_000_000_000n);
    vi.spyOn(burnToken, 'getBurnHistory').mockRejectedValue(new Error('Ton Center 429'));

    const { result } = renderHook(() => useBurnToken());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.balance).toBe(42_000_000_000n);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.history).toEqual([]);
    expect(result.current).not.toHaveProperty('feeParams');
  });

  it('sets error only when getBurnBalance fails', async () => {
    const balanceErr = new burnToken.BurnTokenError('CONFIG', 'jetton master missing');
    vi.spyOn(burnToken, 'getBurnBalance').mockRejectedValue(balanceErr);
    vi.spyOn(burnToken, 'getBurnHistory').mockResolvedValue([]);

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
});
