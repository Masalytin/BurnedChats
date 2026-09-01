// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useTonBalance } from './useTonBalance';
import { getTonBalanceNano, TonBalanceError } from '@/ton/tonBalance';

vi.mock('@/ton/tonBalance', () => ({
  getTonBalanceNano: vi.fn(),
  TonBalanceError: class TonBalanceError extends Error {
    kind: string;
    constructor(message: string, kind: string) {
      super(message);
      this.name = 'TonBalanceError';
      this.kind = kind;
    }
  },
}));

vi.mock('@/components/DebugPanel', () => ({
  debugLog: vi.fn(),
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
    expect(result.current.refreshFailed).toBe(false);
    expect(result.current.errorKind).toBeNull();
  });

  it('sets failed on first fetch error and clears after retry succeeds', async () => {
    mockedGetTonBalanceNano.mockRejectedValueOnce(new TonBalanceError('RPC down', 'network'));

    const { result } = renderHook(() => useTonBalance('EQtest_address', true));

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });

    expect(result.current.nano).toBeNull();
    expect(result.current.errorKind).toBe('network');
    expect(result.current.lastErrorAt).not.toBeNull();

    mockedGetTonBalanceNano.mockResolvedValueOnce(2_000_000_000n);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.nano).toBe(2_000_000_000n);
    expect(result.current.failed).toBe(false);
    expect(result.current.refreshFailed).toBe(false);
    expect(result.current.errorKind).toBeNull();
  });

  it('refetches and keeps snapshot on flaky refresh', async () => {
    mockedGetTonBalanceNano.mockResolvedValueOnce(2_000_000_000n);

    const { result } = renderHook(() => useTonBalance('EQtest_address', true));

    await waitFor(() => {
      expect(result.current.nano).toBe(2_000_000_000n);
    });

    mockedGetTonBalanceNano.mockRejectedValueOnce(new TonBalanceError('RPC down', 'network'));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.nano).toBe(2_000_000_000n);
    expect(result.current.failed).toBe(false);
    expect(result.current.refreshFailed).toBe(true);
    expect(result.current.errorKind).toBe('network');
  });

  it('clears failed state when wallet disconnects', async () => {
    mockedGetTonBalanceNano.mockRejectedValueOnce(new TonBalanceError('RPC down', 'network'));

    const { result, rerender } = renderHook<
      ReturnType<typeof useTonBalance>,
      { addr: string | null; connected: boolean }
    >(
      ({ addr, connected }) => useTonBalance(addr, connected),
      { initialProps: { addr: 'EQtest_address', connected: true } },
    );

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });

    rerender({ addr: null, connected: false });

    expect(result.current.nano).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.failed).toBe(false);
    expect(result.current.refreshFailed).toBe(false);
    expect(result.current.errorKind).toBeNull();
  });

  it('resets state when disconnected after success', async () => {
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

  it('applies backoff on rapid manual refetch', async () => {
    mockedGetTonBalanceNano.mockRejectedValueOnce(new TonBalanceError('RPC down', 'network'));

    const { result } = renderHook(() => useTonBalance('EQtest_address', true));

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });

    mockedGetTonBalanceNano.mockResolvedValueOnce(500_000_000n);

    await act(async () => {
      await Promise.all([result.current.refetch(), result.current.refetch()]);
    });

    expect(mockedGetTonBalanceNano).toHaveBeenCalledTimes(2);
  });
});
