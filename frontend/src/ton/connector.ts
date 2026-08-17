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
import { TonConnectUI, TonConnectUIError } from '@tonconnect/ui';
import type { TransactionMessage, TxResult } from './types';

let tonConnectUiSingleton: TonConnectUI | null = null;

export type TonConnectUIOptions = {
  restoreConnection?: boolean;
};

const DEFAULT_TONCONNECT_MANIFEST_URL = 'https://burnedchats.net/tonconnect-manifest.json';

const WALLET_AUTH_CONNECTION_RESTORED_MS = 15_000;
const WALLET_AUTH_FETCH_NONCE_MS = 15_000;
const WALLET_AUTH_DISCONNECT_MS = 10_000;
const WALLET_AUTH_CONNECT_WALLET_MS = 120_000;

function resolveManifestUrl(): string {
  const fromEnv = import.meta.env.VITE_TONCONNECT_MANIFEST_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return DEFAULT_TONCONNECT_MANIFEST_URL;
}

/**
 * Races {@link promise} against a timer; rejects with a `[WalletAuth]`-prefixed error on timeout.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[WalletAuth] ${label} timed out after ${ms}ms`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err instanceof WalletAlreadyConnectedError) {
          reject(err);
          return;
        }
        reject(wrapWalletAuthStepError(err, label));
      });
  });
}

function wrapWalletAuthStepError(err: unknown, label: string): Error {
  if (err instanceof Error && err.message.startsWith('[WalletAuth]')) {
    return err;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(`[WalletAuth] ${label}: ${detail}`);
}

/**
 * Singleton Ton Connect UI instance (library-backed global).
 */
export function getTonConnectUI(options?: TonConnectUIOptions): TonConnectUI {
  if (!tonConnectUiSingleton) {
    tonConnectUiSingleton = new TonConnectUI({
      manifestUrl: resolveManifestUrl(),
      restoreConnection: options?.restoreConnection ?? true,
      analytics: { mode: 'off' },
    });
  }
  return tonConnectUiSingleton;
}

/**
 * Ton Connect UI for wallet login — skips stale localStorage restore on first connect.
 */
export function getTonConnectUIForAuth(): TonConnectUI {
  return getTonConnectUI({ restoreConnection: false });
}

/**
 * Disconnects the wallet if connected; never destroys or recreates the TonConnectUI singleton.
 */
export async function disconnectTonConnect(): Promise<void> {
  const ui = getTonConnectUI();
  if (ui.connected) {
    await ui.disconnect();
  }
}

export function accountToFriendlyAddress(account: Account): string {
  const testOnly = account.chain === CHAIN.TESTNET;
  return toUserFriendlyAddress(account.address, testOnly);
}

export type AccountIdentity = {
  publicKey?: string;
  walletStateInit?: string;
};

/**
 * Extracts optional TON Connect account identity fields for server-side stateInit verification.
 */
export function extractAccountIdentity(account: Account): AccountIdentity {
  const publicKey =
    typeof account.publicKey === 'string' && account.publicKey.trim().length > 0
      ? account.publicKey.trim()
      : undefined;
  const walletStateInit =
    typeof account.walletStateInit === 'string' && account.walletStateInit.trim().length > 0
      ? account.walletStateInit.trim()
      : undefined;

  if (!publicKey || !walletStateInit) {
    console.warn(
      '[WalletAuth] missing account.publicKey/stateInit, falling back to RPC verification',
    );
    return {};
  }

  return { publicKey, walletStateInit };
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

async function connectWalletWithTonProofOnce(
  ui: TonConnectUI,
  nonce: string,
): Promise<ConnectedWallet> {
  try {
    const wallet = await withTimeout(
      ui.connectWallet(),
      WALLET_AUTH_CONNECT_WALLET_MS,
      'connectWallet',
    );
    assertWalletTonProof(wallet);
    return wallet;
  } catch (err) {
    if (err instanceof WalletAlreadyConnectedError) {
      if (ui.connected) {
        await withTimeout(ui.disconnect(), WALLET_AUTH_DISCONNECT_MS, 'disconnect');
        console.info('[WalletAuth] connect: disconnect done (already-connected retry)');
      }
      ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: nonce } });
      const wallet = await withTimeout(
        ui.connectWallet(),
        WALLET_AUTH_CONNECT_WALLET_MS,
        'connectWallet',
      );
      assertWalletTonProof(wallet);
      return wallet;
    }
    throw err;
  }
}

