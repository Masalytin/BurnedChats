import { useCallback, useEffect, useRef, useState } from 'react';

import { getTonBalanceNano } from '@/ton/tonBalance';

/** Reactive native TON balance for wallet UI. */
export interface UseTonBalance {
  nano: bigint | null;
  isLoading: boolean;
  failed: boolean;
  refetch(): Promise<void>;
}

/**
 * Fetches native TON balance via Ton Center RPC.
 * Stale-while-revalidate on refetch; resets when disconnected or address is empty.
 */
export function useTonBalance(walletAddress: string | null, isConnected: boolean): UseTonBalance {
  const [nano, setNano] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const nanoRef = useRef(nano);
  nanoRef.current = nano;

  const fetchBalance = useCallback(async (addr: string, cancelled: { value: boolean }) => {
    const hasSnapshot = nanoRef.current !== null;

    if (!hasSnapshot) {
      setIsLoading(true);
      setFailed(false);
    }

    try {
      const balance = await getTonBalanceNano(addr);
      if (cancelled.value) return;
      setNano(balance);
      setFailed(false);
    } catch {
      if (cancelled.value) return;
      if (!hasSnapshot) {
        setNano(null);
        setFailed(true);
      }
      /* keep last snapshot on flaky RPC during refetch */
    } finally {
      if (!cancelled.value) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const addr = walletAddress?.trim();
    if (!isConnected || !addr) {
      setNano(null);
      setIsLoading(false);
      setFailed(false);
      return;
    }

    const cancelled = { value: false };
    void fetchBalance(addr, cancelled);

    return () => {
      cancelled.value = true;
    };
  }, [isConnected, walletAddress, fetchBalance]);

  const refetch = useCallback(async () => {
    const addr = walletAddress?.trim();
    if (!isConnected || !addr) {
      setNano(null);
      setIsLoading(false);
      setFailed(false);
      return;
    }

    const cancelled = { value: false };
    await fetchBalance(addr, cancelled);
  }, [isConnected, walletAddress, fetchBalance]);

  return { nano, isLoading, failed, refetch };
}
