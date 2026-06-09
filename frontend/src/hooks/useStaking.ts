import { useCallback, useEffect, useRef, useState } from 'react';

import type { TxResult } from '@/ton/types';
import { StakingTier, type StakeInfo, type TierConfig } from '@/types/ton';
import {
  calculateApy as calculateApyOnChain,
  claimTx,
  getPendingRewards,
  getStakes,
  getTierConfigs,
  stakeTx,
  unstakeTx,
} from '@/ton/staking';

import { useTonConnect } from './useTonConnect';

const PENDING_POLL_MS = 15_000;
const OPTIMISTIC_CLEAR_MS = 8_000;
const TX_REFRESH_INITIAL_MS = 5_000;
const TX_REFRESH_RETRY_MS = 3_000;
const TX_REFRESH_ATTEMPTS = 3;

const ALL_TIERS: StakingTier[] = [
  StakingTier.Flexible,
  StakingTier.Silver,
  StakingTier.Gold,
  StakingTier.Diamond,
];

function mergeOptimistic(chain: StakeInfo[], extra: Partial<Record<StakingTier, bigint>>): StakeInfo[] {
  const byTier = new Map<StakingTier, StakeInfo>(chain.map((s) => [s.tier, { ...s }]));
  for (const tier of ALL_TIERS) {
    const add = extra[tier];
    if (add === undefined || add <= 0n) {
      continue;
    }
    const cur = byTier.get(tier);
    if (cur) {
      const prevOpt = cur.optimisticExtra ?? 0n;
      byTier.set(tier, {
        ...cur,
        amount: cur.amount + add,
        optimisticExtra: prevOpt + add,
      });
    } else {
      byTier.set(tier, {
        tier,
        amount: add,
        startTime: Math.floor(Date.now() / 1000),
        unlockTime: 0,
        lastClaimTime: 0,
        pendingReward: 0n,
        optimisticExtra: add,
      });
    }
  }
  return ALL_TIERS.flatMap((t) => {
    const s = byTier.get(t);
    return s !== undefined && s.amount > 0n ? [s] : [];
  });
}

function applyPendingToStakes(
  stakes: StakeInfo[],
  pendingRewards: Partial<Record<StakingTier, bigint>>,
): StakeInfo[] {
  return stakes.map((s) => {
    const next = pendingRewards[s.tier];
    return next !== undefined ? { ...s, pendingReward: next } : { ...s, pendingReward: 0n };
  });
}

/** Reactive staking state + Ton Connect–backed write operations. */
export interface UseStaking {
  stakes: StakeInfo[];
  tierConfigs: TierConfig[];
  pendingRewards: Partial<Record<StakingTier, bigint>>;
  /** True while pending rewards are being refreshed (poll or post-tx). */
  rewardsRefreshing: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch(): Promise<void>;
  stake(params: { tier: StakingTier; amount: bigint }): Promise<TxResult>;
  unstake(params: { tier: StakingTier; amount: bigint }): Promise<TxResult>;
  claim(params: { tier: StakingTier }): Promise<TxResult>;
  /**
   * Indicative APY for UI: uses an illustrative tier TVL of `6 × stakeAmount` when total tier stake is unknown (see TOKENOMICS examples).
   */
  calculateApy(tier: StakingTier, stakeAmount: bigint): number;
}

