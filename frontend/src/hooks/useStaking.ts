import { useCallback, useEffect, useRef, useState } from 'react';

import type { TxResult } from '@/ton/types';
import { StakingTier, type StakeInfo, type TierConfig } from '@/types/ton';
import {
  calculateApy as calculateApyOnChain,
  claimTx,
  getStakes,
  getTierConfigs,
  getPendingReward,
  stakeTx,
  unstakeTx,
} from '@/ton/staking';

import { useTonConnect } from './useTonConnect';

const PENDING_POLL_MS = 15_000;
const OPTIMISTIC_CLEAR_MS = 8_000;

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

/** Reactive staking state + Ton Connect–backed write operations. */
export interface UseStaking {
  stakes: StakeInfo[];
  tierConfigs: TierConfig[];
  pendingRewards: Partial<Record<StakingTier, bigint>>;
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [optimisticByTier, setOptimisticByTier] = useState<Partial<Record<StakingTier, bigint>>>({});

  const visibleRef = useRef(typeof document === 'undefined' ? true : document.visibilityState === 'visible');

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

      const rewardEntries = await Promise.all(
        ALL_TIERS.map(async (tier) => {
          const v = await getPendingReward(walletAddress, tier);
          return [tier, v] as const;
        }),
      );
      const pr: Partial<Record<StakingTier, bigint>> = {};
      for (const [tier, v] of rewardEntries) {
        if (v > 0n) {
          pr[tier] = v;
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

  const refreshPendingOnly = useCallback(async (): Promise<void> => {
    if (!walletAddress) {
      return;
    }
    try {
      const rewardEntries = await Promise.all(
        ALL_TIERS.map(async (tier) => {
          const v = await getPendingReward(walletAddress, tier);
          return [tier, v] as const;
        }),
      );
      const pr: Partial<Record<StakingTier, bigint>> = {};
      for (const [tier, v] of rewardEntries) {
        if (v > 0n) {
          pr[tier] = v;
        }
      }
      setPendingRewards(pr);

      setChainStakes((prev) =>
        prev.map((s) => {
          const next = pr[s.tier];
          return next !== undefined ? { ...s, pendingReward: next } : { ...s, pendingReward: 0n };
        }),
      );
    } catch {
      /* keep last snapshot on flaky RPC */
    }
  }, [walletAddress]);

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
        scheduleOptimisticClear();
      }
      return tx;
    },
    [walletAddress, scheduleOptimisticClear],
  );

  const unstake = useCallback(
    async (params: { tier: StakingTier; amount: bigint }): Promise<TxResult> => {
      if (!walletAddress) {
        return { ok: false, kind: 'unknown', message: 'Connect wallet before unstaking' };
      }
      const tx = await unstakeTx({ ...params, walletAddress });
      if (tx.ok) {
        void loadCore();
      }
      return tx;
    },
    [walletAddress, loadCore],
  );

  const claim = useCallback(
    async (params: { tier: StakingTier }): Promise<TxResult> => {
      if (!walletAddress) {
        return { ok: false, kind: 'unknown', message: 'Connect wallet before claiming' };
      }
      const tx = await claimTx({ ...params, walletAddress });
      if (tx.ok) {
        void loadCore();
      }
      return tx;
    },
    [walletAddress, loadCore],
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
    isLoading,
    error,
    refetch: loadCore,
    stake,
    unstake,
    claim,
    calculateApy,
  };
}
