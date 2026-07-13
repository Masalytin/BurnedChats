import type { Wallet } from '@tonconnect/sdk';
import { useCallback, useEffect, useState } from 'react';
import { debugLog } from '@/components/DebugPanel';
import {
  accountToFriendlyAddress,
  connectWalletWithTonProof,
  getTonConnectUI,
  resetTonConnectUI,
  sendTonTransaction,
  serializeTonProofFromWallet,
  subscribeTonConnectReset,
} from '@/ton/connector';
import type { TransactionMessage, TxResult } from '@/ton/types';

export interface UseTonConnectResult {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: boolean;
  walletAddress: string | null;
  tonProof: string | undefined;
  sendTransaction: (messages: TransactionMessage[]) => Promise<TxResult>;
}

/**
 * Ton Connect wallet state and actions (Ton proof uses backend nonce via {@link connectWalletWithTonProof}).
 */
export function useTonConnect(): UseTonConnectResult {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [connectEpoch, setConnectEpoch] = useState(0);

  useEffect(() => subscribeTonConnectReset(() => {
    setWallet(null);
    setConnectEpoch((epoch) => epoch + 1);
  }), []);

  useEffect(() => {
    const ui = getTonConnectUI();

    setWallet(ui.wallet ?? null);

    const unsub = ui.onStatusChange(setWallet);

    ui.connectionRestored
      .then(() => {
        setWallet(ui.wallet);
      })
      .catch((err) => {
        debugLog('error', '[TonConnect] connectionRestored failed', err);
        resetTonConnectUI();
      });

    return () => {
      unsub();
    };
  }, [connectEpoch]);

  const walletAddress =
    wallet?.account !== undefined ? accountToFriendlyAddress(wallet.account) : null;

  const tonProof = serializeTonProofFromWallet(wallet);

  const connect = useCallback(async () => {
    await connectWalletWithTonProof();
  }, []);

  const disconnect = useCallback(async () => {
    await getTonConnectUI().disconnect();
  }, []);

  const sendTransaction = useCallback(async (messages: TransactionMessage[]) => sendTonTransaction(messages), []);

  return {
    connect,
    disconnect,
    isConnected: Boolean(wallet?.account),
    walletAddress,
    tonProof,
    sendTransaction,
  };
}
