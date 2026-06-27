// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useTonBalance } from './useTonBalance';
import { getTonBalanceNano } from '@/ton/tonBalance';

vi.mock('@/ton/tonBalance', () => ({
  getTonBalanceNano: vi.fn(),
}));

const mockedGetTonBalanceNano = vi.mocked(getTonBalanceNano);

describe('useTonBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches balance on mount when connected with address', async () => {
    mockedGetTonBalanceNano.mockResolvedValueOnce(1_500_000_000n);

    const { result } = renderHook(() => useTonBalance('EQtest_address', true));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockedGetTonBalanceNano).toHaveBeenCalledWith('EQtest_address');
    expect(result.current.nano).toBe(1_500_000_000n);
    expect(result.current.failed).toBe(false);
  });

  it('refetches and keeps snapshot on flaky RPC', async () => {
    mockedGetTonBalanceNano.mockResolvedValueOnce(2_000_000_000n);

    const { result } = renderHook(() => useTonBalance('EQtest_address', true));

    await waitFor(() => {
      expect(result.current.nano).toBe(2_000_000_000n);
    });

    mockedGetTonBalanceNano.mockRejectedValueOnce(new Error('RPC down'));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.nano).toBe(2_000_000_000n);
    expect(result.current.failed).toBe(false);
  });

  it('resets state when disconnected', async () => {
    mockedGetTonBalanceNano.mockResolvedValueOnce(1_000_000_000n);

    const { result, rerender } = renderHook<
      ReturnType<typeof useTonBalance>,
      { addr: string | null; connected: boolean }
    >(
      ({ addr, connected }) => useTonBalance(addr, connected),
      { initialProps: { addr: 'EQtest_address', connected: true } },
    );

    await waitFor(() => {
      expect(result.current.nano).toBe(1_000_000_000n);
    });

    rerender({ addr: null, connected: false });

    expect(result.current.nano).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.failed).toBe(false);
  });

  it('cancels in-flight fetch on unmount', async () => {
    let resolveFetch: (value: bigint) => void = () => {};
    mockedGetTonBalanceNano.mockImplementationOnce(
      () =>
        new Promise<bigint>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { unmount } = renderHook(() => useTonBalance('EQtest_address', true));

    unmount();

    await act(async () => {
      resolveFetch(9_000_000_000n);
    });

    expect(mockedGetTonBalanceNano).toHaveBeenCalledTimes(1);
  });

  it('refetches on address change', async () => {
    mockedGetTonBalanceNano.mockResolvedValueOnce(1_000_000_000n);

    const { result, rerender } = renderHook(
      ({ addr }) => useTonBalance(addr, true),
      { initialProps: { addr: 'EQaddr_a' } },
    );

    await waitFor(() => {
      expect(result.current.nano).toBe(1_000_000_000n);
    });

    mockedGetTonBalanceNano.mockResolvedValueOnce(3_000_000_000n);
    rerender({ addr: 'EQaddr_b' });

    await waitFor(() => {
      expect(result.current.nano).toBe(3_000_000_000n);
    });

    expect(mockedGetTonBalanceNano).toHaveBeenCalledWith('EQaddr_b');
  });
});
