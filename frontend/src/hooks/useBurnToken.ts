import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BurnTokenError,
  burnJetton,
  getBurnBalance,
  getBurnHistory,
  getEffectiveFeeParams,
  getJettonSupply,
  transferBurn,
  type TransferParams,
  type TransferProgressPayload,
} from '@/ton/burnToken';
import type { JettonSupply } from '@/ton/burnSupply';
import type { TxResult } from '@/ton/types';
import type { BurnTransaction, EffectiveFeeParams } from '@/types/ton';

import { useTonConnect } from './useTonConnect';

const BALANCE_POLL_MS = 30_000;

/** Card contract: reactive BURN jetton wallet state for UI. */
export interface UseBurnToken {
  balance: bigint | null;
  /** Network circulating / burned from `get_jetton_data`; null until first success. */
  supply: JettonSupply | null;
  history: BurnTransaction[];
  isLoading: boolean;
  /** True during refetch when a balance snapshot is already on screen. */
  isRefreshing: boolean;
  error: Error | null;
  feeParams: EffectiveFeeParams | null;
  refetch(): Promise<void>;
  transfer(params: TransferParams): Promise<TxResult>;
  /** Voluntary TEP-74 burn of liquid JW balance. */
  burn(params: { amount: bigint }): Promise<TxResult>;
  /** Progress through signing + Ton Center confirmation polling. */
  transferProgress: TransferProgressPayload | null;
}

/**
 * BURN balance / history / fee params with 30s polling when the document is visible.
 * WebSocket real-time updates are not wired (optional in Phase 5 — backend/SSE can replace polling later).
 */
export function useBurnToken(): UseBurnToken {
  const { walletAddress, isConnected } = useTonConnect();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [supply, setSupply] = useState<JettonSupply | null>(null);
  const [history, setHistory] = useState<BurnTransaction[]>([]);
  const [feeParams, setFeeParams] = useState<EffectiveFeeParams | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const [transferProgress, setTransferProgress] = useState<TransferProgressPayload | null>(null);

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

  const loadHistoryAndFees = useCallback(async (addr: string) => {
    const [historyResult, feesResult] = await Promise.allSettled([
      getBurnHistory(addr, 50),
      getEffectiveFeeParams(),
    ]);
    if (historyResult.status === 'fulfilled') {
      setHistory(historyResult.value);
    } else {
      setHistory([]);
    }
    if (feesResult.status === 'fulfilled') {
      setFeeParams(feesResult.value);
    }
  }, []);

  const load = useCallback(async () => {
    if (!walletAddress) {
      setBalance(null);
      setSupply(null);
      setHistory([]);
      setFeeParams(null);
      setError(null);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    const hasSnapshot = balanceRef.current !== null;

    if (hasSnapshot) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
      setError(null);
    }

    try {
      const [balanceResult, supplyResult] = await Promise.allSettled([
        getBurnBalance(walletAddress),
        getJettonSupply(),
      ]);
      if (balanceResult.status === 'fulfilled') {
        setBalance(balanceResult.value);
        setError(null);
      } else if (!hasSnapshot) {
        const e = balanceResult.reason;
        setError(e instanceof Error ? e : new Error(String(e)));
        setBalance(null);
      }
      if (supplyResult.status === 'fulfilled') {
        setSupply(supplyResult.value);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }

    void loadHistoryAndFees(walletAddress);
  }, [walletAddress, loadHistoryAndFees]);

  useEffect(() => {
    void load();
  }, [walletAddress, load]);

  useEffect(() => {
    if (!walletAddress || !isConnected) {
      return;
    }

    const id = window.setInterval(() => {
      if (!visibleRef.current) {
        return;
      }
      void (async () => {
        const [balanceResult, supplyResult] = await Promise.allSettled([
          getBurnBalance(walletAddress),
          getJettonSupply(),
        ]);
        if (balanceResult.status === 'fulfilled') {
          setBalance(balanceResult.value);
          setError(null);
        }
        if (supplyResult.status === 'fulfilled') {
          setSupply(supplyResult.value);
        }
      })();
    }, BALANCE_POLL_MS);

    return () => window.clearInterval(id);
  }, [walletAddress, isConnected]);

  const transfer = useCallback(
    async (params: TransferParams): Promise<TxResult> => {
      if (!walletAddress) {
        const errMsg = 'Connect wallet before transferring BURN';
        const err = new BurnTokenError('UNKNOWN', errMsg);
        setTransferProgress({ phase: 'failed', error: err });
        return { ok: false, kind: 'unknown', message: errMsg };
      }

      setTransferProgress({ phase: 'idle' });

      try {
        return await transferBurn(
          { ...params, walletAddress },
          {
            onTransferProgress: (p) => {
              setTransferProgress(p);
            },
          },
        );
      } finally {
        await load();
      }
    },
    [walletAddress, load],
  );

  const burn = useCallback(
    async (params: { amount: bigint }): Promise<TxResult> => {
      if (!walletAddress) {
        const errMsg = 'Connect wallet before burning BURN';
        const err = new BurnTokenError('UNKNOWN', errMsg);
        setTransferProgress({ phase: 'failed', error: err });
        return { ok: false, kind: 'unknown', message: errMsg };
      }

      setTransferProgress({ phase: 'idle' });

      try {
        return await burnJetton(
          { ...params, walletAddress },
          {
            onTransferProgress: (p) => {
              setTransferProgress(p);
            },
          },
        );
      } finally {
        await load();
      }
    },
    [walletAddress, load],
  );

  return {
    balance,
    supply,
    history,
    isLoading,
    isRefreshing,
    error,
    feeParams,
    refetch: load,
    transfer,
    burn,
    transferProgress,
  };
}