export function useStaking(): UseStaking {
  const { walletAddress, isConnected } = useTonConnect();

  const [chainStakes, setChainStakes] = useState<StakeInfo[]>([]);
  const [tierConfigs, setTierConfigs] = useState<TierConfig[]>([]);
  const [pendingRewards, setPendingRewards] = useState<Partial<Record<StakingTier, bigint>>>({});
  const [rewardsRefreshing, setRewardsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [optimisticByTier, setOptimisticByTier] = useState<Partial<Record<StakingTier, bigint>>>({});

  const visibleRef = useRef(typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  const txRefreshTimersRef = useRef<number[]>([]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const handler = (): void => {
      visibleRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => {
    return () => {
      for (const id of txRefreshTimersRef.current) {
        window.clearTimeout(id);
      }
      txRefreshTimersRef.current = [];
    };
  }, []);

  const refreshPendingOnly = useCallback(async (): Promise<void> => {
    if (!walletAddress) {
      return;
    }
    setRewardsRefreshing(true);
    try {
      const pr = await getPendingRewards(walletAddress);
      setPendingRewards(pr);
      setChainStakes((prev) => applyPendingToStakes(prev, pr));
    } catch {
      /* keep last snapshot on flaky RPC */
    } finally {
      setRewardsRefreshing(false);
    }
  }, [walletAddress]);

  const scheduleTxTriggeredRefresh = useCallback(() => {
    for (const id of txRefreshTimersRef.current) {
      window.clearTimeout(id);
    }
    txRefreshTimersRef.current = [];

    let attempt = 0;
    const runRefresh = (): void => {
      attempt += 1;
      void refreshPendingOnly();
      if (attempt < TX_REFRESH_ATTEMPTS) {
        const retryId = window.setTimeout(runRefresh, TX_REFRESH_RETRY_MS);
        txRefreshTimersRef.current.push(retryId);
      }
    };

    const initialId = window.setTimeout(runRefresh, TX_REFRESH_INITIAL_MS);
    txRefreshTimersRef.current.push(initialId);
  }, [refreshPendingOnly]);

  const loadCore = useCallback(async (): Promise<void> => {
    if (!walletAddress) {
      setChainStakes([]);
      setTierConfigs([]);
      setPendingRewards({});
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [stakes, cfgs] = await Promise.all([getStakes(walletAddress), getTierConfigs()]);
      setChainStakes(stakes);
      setTierConfigs(cfgs);
      const pr: Partial<Record<StakingTier, bigint>> = {};
      for (const s of stakes) {
        if (s.pendingReward > 0n) {
          pr[s.tier] = s.pendingReward;
        }
      }
      setPendingRewards(pr);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void loadCore();
  }, [walletAddress, loadCore]);

  useEffect(() => {
    if (!walletAddress || !isConnected) {
      return;
    }
    const id = window.setInterval(() => {
      if (!visibleRef.current) {
        return;
      }
      void refreshPendingOnly();
    }, PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [walletAddress, isConnected, refreshPendingOnly]);

  const scheduleOptimisticClear = useCallback(() => {
    window.setTimeout(() => {
      setOptimisticByTier({});
      void loadCore();
    }, OPTIMISTIC_CLEAR_MS);
  }, [loadCore]);

  const stake = useCallback(
    async (params: { tier: StakingTier; amount: bigint }): Promise<TxResult> => {
      if (!walletAddress) {
        return { ok: false, kind: 'unknown', message: 'Connect wallet before staking' };
      }
      const tx = await stakeTx({ ...params, walletAddress });
      if (tx.ok) {
        setOptimisticByTier((prev) => ({
          ...prev,
          [params.tier]: (prev[params.tier] ?? 0n) + params.amount,
        }));
        scheduleTxTriggeredRefresh();
        scheduleOptimisticClear();
      }
      return tx;
    },
    [walletAddress, scheduleOptimisticClear, scheduleTxTriggeredRefresh],
  );

  const unstake = useCallback(
    async (params: { tier: StakingTier; amount: bigint }): Promise<TxResult> => {
      if (!walletAddress) {
        return { ok: false, kind: 'unknown', message: 'Connect wallet before unstaking' };
      }
      const tx = await unstakeTx({ ...params, walletAddress });
      if (tx.ok) {
        scheduleTxTriggeredRefresh();
        window.setTimeout(() => void loadCore(), TX_REFRESH_INITIAL_MS);
      }
      return tx;
    },
    [walletAddress, loadCore, scheduleTxTriggeredRefresh],
  );

  const claim = useCallback(
    async (params: { tier: StakingTier }): Promise<TxResult> => {
      if (!walletAddress) {
        return { ok: false, kind: 'unknown', message: 'Connect wallet before claiming' };
      }
      const tx = await claimTx({ ...params, walletAddress });
      if (tx.ok) {
        scheduleTxTriggeredRefresh();
        window.setTimeout(() => void loadCore(), TX_REFRESH_INITIAL_MS);
      }
      return tx;
    },
    [walletAddress, loadCore, scheduleTxTriggeredRefresh],
  );

  const calculateApy = useCallback((tier: StakingTier, stakeAmount: bigint): number => {
    if (stakeAmount <= 0n) {
      return 0;
    }
    const illustrativeTierTvl = stakeAmount * 6n;
    return calculateApyOnChain(tier, stakeAmount, illustrativeTierTvl);
  }, []);

  const mergedStakes = mergeOptimistic(chainStakes, optimisticByTier);
  const stakes = mergedStakes.map((s) => ({
    ...s,
    pendingReward: pendingRewards[s.tier] ?? s.pendingReward,
  }));

  return {
    stakes,
    tierConfigs,
    pendingRewards,
    rewardsRefreshing,
    isLoading,
    error,
    refetch: loadCore,
    stake,
    unstake,
    claim,
    calculateApy,
  };
}
