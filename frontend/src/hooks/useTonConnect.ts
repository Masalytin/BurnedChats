import type { Wallet } from '@tonconnect/sdk';
import { useCallback, useEffect, useState } from 'react';
import {
  accountToFriendlyAddress,
  connectWalletWithTonProof,
  getTonConnectUI,
  serializeTonProofFromWallet,
} from '@/ton/connector';

export interface UseTonConnectResult {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: boolean;
  walletAddress: string | null;
  tonProof: string | undefined;
}

/**
 * Ton Connect wallet state and actions (Ton proof uses backend nonce via {@link connectWalletWithTonProof}).
 */
export function useTonConnect(): UseTonConnectResult {
  const [wallet, setWallet] = useState<Wallet | null>(null);

  useEffect(() => {
    const ui = getTonConnectUI();

    const unsub = ui.onStatusChange(setWallet);

    void ui.connectionRestored.then(() => {
      setWallet(ui.wallet);
    });

    return () => {
      unsub();
    };
  }, []);

  const walletAddress =
    wallet?.account !== undefined ? accountToFriendlyAddress(wallet.account) : null;

  const tonProof = serializeTonProofFromWallet(wallet);

  const connect = useCallback(async () => {
    await connectWalletWithTonProof();
  }, []);

  const disconnect = useCallback(async () => {
    await getTonConnectUI().disconnect();
  }, []);

  return {
    connect,
    disconnect,
    isConnected: Boolean(wallet?.account),
    walletAddress,
    tonProof,
  };
}
