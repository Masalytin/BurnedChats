// @vitest-environment happy-dom
import { createElement, type ReactNode } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StakingProvider } from '@/components/Staking/StakingProvider';
import { useStaking } from '@/hooks/useStaking';
import { useTonConnect } from '@/hooks/useTonConnect';
import * as staking from '@/ton/staking';
import { StakingError } from '@/ton/staking';
import { StakingTier, type TierConfig } from '@/types/ton';

const CATALOG: TierConfig[] = [
  { tier: StakingTier.Flexible, multiplier: 1, lockDurationSec: 0, rewardSharePercent: 5 },
  { tier: StakingTier.Silver, multiplier: 1.5, lockDurationSec: 15_552_000, rewardSharePercent: 10 },
  { tier: StakingTier.Gold, multiplier: 2, lockDurationSec: 31_536_000, rewardSharePercent: 25 },
  { tier: StakingTier.Diamond, multiplier: 3, lockDurationSec: 94_608_000, rewardSharePercent: 60 },
];

vi.mock('@/hooks/useTonConnect', () => ({
  useTonConnect: vi.fn(),
}));

const mockUseTonConnect = vi.mocked(useTonConnect);

function stakingWrapper({ children }: { children: ReactNode }) {
  return createElement(StakingProvider, null, children);
}

