import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useBurnToken, type UseBurnToken } from '@/hooks/useBurnToken';
import { useTonBalance } from '@/hooks/useTonBalance';
import { useTonConnect, type UseTonConnectResult } from '@/hooks/useTonConnect';
import type { TonBalanceErrorKind } from '@/ton/tonBalance';

import { WalletSheet } from './WalletSheet';

export interface WalletContextValue {
  burn: UseBurnToken;
  ton: UseTonConnectResult;
  tonBalance: {
    nano: bigint | null;
    isLoading: boolean;
    failed: boolean;
    refreshFailed: boolean;
    errorKind: TonBalanceErrorKind | null;
    lastErrorAt: number | null;
  };
  refreshWallet: () => Promise<void>;
  isRefreshing: boolean;
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export { WalletContext };

/** Shared burn/ton state and sheet visibility for all wallet surfaces. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const burn = useBurnToken();
  const ton = useTonConnect();
  const tonBalanceHook = useTonBalance(ton.walletAddress, ton.isConnected);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openSheet = useCallback(() => {
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  const refreshWallet = useCallback(async () => {
    if (!ton.isConnected || !ton.walletAddress) {
      return;
    }
    await Promise.all([burn.refetch(), tonBalanceHook.refetch()]);
  }, [burn, ton.isConnected, ton.walletAddress, tonBalanceHook]);

  const tonRefreshing =
    tonBalanceHook.isLoading && tonBalanceHook.nano !== null;
  const isRefreshing = burn.isRefreshing || tonRefreshing;

  const tonBalance = useMemo(
    () => ({
      nano: tonBalanceHook.nano,
      isLoading: tonBalanceHook.isLoading,
      failed: tonBalanceHook.failed,
      refreshFailed: tonBalanceHook.refreshFailed,
      errorKind: tonBalanceHook.errorKind,
      lastErrorAt: tonBalanceHook.lastErrorAt,
    }),
    [
      tonBalanceHook.nano,
      tonBalanceHook.isLoading,
      tonBalanceHook.failed,
      tonBalanceHook.refreshFailed,
      tonBalanceHook.errorKind,
      tonBalanceHook.lastErrorAt,
    ],
  );

  const value = useMemo(
    () => ({
      burn,
      ton,
      tonBalance,
      refreshWallet,
      isRefreshing,
      sheetOpen,
      openSheet,
      closeSheet,
    }),
    [burn, ton, tonBalance, refreshWallet, isRefreshing, sheetOpen, openSheet, closeSheet],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletSheet />
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return ctx;
}