/**
 * Disconnects if needed, loads a fresh nonce, requests Ton Connect flow with ton_proof, returns connected wallet.
 *
 * @param resolveUi - Override for tests; production code should omit (defaults to {@link getTonConnectUIForAuth}).
 * @param resolveNonce - Override for tests; production code should omit (defaults to {@link fetchWalletAuthNonce}).
 */
export async function connectWalletWithTonProof(
  resolveUi: () => TonConnectUI = getTonConnectUIForAuth,
  resolveNonce: () => Promise<string> = fetchWalletAuthNonce,
): Promise<ConnectedWallet> {
  console.info('[WalletAuth] connect: start');
  const ui = resolveUi();

  try {
    await withTimeout(
      ui.connectionRestored,
      WALLET_AUTH_CONNECTION_RESTORED_MS,
      'connectionRestored',
    );
    console.info('[WalletAuth] connect: connectionRestored done');

    const nonce = await withTimeout(
      resolveNonce(),
      WALLET_AUTH_FETCH_NONCE_MS,
      'fetchWalletAuthNonce',
    );
    console.info(`[WalletAuth] connect: nonce fetched (length=${nonce.length})`);

    if (ui.connected) {
      await withTimeout(ui.disconnect(), WALLET_AUTH_DISCONNECT_MS, 'disconnect');
      console.info('[WalletAuth] connect: disconnect done');
    }

    ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: nonce } });
    console.info('[WalletAuth] connect: parameters set');

    const wallet = await connectWalletWithTonProofOnce(ui, nonce);
    console.info('[WalletAuth] connect: connectWallet done');
    return wallet;
  } catch (err) {
    console.info('[WalletAuth] connect: failed', err instanceof Error ? err.message : err);
    throw err;
  }
}

function assertWalletTonProof(wallet: ConnectedWallet): void {
  const proof = wallet.connectItems?.tonProof;
  if (!isTonProofSuccess(proof)) {
    throw new Error('Wallet connection completed without a valid ton_proof');
  }
}

const TX_VALID_UNTIL_SEC = 600;
const GAS_BUFFER_NANOTON = 10_000_000n;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sumRequestedNanoton(messages: TransactionMessage[]): bigint {
  return messages.reduce((acc, m) => acc + BigInt(m.amount), 0n);
}

function readConnectedBalanceNanoton(ui: TonConnectUI): bigint | null {
  const acc = ui.wallet?.account as { balance?: string | number } | undefined;
  const raw = acc?.balance;
  if (raw === undefined) {
    return null;
  }
  try {
    return BigInt(String(raw));
  } catch {
    return null;
  }
}

function isUserRejection(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (!m) {
    return false;
  }
  // Closing the TON Connect picker aborts connectWallet() with TonConnectUIError
  // "Wallet was not connected" (closeReason === 'action-cancelled'). The SDK
  // prefixes every TonConnectError with [TON_CONNECT_SDK_ERROR], and withTimeout()
  // may wrap it into a plain Error — match on message text, not instanceof.
  return (
    m.includes('user rejected') ||
    m.includes('user rejects') ||
    m.includes('reject') ||
    m.includes('declined') ||
    m.includes('cancel') ||
    m.includes('denied') ||
    m.includes('not sent') ||
    m.includes('was not connected') ||
    m.includes('action-cancelled') ||
    m.includes('action canceled')
  );
}

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const m = err.message.toLowerCase();
  return (
    m.includes('network') ||
    m.includes('fetch') ||
    m.includes('timeout') ||
    m.includes('failed to load') ||
    m.includes('econnreset')
  );
}