describe('useStaking catalog vs wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(staking, 'getStakingSnapshot').mockResolvedValue({
      stakes: [],
      tierConfigs: CATALOG,
      liveTierTvls: { [StakingTier.Gold]: 1_000n },
    });
    vi.spyOn(staking, 'getLastTierConfigSource').mockReturnValue('chain');
    vi.spyOn(staking, 'getLiveTierTvls').mockResolvedValue({});
    vi.spyOn(staking, 'getStakes').mockResolvedValue([]);
    vi.spyOn(staking, 'getTierConfigs').mockResolvedValue(CATALOG);
    vi.spyOn(staking, 'getPendingRewards').mockResolvedValue({});
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('loads public tier catalog via snapshot when no wallet is connected', async () => {
    mockUseTonConnect.mockReturnValue({
      walletAddress: null,
      isConnected: false,
    } as ReturnType<typeof useTonConnect>);

    const { result } = renderHook(() => useStaking(), { wrapper: stakingWrapper });

    await waitFor(() => {
      expect(result.current.tierConfigs).toEqual(CATALOG);
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalled();
    const snapArg = vi.mocked(staking.getStakingSnapshot).mock.calls[0]?.[0];
    expect(snapArg?.address).toBeUndefined();
    expect(staking.getLiveTierTvls).not.toHaveBeenCalled();
    expect(staking.getStakes).not.toHaveBeenCalled();
    expect(staking.getTierConfigs).not.toHaveBeenCalled();
    expect(result.current.stakes).toEqual([]);
    expect(result.current.liveTierTvls[StakingTier.Gold]).toBe(1_000n);
  });

  it('loads personal stakes together with the catalog from one snapshot when a wallet is connected', async () => {
    mockUseTonConnect.mockReturnValue({
      walletAddress: 'EQtest_address',
      isConnected: true,
    } as ReturnType<typeof useTonConnect>);

    vi.mocked(staking.getStakingSnapshot).mockResolvedValue({
      stakes: [
        {
          tier: StakingTier.Gold,
          amount: 5_000_000_000n,
          startTime: 1,
          unlockTime: 2,
          lastClaimTime: 1,
          pendingReward: 10n,
        },
      ],
      tierConfigs: CATALOG,
      liveTierTvls: {},
    });

    const { result } = renderHook(() => useStaking(), { wrapper: stakingWrapper });

    await waitFor(() => {
      expect(result.current.tierConfigs).toEqual(CATALOG);
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'EQtest_address' }),
    );
    expect(staking.getStakes).not.toHaveBeenCalled();
    expect(staking.getLiveTierTvls).not.toHaveBeenCalled();
  });

  it('sets error on 502 and Retry does not call Toncenter helpers', async () => {
    mockUseTonConnect.mockReturnValue({
      walletAddress: 'EQtest_address',
      isConnected: true,
    } as ReturnType<typeof useTonConnect>);

    vi.mocked(staking.getStakingSnapshot).mockRejectedValue(
      new StakingError('NETWORK_ERROR', 'staking.rpcUnavailable'),
    );

    const { result } = renderHook(() => useStaking(), { wrapper: stakingWrapper });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(StakingError);
    });
    expect(result.current.error?.message).toBe('staking.rpcUnavailable');
    expect(staking.getLiveTierTvls).not.toHaveBeenCalled();
    expect(staking.getStakes).not.toHaveBeenCalled();
    expect(staking.getPendingRewards).not.toHaveBeenCalled();

    await result.current.refetch();

    expect(staking.getStakingSnapshot).toHaveBeenCalled();
    expect(staking.getLiveTierTvls).not.toHaveBeenCalled();
    expect(staking.getStakes).not.toHaveBeenCalled();
    expect(staking.getPendingRewards).not.toHaveBeenCalled();
  });

  it('does not issue a second TVL fetch on mount (duplicate useEffect removed)', async () => {
    mockUseTonConnect.mockReturnValue({
      walletAddress: null,
      isConnected: false,
    } as ReturnType<typeof useTonConnect>);

    renderHook(() => useStaking(), { wrapper: stakingWrapper });

    await waitFor(() => {
      expect(staking.getStakingSnapshot).toHaveBeenCalled();
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(1);
    expect(staking.getLiveTierTvls).not.toHaveBeenCalled();
  });

  it('throws when used outside StakingProvider', () => {
    expect(() => renderHook(() => useStaking())).toThrow(
      'useStaking must be used within a StakingProvider',
    );
  });

  it('two useStaking consumers share one getStakingSnapshot load', async () => {
    mockUseTonConnect.mockReturnValue({
      walletAddress: null,
      isConnected: false,
    } as ReturnType<typeof useTonConnect>);

    function Reader() {
      useStaking();
      return null;
    }

    render(
      createElement(
        StakingProvider,
        null,
        createElement(Reader),
        createElement(Reader),
      ),
    );

    await waitFor(() => {
      expect(staking.getStakingSnapshot).toHaveBeenCalled();
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('useStaking poll and post-tx refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUseTonConnect.mockReturnValue({
      walletAddress: 'EQtest_address',
      isConnected: true,
    } as ReturnType<typeof useTonConnect>);
    vi.spyOn(staking, 'getStakingSnapshot').mockResolvedValue({
      stakes: [],
      tierConfigs: CATALOG,
      liveTierTvls: {},
    });
    vi.spyOn(staking, 'getLastTierConfigSource').mockReturnValue('chain');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls snapshot every 30s and not at 15s', async () => {
    renderHook(() => useStaking(), { wrapper: stakingWrapper });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(2);
    expect(vi.mocked(staking.getStakingSnapshot).mock.calls[1]?.[0]?.fresh).not.toBe(true);
  });

  it('does not GET on the poll timer while the tab is hidden', async () => {
    renderHook(() => useStaking(), { wrapper: stakingWrapper });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(1);
  });

  it('after ok stake issues exactly one fresh snapshot and no TX_REFRESH triple', async () => {
    vi.spyOn(staking, 'stakeTx').mockResolvedValue({
      tx: { ok: true, boc: 'te6c' },
      netStakedNano: 1_000_000_000n,
    });

    const { result } = renderHook(() => useStaking(), { wrapper: stakingWrapper });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.stake({ tier: StakingTier.Gold, amount: 1_000_000_000n });
    });

    const freshCalls = vi.mocked(staking.getStakingSnapshot).mock.calls.filter((c) => c[0]?.fresh === true);
    expect(freshCalls).toHaveLength(1);
    expect(freshCalls[0]?.[0]).toEqual(expect.objectContaining({ address: 'EQtest_address', fresh: true }));
    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(3);
    expect(vi.mocked(staking.getStakingSnapshot).mock.calls[2]?.[0]?.fresh).not.toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(3);
  });

  it('after ok unstake issues exactly one fresh snapshot and no delayed loadCore', async () => {
    vi.spyOn(staking, 'unstakeTx').mockResolvedValue({ ok: true, boc: 'te6c' });

    const { result } = renderHook(() => useStaking(), { wrapper: stakingWrapper });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.unstake({ tier: StakingTier.Gold, amount: 1_000_000_000n });
    });

    const freshCalls = vi.mocked(staking.getStakingSnapshot).mock.calls.filter((c) => c[0]?.fresh === true);
    expect(freshCalls).toHaveLength(1);
    expect(freshCalls[0]?.[0]).toEqual(expect.objectContaining({ address: 'EQtest_address', fresh: true }));
    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(2);
  });

  it('after ok claim issues exactly one fresh snapshot and no delayed loadCore', async () => {
    vi.spyOn(staking, 'claimTx').mockResolvedValue({ ok: true, boc: 'te6c' });

    const { result } = renderHook(() => useStaking(), { wrapper: stakingWrapper });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.claim({ tier: StakingTier.Gold });
    });

    const freshCalls = vi.mocked(staking.getStakingSnapshot).mock.calls.filter((c) => c[0]?.fresh === true);
    expect(freshCalls).toHaveLength(1);
    expect(freshCalls[0]?.[0]).toEqual(expect.objectContaining({ address: 'EQtest_address', fresh: true }));
    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(2);
  });

  it('keeps last snapshot pending until the next GET (no interpolation)', async () => {
    vi.mocked(staking.getStakingSnapshot).mockResolvedValue({
      stakes: [
        {
          tier: StakingTier.Gold,
          amount: 5_000_000_000n,
          startTime: 1,
          unlockTime: 2,
          lastClaimTime: 1,
          pendingReward: 10n,
        },
      ],
      tierConfigs: CATALOG,
      liveTierTvls: {},
    });

    const { result } = renderHook(() => useStaking(), { wrapper: stakingWrapper });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.pendingRewards[StakingTier.Gold]).toBe(10n);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });

    expect(result.current.pendingRewards[StakingTier.Gold]).toBe(10n);
    expect(staking.getStakingSnapshot).toHaveBeenCalledTimes(1);
  });
});
