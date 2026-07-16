import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BurnTokenError,
  getBurnBalance,
  getBurnHistory,
  transferBurn,
  type TransferParams,
  type TransferProgressPayload,
} from '@/ton/burnToken';
import type { TxResult } from '@/ton/types';
import type { BurnTransaction } from '@/types/ton';

import { useTonConnect } from './useTonConnect';

const BALANCE_POLL_MS = 30_000;

/** Card contract: reactive BURN jetton wallet state for UI. */
export interface UseBurnToken {
  balance: bigint | null;
  history: BurnTransaction[];
  isLoading: boolean;
  /** True during refetch when a balance snapshot is already on screen. */
  isRefreshing: boolean;
  error: Error | null;
  refetch(): Promise<void>;
  transfer(params: TransferParams): Promise<TxResult>;
  /** Progress through signing + Ton Center confirmation polling. */
  transferProgress: TransferProgressPayload | null;
}

/**
 * BURN balance / history with 30s polling when the document is visible.
 * WebSocket real-time updates are not wired (optional in Phase 5 — backend/SSE can replace polling later).
 */
export function useBurnToken(): UseBurnToken {
  const { walletAddress, isConnected } = useTonConnect();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [history, setHistory] = useState<BurnTransaction[]>([]);
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

  const loadHistory = useCallback(async (addr: string) => {
    try {
      const rows = await getBurnHistory(addr, 50);
      setHistory(rows);
    } catch {
      setHistory([]);
    }
  }, []);

  const load = useCallback(async () => {
    if (!walletAddress) {
      setBalance(null);
      setHistory([]);
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
      const nano = await getBurnBalance(walletAddress);
      setBalance(nano);
      setError(null);
    } catch (e) {
      if (!hasSnapshot) {
        setError(e instanceof Error ? e : new Error(String(e)));
        setBalance(null);
      }
      /* keep last snapshot on flaky RPC during refetch */
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }

    void loadHistory(walletAddress);
  }, [walletAddress, loadHistory]);

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
        try {
          const nano = await getBurnBalance(walletAddress);
          setBalance(nano);
          setError(null);
        } catch {
          /* keep last snapshot to avoid flashing errors on flaky RPC */
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

  return {
    balance,
    history,
    isLoading,
    isRefreshing,
    error,
    refetch: load,
    transfer,
    transferProgress,
  };
}
