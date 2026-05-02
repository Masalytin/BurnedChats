import {
  CHAIN,
  type Account,
  type TonProofItemReply,
  type TonProofItemReplySuccess,
  type Wallet,
  WalletAlreadyConnectedError,
  toUserFriendlyAddress,
} from '@tonconnect/sdk';
import type { ConnectedWallet } from '@tonconnect/ui';
import { TonConnectUI } from '@tonconnect/ui';

let tonConnectUiSingleton: TonConnectUI | null = null;

function resolveManifestUrl(): string {
  if (typeof window === 'undefined') {
    return 'https://burnedchats.com/tonconnect-manifest.json';
  }
  return `${window.location.origin}/tonconnect-manifest.json`;
}

/**
 * Singleton Ton Connect UI instance (library-backed global).
 */
export function getTonConnectUI(): TonConnectUI {
  if (!tonConnectUiSingleton) {
    tonConnectUiSingleton = new TonConnectUI({
      manifestUrl: resolveManifestUrl(),
      restoreConnection: true,
    });
  }
  return tonConnectUiSingleton;
}

export function accountToFriendlyAddress(account: Account): string {
  const testOnly = account.chain === CHAIN.TESTNET;
  return toUserFriendlyAddress(account.address, testOnly);
}

export function shortenTonDisplayAddress(friendly: string): string {
  const trimmed = friendly.trim();
  if (trimmed.length <= 13) {
    return trimmed;
  }
  const headLen = trimmed.startsWith('EQ') || trimmed.startsWith('UQ') ? 6 : 4;
  return `${trimmed.slice(0, headLen)}...${trimmed.slice(-4)}`;
}

export function isTonProofSuccess(item: TonProofItemReply | undefined): item is TonProofItemReplySuccess {
  return Boolean(item && item.name === 'ton_proof' && 'proof' in item && !('error' in item && item.error));
}

export function serializeTonProof(reply: TonProofItemReplySuccess): string {
  return JSON.stringify(reply);
}

export function serializeTonProofFromWallet(wallet: Wallet | null): string | undefined {
  const raw = wallet?.connectItems?.tonProof;
  if (!isTonProofSuccess(raw)) {
    return undefined;
  }
  return serializeTonProof(raw);
}

function normalizeApiBase(): string {
  const raw = import.meta.env.VITE_API_URL ?? '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * Fetches a server-issued nonce for Ton Connect {@link TonProofItem} payload (replay protection).
 */
export async function fetchWalletAuthNonce(): Promise<string> {
  const base = normalizeApiBase();
  const url = `${base}/api/auth/nonce`;
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch wallet auth nonce: HTTP ${response.status}`);
  }

  const body: unknown = await response.json();
  if (typeof body === 'string' && body.length > 0) {
    return body;
  }

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const nonce = record.nonce ?? record.payload;
    if (typeof nonce === 'string' && nonce.length > 0) {
      return nonce;
    }
  }

  throw new Error('Wallet auth nonce response has no usable nonce field');
}

/**
 * Disconnects if needed, loads a fresh nonce, requests Ton Connect flow with ton_proof, returns connected wallet.
 */
export async function connectWalletWithTonProof(): Promise<ConnectedWallet> {
  const ui = getTonConnectUI();
  const nonce = await fetchWalletAuthNonce();

  if (ui.connected) {
    await ui.disconnect();
  }

  ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: nonce } });

  try {
    const wallet = await ui.connectWallet();
    assertWalletTonProof(wallet);
    return wallet;
  } catch (err) {
    if (err instanceof WalletAlreadyConnectedError) {
      await ui.disconnect();
      ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: nonce } });
      const wallet = await ui.connectWallet();
      assertWalletTonProof(wallet);
      return wallet;
    }
    throw err;
  }
}

function assertWalletTonProof(wallet: ConnectedWallet): void {
  const proof = wallet.connectItems?.tonProof;
  if (!isTonProofSuccess(proof)) {
    throw new Error('Wallet connection completed without a valid ton_proof');
  }
}
