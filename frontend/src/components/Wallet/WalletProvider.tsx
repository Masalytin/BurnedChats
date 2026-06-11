import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useBurnToken, type UseBurnToken } from '@/hooks/useBurnToken';
import { useTonConnect, type UseTonConnectResult } from '@/hooks/useTonConnect';

import { WalletSheet } from './WalletSheet';

export interface WalletContextValue {
  burn: UseBurnToken;
  ton: UseTonConnectResult;
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
  const [sheetOpen, setSheetOpen] = useState(false);

  const openSheet = useCallback(() => {
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  const value = useMemo(
    () => ({ burn, ton, sheetOpen, openSheet, closeSheet }),
    [burn, ton, sheetOpen, openSheet, closeSheet],
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
