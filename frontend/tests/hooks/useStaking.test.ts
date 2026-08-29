// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStaking } from '@/hooks/useStaking';
import { useTonConnect } from '@/hooks/useTonConnect';
import * as staking from '@/ton/staking';
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

describe('useStaking catalog vs wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(staking, 'getTierConfigs').mockResolvedValue(CATALOG);
    vi.spyOn(staking, 'getLastTierConfigSource').mockReturnValue('chain');
    vi.spyOn(staking, 'getLiveTierTvls').mockResolvedValue({});
    vi.spyOn(staking, 'getStakes').mockResolvedValue([]);
    vi.spyOn(staking, 'getPendingRewards').mockResolvedValue({});
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('loads public tier catalog when no wallet is connected', async () => {
    mockUseTonConnect.mockReturnValue({
      walletAddress: null,
      isConnected: false,
    } as ReturnType<typeof useTonConnect>);

    const { result } = renderHook(() => useStaking());

    await waitFor(() => {
      expect(result.current.tierConfigs).toEqual(CATALOG);
    });

    expect(staking.getTierConfigs).toHaveBeenCalled();
    expect(staking.getStakes).not.toHaveBeenCalled();
    expect(result.current.stakes).toEqual([]);
  });

  it('loads personal stakes together with the catalog when a wallet is connected', async () => {
    mockUseTonConnect.mockReturnValue({
      walletAddress: 'EQtest_address',
      isConnected: true,
    } as ReturnType<typeof useTonConnect>);

    const { result } = renderHook(() => useStaking());

    await waitFor(() => {
      expect(result.current.tierConfigs).toEqual(CATALOG);
    });

    expect(staking.getStakes).toHaveBeenCalledWith('EQtest_address');
  });
});
