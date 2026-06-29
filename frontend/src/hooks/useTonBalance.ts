import { useCallback, useEffect, useRef, useState } from 'react';

import { debugLog } from '@/components/DebugPanel';
import { getTonBalanceNano, TonBalanceError, type TonBalanceErrorKind } from '@/ton/tonBalance';

const MANUAL_REFETCH_BACKOFF_MS = 1_000;

/** Reactive native TON balance for wallet UI. */
export interface UseTonBalance {
  nano: bigint | null;
  isLoading: boolean;
  /** First load failed with no snapshot yet. */
  failed: boolean;
  /** Last refresh failed but a stale snapshot is still shown (SWR). */
  refreshFailed: boolean;
  errorKind: TonBalanceErrorKind | null;
  lastErrorAt: number | null;
  refetch(): Promise<void>;
}

function errorKindFromUnknown(err: unknown): TonBalanceErrorKind {
  if (err instanceof TonBalanceError) {
    return err.kind;
  }
  return 'network';
}

/**
 * Fetches native TON balance via Ton Center RPC.
 * Stale-while-revalidate on refetch; resets when disconnected or address is empty.
 */
export function useTonBalance(walletAddress: string | null, isConnected: boolean): UseTonBalance {
  const [nano, setNano] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [errorKind, setErrorKind] = useState<TonBalanceErrorKind | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<number | null>(null);

  const nanoRef = useRef(nano);
  nanoRef.current = nano;

  const lastManualRefetchAtRef = useRef(0);

  const recordRpcError = useCallback((err: unknown, addr: string, hasSnapshot: boolean) => {
    const kind = errorKindFromUnknown(err);
    setErrorKind(kind);
    setLastErrorAt(Date.now());

    if (import.meta.env.DEV) {
      debugLog('warn', '[Wallet] GRAM balance RPC failed', {
        kind,
        hasSnapshot,
        addressPrefix: addr.slice(0, 6),
      });
    }
  }, []);

  const fetchBalance = useCallback(
    async (addr: string, cancelled: { value: boolean }, options?: { manual?: boolean }) => {
      if (options?.manual) {
        const now = Date.now();
        if (now - lastManualRefetchAtRef.current < MANUAL_REFETCH_BACKOFF_MS) {
          return;
        }
        lastManualRefetchAtRef.current = now;
      }

      const hasSnapshot = nanoRef.current !== null;

      if (!hasSnapshot) {
        setIsLoading(true);
        setFailed(false);
        setRefreshFailed(false);
        setErrorKind(null);
        setLastErrorAt(null);
      }

      try {
        const balance = await getTonBalanceNano(addr);
        if (cancelled.value) return;
        setNano(balance);
        setFailed(false);
        setRefreshFailed(false);
        setErrorKind(null);
        setLastErrorAt(null);
      } catch (err) {
        if (cancelled.value) return;
        recordRpcError(err, addr, hasSnapshot);
        if (!hasSnapshot) {
          setNano(null);
          setFailed(true);
          setRefreshFailed(false);
        } else {
          setRefreshFailed(true);
        }
      } finally {
        if (!cancelled.value) {
          setIsLoading(false);
        }
      }
    },
    [recordRpcError],
  );

  useEffect(() => {
    const addr = walletAddress?.trim();
    if (!isConnected || !addr) {
      setNano(null);
      setIsLoading(false);
      setFailed(false);
      setRefreshFailed(false);
      setErrorKind(null);
      setLastErrorAt(null);
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
      setRefreshFailed(false);
      setErrorKind(null);
      setLastErrorAt(null);
      return;
    }

    const cancelled = { value: false };
    await fetchBalance(addr, cancelled, { manual: true });
  }, [isConnected, walletAddress, fetchBalance]);

  return {
    nano,
    isLoading,
    failed,
    refreshFailed,
    errorKind,
    lastErrorAt,
    refetch,
  };
}