/** Taxonomy for wallet login / connect failures (IMP-TONCONNECT-CSP-04). */
export type WalletConnectErrorKind =
  | 'user_rejected'
  | 'csp_blocked'
  | 'manifest_invalid'
  | 'network'
  | 'proof_failed'
  | 'wallet_error'
  | 'unknown';

/**
 * Classifies TON Connect / wallet-auth errors into UI-facing kinds.
 * Prefer instanceof / known prefixes; message heuristics are a last resort.
 */
export function classifyWalletConnectError(err: unknown): WalletConnectErrorKind {
  if (isUserRejection(err)) {
    return 'user_rejected';
  }

  const msg = err instanceof Error ? err.message : String(err ?? '');
  const lower = msg.toLowerCase();
  const name = err instanceof Error ? err.name : '';

  if (
    lower.includes('manifest content error') ||
    lower.includes('manifest_error') ||
    lower.includes('invalid manifest') ||
    (lower.includes('manifest') && (lower.includes('error') || lower.includes('invalid')))
  ) {
    return 'manifest_invalid';
  }

  // CSP blocks → SDK often retries then aborts with TON_CONNECT_SDK_ERROR.
  if (
    lower.includes('ton_connect_sdk_error') ||
    lower.includes('[ton_connect_sdk_error]') ||
    (lower.includes('aborted after attempts') &&
      (lower.includes('failed to fetch') || lower.includes('refused to connect') || name.includes('TonConnect'))) ||
    lower.includes('refused to connect') ||
    lower.includes('content security policy') ||
    lower.includes('csp')
  ) {
    return 'csp_blocked';
  }

  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('-proof') ||
    lower.includes('ton_proof') ||
    lower.includes('proof')
  ) {
    return 'proof_failed';
  }

  if (isTransientNetworkError(err) || lower.includes('timed out') || lower.includes('timeout')) {
    return 'network';
  }

  if (err instanceof TonConnectUIError || name.includes('TonConnect')) {
    return 'wallet_error';
  }

  return 'unknown';
}

/**
 * Sends a signed transaction via the shared {@link getTonConnectUI} instance (wallet popup / TWA flow).
 *
 * @param resolveUi - Override for tests; production code should omit (defaults to {@link getTonConnectUI}).
 * @returns Discriminated result — user decline is `ok: false` / `user_rejected` (no throw).
 */
export async function sendTonTransaction(
  messages: TransactionMessage[],
  resolveUi: () => TonConnectUI = getTonConnectUI,
): Promise<TxResult> {
  const ui = resolveUi();
  if (!ui.connected) {
    return { ok: false, kind: 'unknown', message: 'Connect wallet to send a transaction.' };
  }
  if (messages.length === 0) {
    return { ok: false, kind: 'unknown', message: 'At least one message is required' };
  }

  const required = sumRequestedNanoton(messages);
  const balance = readConnectedBalanceNanoton(ui);
  if (balance !== null && balance < required + GAS_BUFFER_NANOTON) {
    return {
      ok: false,
      kind: 'insufficient_ton',
      message: 'Not enough TON balance for attached value and gas reserve',
    };
  }

  const tx = {
    validUntil: Math.floor(Date.now() / 1000) + TX_VALID_UNTIL_SEC,
    messages: messages.map((m) => ({
      address: m.address,
      amount: m.amount,
      payload: m.payload,
      stateInit: m.stateInit,
    })),
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await ui.sendTransaction(tx);
      const rec = raw as { boc?: string };
      const boc = rec?.boc;
      if (!boc) {
        return { ok: false, kind: 'unknown', message: 'Transaction response missing boc' };
      }
      return { ok: true, boc };
    } catch (err) {
      lastError = err;
      if (isUserRejection(err)) {
        return {
          ok: false,
          kind: 'user_rejected',
          message: err instanceof Error ? err.message : undefined,
        };
      }
      if (attempt < 2 && isTransientNetworkError(err)) {
        await sleep(200 * 2 ** attempt);
        continue;
      }
      break;
    }
  }

  return {
    ok: false,
    kind: isTransientNetworkError(lastError) ? 'network' : 'unknown',
    message: lastError instanceof Error ? lastError.message : String(lastError),
  };
}
