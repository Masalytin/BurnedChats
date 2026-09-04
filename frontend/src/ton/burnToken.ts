import { Address, Cell, type Slice, beginCell } from '@ton/core';
import { sendTonTransaction } from '@/ton/connector';
import { defaultFetch, resolveApiKey, resolveRpcBaseUrl } from '@/ton/rpc';
import { getTonBalanceNano } from '@/ton/tonBalance';
import { buildJettonBurnMsg, buildJettonTransferMsg, JETTON_BURN_ATTACHED_TON } from '@/ton/transactionBuilder';
import type { TxResult } from '@/ton/types';
import type { BurnTransaction, EffectiveFeeParams } from '@/types/ton';
import { estimateBurnTransferTon } from '@/ton/estimateBurnTransferTon';
import { parseTonCenterNum } from '@/ton/parseTonCenterNum';
import { jettonSupplyFromParts, parseJettonDataStack, type JettonSupply } from '@/ton/burnSupply';

export type { JettonSupply } from '@/ton/burnSupply';
import {
  createExcludedPreflightDeps,
  isExcludedTransfer,
} from '@/ton/excludedTransferPreflight';
import {
  createRecipientPreflightDeps,
  preflightRecipientJetton,
} from '@/ton/recipientJettonPreflight';

export type { BurnTransaction, EffectiveFeeParams } from '@/types/ton';

const JETTON_TRANSFER_OP = 0x0f8a7ea5;
/** TEP-74 jetton wallet → jetton wallet delivery (`JettonInternalTransfer`). */
const JETTON_INTERNAL_TRANSFER_OP = 0x178d4519;
/** TEP-74 owner → jetton wallet burn (`JettonBurn`). */
const JETTON_BURN_OP = 0x595f07bc;

/** Stack entry Ton Center `[type, value]` pair. */
type StackSlot = [string, string];

export type TransferParams = {
  recipient: string;
  amount: bigint;
  comment?: string;
  /** TON attach for jetton transfer msg; defaults to estimate from recipient preflight. */
  attachedTon?: bigint;
};

/** `transferBurn` requires the connected user TON address (friendly or raw). */
export type TransferBurnParams = TransferParams & { walletAddress: string };

/** `burnJetton` requires the connected user TON address (friendly or raw). */
export type BurnJettonParams = { walletAddress: string; amount: bigint };

export { BurnTokenError, type BurnTokenErrorCode } from '@/ton/burnTokenError';
import { BurnTokenError } from '@/ton/burnTokenError';
import { resolveUserJettonWalletAddress } from '@/ton/jettonWalletResolve';

export type TransferConfirmationPhase = 'idle' | 'signing' | 'confirming' | 'confirmed' | 'timed_out' | 'failed';

export interface TransferProgressPayload {
  phase: TransferConfirmationPhase;
  txHash?: string | null;
  error?: BurnTokenError;
}

export interface BurnTokenDeps {
  /** Ton Center v2 base, e.g. `https://testnet.toncenter.com/api/v2` */
  rpcBaseUrl?: string;
  /** BURN jetton master (user-friendly or raw). */
  jettonMaster?: string;
  /** Optional toncenter API key header. */
  toncenterApiKey?: string;
  fetchImpl?: typeof fetch;
  sendTransactionImpl?: typeof sendTonTransaction;
  /** Fired through signing + on-chain confirmation polling. */
  onTransferProgress?: (p: TransferProgressPayload) => void;
}

const DEFAULT_POLL_MS = 30_000;
const CONFIRM_POLL_INTERVAL_MS = 1_500;
/** Extra native TON beyond message attachment (wallet fees, aligns with connector GAS_BUFFER). */
const TON_GAS_BUFFER_NANOTON = 10_000_000n;

const BURN_BALANCE_UNAVAILABLE = 'BURN balance API is unavailable';
const JETTON_INFO_UNAVAILABLE = 'Jetton info API is unavailable';
const FEE_PARAMS_UNAVAILABLE = 'Fee params API is unavailable';

/** Test-only override. `undefined` restores `import.meta.env.DEV`. */
let burnTokenReadDevOverride: boolean | undefined;

/**
 * Vite inlines `import.meta.env.DEV`; tests use {@link setBurnTokenReadDevForTests}
 * (same pattern as staking / DebugPanel payload gates).
 */
export function isBurnTokenReadDev(): boolean {
  if (burnTokenReadDevOverride !== undefined) {
    return burnTokenReadDevOverride;
  }
  return import.meta.env.DEV === true;
}

/** Force DEV/prod burn-balance read-path in unit tests. Pass `undefined` to restore. */
export function setBurnTokenReadDevForTests(dev: boolean | undefined): void {
  burnTokenReadDevOverride = dev;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeApiBase(): string {
  const raw = import.meta.env.VITE_API_URL ?? '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function resolveJettonMaster(override?: string): string {
  const fromEnv = (import.meta.env.VITE_BURN_JETTON_MASTER ?? '').trim();
  const addr = override ?? fromEnv;
  if (!addr) {
    throw new BurnTokenError('CONFIG', 'BURN jetton master address is not configured (VITE_BURN_JETTON_MASTER)');
  }
  return addr;
}

export function addressToSliceStackBoc(userAddress: string): string {
  const addr = Address.parse(userAddress.trim());
  return beginCell().storeAddress(addr).endCell().toBoc({ idx: false }).toString('base64');
}

function parseStackSlots(stack: unknown): StackSlot[] {
  if (!Array.isArray(stack)) {
    return [];
  }
  const out: StackSlot[] = [];
  for (const row of stack) {
    if (Array.isArray(row) && row.length >= 2 && typeof row[0] === 'string' && typeof row[1] === 'string') {
      out.push([row[0], row[1]]);
    }
  }
  return out;
}

function firstStackNum(stack: unknown): bigint | null {
  const slots = parseStackSlots(stack);
  for (const [t, v] of slots) {
    if (t === 'num') {
      return parseTonCenterNum(v);
    }
  }
  return null;
}

async function postRunGetMethod(
  rpcBase: string,
  address: string,
  method: string,
  stack: StackSlot[],
  fetchImpl: typeof fetch,
  apiKey?: string,
): Promise<{ exitCode: number; stackUnknown: unknown }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  let response: Response;
  try {
    response = await fetchImpl(`${rpcBase}/runGetMethod`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ address: address.trim(), method, stack }),
    });
  } catch (e) {
    throw new BurnTokenError('NETWORK_ERROR', 'TON runGetMethod request failed', { cause: e });
  }
  if (!response.ok) {
    throw new BurnTokenError('NETWORK_ERROR', `TON runGetMethod HTTP ${response.status}`);
  }
  let body: { ok?: boolean; result?: { exit_code?: number; stack?: unknown }; error?: string };
  try {
    body = (await response.json()) as typeof body;
  } catch (e) {
    throw new BurnTokenError('NETWORK_ERROR', 'TON runGetMethod invalid JSON body', { cause: e });
  }
  if (!body.ok || body.result === undefined || body.result === null) {
    throw new BurnTokenError('NETWORK_ERROR', body.error ?? 'TON runGetMethod error');
  }
  return {
    exitCode: body.result.exit_code ?? 0,
    stackUnknown: body.result.stack ?? [],
  };
}

async function getJsonViaGet(url: string, fetchImpl: typeof fetch, apiKey?: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  let response: Response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (e) {
    throw new BurnTokenError('NETWORK_ERROR', 'TON GET request failed', { cause: e });
  }
  if (!response.ok) {
    throw new BurnTokenError('NETWORK_ERROR', `TON GET HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (e) {
    throw new BurnTokenError('NETWORK_ERROR', 'TON GET invalid JSON', { cause: e });
  }
}

async function tryBackendJettonWallet(address: string, fetchImpl: typeof fetch): Promise<string | null> {
  const base = normalizeApiBase();
  if (!base) {
    return null;
  }
  const url = `${base}/api/wallet/jetton-wallet?address=${encodeURIComponent(address)}`;
  const attempts = 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
    } catch {
      return null;
    }
    if (response.status === 404 || response.status === 501) {
      return null;
    }
    if (response.status === 502) {
      if (attempt + 1 < attempts) {
        continue;
      }
      return null;
    }
    if (!response.ok) {
      return null;
    }
    try {
      const body = (await response.json()) as unknown;
      if (body && typeof body === 'object') {
        const jw = (body as Record<string, unknown>).jettonWalletAddress;
        if (typeof jw === 'string' && jw.trim()) {
          return jw.trim();
        }
      }
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

/** True when both strings parse as the same TON address (any friendly form). */
export function sameTonAddress(a: string, b: string): boolean {
  try {
    return Address.parse(a.trim()).equals(Address.parse(b.trim()));
  } catch {
    return false;
  }
}

/**
 * Accept a backend-supplied jetton wallet only when it matches the address
 * derived locally from the pinned jetton master. Otherwise keep the local value.
 */
export function pickTrustedJettonWallet(local: string, backend: string | null): string {
  if (backend && !sameTonAddress(backend, local)) {
    console.warn(
      '[burnToken] Ignoring backend jetton wallet that does not match pinned-master derive',
    );
  }
  return local;
}

async function getUserJettonWalletAddress(ownerAddress: string, deps: ResolvedDeps): Promise<string> {
  const local = await resolveUserJettonWalletAddress(ownerAddress, {
    rpcBaseUrl: deps.rpcBaseUrl,
    jettonMaster: resolveJettonMaster(deps.jettonMaster),
    apiKey: deps.apiKey,
    fetchImpl: deps.fetchImpl,
  });
  const viaBackend = await tryBackendJettonWallet(ownerAddress, deps.fetchImpl);
  return pickTrustedJettonWallet(local, viaBackend);
}

async function fetchBurnBalanceNanoRpc(ownerAddress: string, deps: ResolvedDeps): Promise<bigint> {
  let jw: string;
  try {
    jw = await getUserJettonWalletAddress(ownerAddress, deps);
  } catch (e) {
    if (e instanceof BurnTokenError && e.code === 'JETTON_WALLET_NOT_DEPLOYED') {
      return 0n;
    }
    throw e;
  }
  const { exitCode, stackUnknown } = await postRunGetMethod(
    deps.rpcBaseUrl,
    jw,
    'get_wallet_data',
    [],
    deps.fetchImpl,
    deps.apiKey,
  );
  if (exitCode !== 0) {
    return 0n;
  }
  const n = firstStackNum(stackUnknown);
  return n ?? 0n;
}

function parseBurnBalanceBody(body: unknown): bigint | null {
  if (typeof body === 'string' && /^-?\d+$/.test(body)) {
    return BigInt(body);
  }
  if (body && typeof body === 'object') {
    const r = body as Record<string, unknown>;
    const nano = r.balanceNano ?? r.nano ?? r.balance;
    if (typeof nano === 'string' && /^-?\d+$/.test(nano)) {
      return BigInt(nano);
    }
    if (typeof nano === 'number' && Number.isFinite(nano)) {
      return BigInt(Math.trunc(nano));
    }
  }
  return null;
}

async function fetchBurnBalanceFromApi(
  address: string,
  fetchImpl: typeof fetch,
  base: string,
): Promise<bigint> {
  const url = `${base}/api/wallet/burn-balance?address=${encodeURIComponent(address)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new BurnTokenError('NETWORK_ERROR', BURN_BALANCE_UNAVAILABLE, { cause: e });
  }
  if (!response.ok) {
    throw new BurnTokenError('NETWORK_ERROR', BURN_BALANCE_UNAVAILABLE);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    throw new BurnTokenError('NETWORK_ERROR', BURN_BALANCE_UNAVAILABLE, { cause: e });
  }
  const nano = parseBurnBalanceBody(body);
  if (nano === null) {
    throw new BurnTokenError('NETWORK_ERROR', BURN_BALANCE_UNAVAILABLE);
  }
  return nano;
}

/**
 * BURN jetton balance in nano units (1 BURN = 1e9 nano).
 * Prod-read is `/api/wallet/burn-balance` only. DEV may use Ton Center RPC
 * only when `VITE_API_URL` is empty.
 */
export async function getBurnBalance(address: string, deps?: BurnTokenDeps): Promise<bigint> {
  const r = resolveDeps(deps);
  const base = normalizeApiBase();
  if (base) {
    return fetchBurnBalanceFromApi(address, r.fetchImpl, base);
  }
  if (!isBurnTokenReadDev()) {
    throw new BurnTokenError('CONFIG', 'API base URL is not configured (VITE_API_URL)');
  }
  return fetchBurnBalanceNanoRpc(address, r);
}

function parseJettonInfoBody(body: unknown): JettonSupply | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const r = body as Record<string, unknown>;
  const nano = r.circulatingNano;
  if (typeof nano !== 'string' || !/^\d+$/.test(nano)) {
    return null;
  }
  if (typeof r.mintable !== 'boolean') {
    return null;
  }
  return jettonSupplyFromParts(BigInt(nano), r.mintable);
}

async function fetchJettonSupplyFromApi(fetchImpl: typeof fetch, base: string): Promise<JettonSupply> {
  const url = `${base}/api/wallet/jetton-info`;
  let response: Response;
  try {
    response = await fetchImpl(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new BurnTokenError('NETWORK_ERROR', JETTON_INFO_UNAVAILABLE, { cause: e });
  }
  if (!response.ok) {
    throw new BurnTokenError('NETWORK_ERROR', JETTON_INFO_UNAVAILABLE);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    throw new BurnTokenError('NETWORK_ERROR', JETTON_INFO_UNAVAILABLE, { cause: e });
  }
  const supply = parseJettonInfoBody(body);
  if (supply === null) {
    throw new BurnTokenError('NETWORK_ERROR', JETTON_INFO_UNAVAILABLE);
  }
  return supply;
}

function parseFeeParamsBody(body: unknown): EffectiveFeeParams | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const r = body as Record<string, unknown>;
  const burnBps = r.burnBps;
  const stakingBps = r.stakingBps;
  const treasuryBps = r.treasuryBps;
  if (
    typeof burnBps !== 'number' ||
    typeof stakingBps !== 'number' ||
    typeof treasuryBps !== 'number' ||
    !Number.isFinite(burnBps) ||
    !Number.isFinite(stakingBps) ||
    !Number.isFinite(treasuryBps)
  ) {
    return null;
  }
  return { burnBps, stakingBps, treasuryBps };
}

async function fetchFeeParamsFromApi(fetchImpl: typeof fetch, base: string): Promise<EffectiveFeeParams> {
  const url = `${base}/api/wallet/fee-params`;
  let response: Response;
  try {
    response = await fetchImpl(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new BurnTokenError('NETWORK_ERROR', FEE_PARAMS_UNAVAILABLE, { cause: e });
  }
  if (!response.ok) {
    throw new BurnTokenError('NETWORK_ERROR', FEE_PARAMS_UNAVAILABLE);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    throw new BurnTokenError('NETWORK_ERROR', FEE_PARAMS_UNAVAILABLE, { cause: e });
  }
  const fees = parseFeeParamsBody(body);
  if (fees === null) {
    throw new BurnTokenError('NETWORK_ERROR', FEE_PARAMS_UNAVAILABLE);
  }
  return fees;
}

async function fetchEffectiveFeeParamsRpc(deps: ResolvedDeps): Promise<EffectiveFeeParams> {
  const master = resolveJettonMaster(deps.jettonMaster);
  const { exitCode, stackUnknown } = await postRunGetMethod(
    deps.rpcBaseUrl,
    master,
    'get_effective_fee_params',
    [],
    deps.fetchImpl,
    deps.apiKey,
  );
  if (exitCode !== 0) {
    return { burnBps: 50, stakingBps: 30, treasuryBps: 20 };
  }
  const slots = parseStackSlots(stackUnknown);
  const nums: bigint[] = [];
  for (const [t, v] of slots) {
    if (t === 'num') {
      nums.push(parseTonCenterNum(v));
    }
  }
  if (nums.length < 3) {
    return { burnBps: 50, stakingBps: 30, treasuryBps: 20 };
  }
  return {
    burnBps: Number(nums[0]),
    stakingBps: Number(nums[1]),
    treasuryBps: Number(nums[2]),
  };
}

/**
 * Network circulating / burned from jetton master `get_jetton_data`.
 * Prod-read is `/api/wallet/jetton-info` only. DEV may use Ton Center RPC
 * only when `VITE_API_URL` is empty.
 */
export async function getJettonSupply(deps?: BurnTokenDeps): Promise<JettonSupply> {
  const r = resolveDeps(deps);
  const base = normalizeApiBase();
  if (base) {
    return fetchJettonSupplyFromApi(r.fetchImpl, base);
  }
  if (!isBurnTokenReadDev()) {
    throw new BurnTokenError('CONFIG', 'API base URL is not configured (VITE_API_URL)');
  }
  const master = resolveJettonMaster(r.jettonMaster);
  const { exitCode, stackUnknown } = await postRunGetMethod(
    r.rpcBaseUrl,
    master,
    'get_jetton_data',
    [],
    r.fetchImpl,
    r.apiKey,
  );
  if (exitCode !== 0) {
    throw new BurnTokenError('NETWORK_ERROR', `get_jetton_data exit_code ${exitCode}`);
  }
  try {
    return parseJettonDataStack(stackUnknown);
  } catch (e) {
    throw new BurnTokenError(
      'NETWORK_ERROR',
      e instanceof Error ? e.message : 'get_jetton_data parse failed',
      { cause: e },
    );
  }
}

/**
 * Dynamic fee params from jetton master `get_effective_fee_params`.
 * Prod-read is `/api/wallet/fee-params` only. DEV RPC (empty `VITE_API_URL`)
 * falls back to the TOKENOMICS static split on Ton error.
 */
export async function getEffectiveFeeParams(deps?: BurnTokenDeps): Promise<EffectiveFeeParams> {
  const r = resolveDeps(deps);
  const base = normalizeApiBase();
  if (base) {
    return fetchFeeParamsFromApi(r.fetchImpl, base);
  }
  if (!isBurnTokenReadDev()) {
    throw new BurnTokenError('CONFIG', 'API base URL is not configured (VITE_API_URL)');
  }
  try {
    return await fetchEffectiveFeeParamsRpc(r);
  } catch (e) {
    if (e instanceof BurnTokenError && e.code === 'NETWORK_ERROR') {
      return { burnBps: 50, stakingBps: 30, treasuryBps: 20 };
    }
    throw e;
  }
}

interface TonCenterTx {
  utime?: number;
  transaction_id?: { lt?: string; hash?: string };
  in_msg?: {
    source?: string;
    destination?: string;
    msg_data?: { body?: string; '@type'?: string };
  };
  out_msgs?: Array<{
    destination?: string;
    source?: string;
    msg_data?: { body?: string };
  }>;
}

function tryDecodeJettonTransferAmount(bodyB64: string | undefined): bigint | null {
  if (!bodyB64) {
    return null;
  }
  try {
    const cell = Cell.fromBoc(Buffer.from(bodyB64, 'base64'))[0]!;
    const s = cell.beginParse();
    const op = s.loadUint(32);
    if (op !== JETTON_TRANSFER_OP) {
      return null;
    }
    s.loadUintBig(64);
    return s.loadCoins();
  } catch {
    return null;
  }
}

function tryDecodeJettonBurnAmount(bodyB64: string | undefined): bigint | null {
  if (!bodyB64) {
    return null;
  }
  try {
    const cell = Cell.fromBoc(Buffer.from(bodyB64, 'base64'))[0]!;
    const s = cell.beginParse();
    const op = s.loadUint(32);
    if (op !== JETTON_BURN_OP) {
      return null;
    }
    s.loadUintBig(64);
    return s.loadCoins();
  } catch {
    return null;
  }
}

function tryDecodeJettonInternalTransferAmount(bodyB64: string | undefined): bigint | null {
  if (!bodyB64) {
    return null;
  }
  try {
    const cell = Cell.fromBoc(Buffer.from(bodyB64, 'base64'))[0]!;
    const s = cell.beginParse();
    const op = s.loadUint(32);
    if (op !== JETTON_INTERNAL_TRANSFER_OP) {
      return null;
    }
    s.loadUintBig(64);
    return s.loadCoins();
  } catch {
    return null;
  }
}

/** Maps Ton Center jetton-wallet tx to history row (exported for unit tests). */
export function mapCenterTxToBurnRow(tx: TonCenterTx): BurnTransaction {
  const hash = tx.transaction_id?.hash ?? '';
  const tsMs = typeof tx.utime === 'number' ? tx.utime * 1000 : 0;

  let type: BurnTransaction['type'] = 'send';
  let amount = 0n;
  let counterparty = '';

  const bodyIn = tx.in_msg?.msg_data?.body;
  const transferIn = tryDecodeJettonTransferAmount(bodyIn);
  const internalIn = tryDecodeJettonInternalTransferAmount(bodyIn);
  const burnIn = tryDecodeJettonBurnAmount(bodyIn);

  const out = Array.isArray(tx.out_msgs) ? tx.out_msgs : [];
  let internalOut: { amount: bigint; destination: string } | null = null;
  for (const m of out) {
    const internalAmount = tryDecodeJettonInternalTransferAmount(m.msg_data?.body);
    if (internalAmount !== null) {
      internalOut = { amount: internalAmount, destination: m.destination ?? m.source ?? '' };
      break;
    }
  }

  // Owner-initiated send: TON wallet → jetton wallet (JettonTransfer in) → peer JW (internal out).
  if (transferIn !== null && internalOut !== null) {
    type = 'send';
    amount = transferIn;
    counterparty = internalOut.destination || (tx.in_msg?.destination ?? '');
  } else if (burnIn !== null) {
    type = 'burn';
    amount = burnIn;
    counterparty = tx.in_msg?.source ?? '';
  } else if (internalIn !== null) {
    type = 'receive';
    amount = internalIn;
    counterparty = tx.in_msg?.source ?? '';
  } else if (internalOut !== null) {
    type = 'send';
    amount = internalOut.amount;
    counterparty = internalOut.destination;
  } else if (transferIn !== null) {
    type = 'send';
    amount = transferIn;
    counterparty = tx.in_msg?.destination ?? '';
  } else {
    type = 'burn';
    amount = 0n;
    counterparty = tx.in_msg?.source ?? '';
  }

  return {
    hash,
    type,
    amount,
    counterparty,
    timestamp: tsMs,
    fee: null,
    status: hash ? 'confirmed' : 'failed',
  };
}

async function fetchTransactionsCenter(address: string, limit: number, deps: ResolvedDeps): Promise<TonCenterTx[]> {
  const capped = Math.max(1, Math.min(limit, 100));
  const url = `${deps.rpcBaseUrl}/getTransactions?address=${encodeURIComponent(address.trim())}&limit=${capped}`;
  const raw = await getJsonViaGet(url, deps.fetchImpl, deps.apiKey);
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const root = raw as Record<string, unknown>;
  if (!root.ok || !Array.isArray(root.result)) {
    return [];
  }
  return root.result.filter((x) => x && typeof x === 'object') as TonCenterTx[];
}

/**
 * Latest jetton-wallet activity for `address` owner's BURN transfers (decoded when possible).
 */
export async function getBurnHistory(ownerAddress: string, limit = 20, deps?: BurnTokenDeps): Promise<BurnTransaction[]> {
  const r = resolveDeps(deps);
  let jw: string;
  try {
    jw = await getUserJettonWalletAddress(ownerAddress, r);
  } catch (e) {
    if (e instanceof BurnTokenError && e.code === 'JETTON_WALLET_NOT_DEPLOYED') {
      return [];
    }
    throw e;
  }
  const rows = await fetchTransactionsCenter(jw, limit, r);
  return rows.map(mapCenterTxToBurnRow);
}

interface TxCursor {
  lt: bigint;
  hash: string;
}

async function readLatestTxCursor(tonWallet: string, deps: ResolvedDeps): Promise<TxCursor | null> {
  const txs = await fetchTransactionsCenter(tonWallet, 1, deps);
  if (txs.length === 0) {
    return null;
  }
  const t = txs[0]!;
  const ltRaw = t.transaction_id?.lt;
  const hash = t.transaction_id?.hash ?? '';
  if (!ltRaw) {
    return null;
  }
  try {
    return { lt: BigInt(ltRaw), hash };
  } catch {
    return null;
  }
}

async function pollForWalletTxHash(
  tonWallet: string,
  beforeLt: bigint,
  timeoutMs: number,
  deps: ResolvedDeps,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const txs = await fetchTransactionsCenter(tonWallet, 8, deps);
    for (const tx of txs) {
      const ltRaw = tx.transaction_id?.lt;
      const hash = tx.transaction_id?.hash;
      if (!ltRaw || !hash) {
        continue;
      }
      try {
        if (BigInt(ltRaw) > beforeLt) {
          return hash;
        }
      } catch {
        continue;
      }
    }
    await sleep(CONFIRM_POLL_INTERVAL_MS);
  }
  return null;
}

export function txResultToBurnError(tx: Exclude<TxResult, { ok: true }>): BurnTokenError {
  if (tx.kind === 'user_rejected') {
    return new BurnTokenError('USER_REJECTED', tx.message ?? 'User rejected wallet send');
  }
  if (tx.kind === 'insufficient_ton') {
    return new BurnTokenError('INSUFFICIENT_TON_GAS', tx.message ?? 'Not enough TON for gas');
  }
  if (tx.kind === 'network') {
    return new BurnTokenError('NETWORK_ERROR', tx.message ?? 'Network error while sending tx');
  }
  return new BurnTokenError('UNKNOWN', tx.message ?? 'Transaction failed');
}

function encodeCommentForwardPayload(comment: string): Slice {
  // Simple text forwarding — opcode 0 + tail; receivers that ignore extras still succeed.
  return beginCell().storeUint(0, 32).storeStringTail(comment).endCell().asSlice();
}

type ResolvedDeps = {
  rpcBaseUrl: string;
  jettonMaster?: string;
  apiKey?: string | undefined;
  fetchImpl: typeof fetch;
  sendTransactionImpl: typeof sendTonTransaction;
  onTransferProgress?: (p: TransferProgressPayload) => void;
};

function resolveDeps(deps?: BurnTokenDeps): ResolvedDeps {
  return {
    rpcBaseUrl: resolveRpcBaseUrl(deps?.rpcBaseUrl),
    jettonMaster: deps?.jettonMaster,
    apiKey: resolveApiKey(deps?.toncenterApiKey),
    fetchImpl: deps?.fetchImpl ?? defaultFetch(),
    sendTransactionImpl: deps?.sendTransactionImpl ?? sendTonTransaction,
    onTransferProgress: deps?.onTransferProgress,
  };
}

function emptySlice(): Slice {
  return beginCell().storeUint(0, 1).endCell().asSlice();
}

/**
 * Transfer BURN via connected wallet (Ton Connect signature + polling user wallet for inclusion).
 *
 * Caller must already be connected (`sendTonTransaction` checks this).
 *
 * Confirmation: poll Ton Center `/getTransactions` on the owner's TON wallet for up to 30 seconds.
 *
 * Returned `TxResult` matches {@link TxResult}: success carries only the outbound BOC; track on-chain hash
 * via hook state (`confirmationHash`) using {@link TransferProgressPayload}.
 */
export async function transferBurn(params: TransferBurnParams, deps?: BurnTokenDeps): Promise<TxResult> {
  const r = resolveDeps(deps);
  const emit = (p: TransferProgressPayload) => r.onTransferProgress?.(p);

  emit({ phase: 'signing', txHash: null });

  const balance = await getBurnBalance(params.walletAddress, deps);
  if (params.amount > balance) {
    const err = new BurnTokenError('INSUFFICIENT_BALANCE', 'BURN jetton balance is insufficient for this transfer');
    emit({ phase: 'failed', error: err });
    throw err;
  }

  let userJettonWallet: string;
  try {
    userJettonWallet = await getUserJettonWalletAddress(params.walletAddress, r);
  } catch (e) {
    const wrapped =
      e instanceof BurnTokenError
        ? e
        : new BurnTokenError('NETWORK_ERROR', 'Failed to resolve jetton wallet', { cause: e });
    emit({ phase: 'failed', error: wrapped });
    throw wrapped;
  }

  const recipient = Address.parse(params.recipient.trim());
  const jettonWalletAddr = Address.parse(userJettonWallet);
  const forwardPayload = params.comment ? encodeCommentForwardPayload(params.comment) : emptySlice();

  let attachedTon = params.attachedTon;
  if (attachedTon === undefined) {
    const preflightDeps = createRecipientPreflightDeps({
      rpcBaseUrl: r.rpcBaseUrl,
      jettonMaster: resolveJettonMaster(r.jettonMaster),
      apiKey: r.apiKey,
      fetchImpl: r.fetchImpl,
    });
    const excludedDeps = createExcludedPreflightDeps({
      rpcBaseUrl: r.rpcBaseUrl,
      jettonMaster: resolveJettonMaster(r.jettonMaster),
      apiKey: r.apiKey,
      fetchImpl: r.fetchImpl,
    });
    const preflight =
      preflightDeps !== null
        ? await preflightRecipientJetton(params.recipient.trim(), preflightDeps)
        : { jettonWalletAddress: null, walletDeployed: false, feeConfigActive: false };
    const excluded =
      excludedDeps !== null
        ? await isExcludedTransfer(params.walletAddress, params.recipient.trim(), excludedDeps)
        : false;
    attachedTon = estimateBurnTransferTon({
      feePath: !excluded,
      recipientWalletDeployed: excluded ? false : preflight.walletDeployed,
      recipientFeeConfigActive: excluded ? false : preflight.feeConfigActive,
    }).recommendedNano;
  }

  try {
    const tonBalance = await getTonBalanceNano(params.walletAddress, {
      rpcBaseUrl: r.rpcBaseUrl,
      toncenterApiKey: r.apiKey,
      fetchImpl: r.fetchImpl,
    });
    const minTon = attachedTon + TON_GAS_BUFFER_NANOTON;
    if (tonBalance < minTon) {
      const err = new BurnTokenError(
        'INSUFFICIENT_TON_GAS',
        'Not enough TON for jetton transfer gas attachment and fees',
      );
      emit({ phase: 'failed', error: err });
      throw err;
    }
  } catch (e) {
    if (e instanceof BurnTokenError && e.code === 'INSUFFICIENT_TON_GAS') {
      throw e;
    }
    /* Ton balance probe is best-effort; sendTonTransaction still guards when wallet reports balance */
  }

  const senderWallet = Address.parse(params.walletAddress.trim());
  const msg = buildJettonTransferMsg({
    jettonWallet: jettonWalletAddr,
    recipient,
    amount: params.amount,
    forwardPayload,
    attachedTon,
    responseAddress: senderWallet,
  });

  let beforeLt = 0n;
  try {
    const cur = await readLatestTxCursor(params.walletAddress, r);
    beforeLt = cur?.lt ?? 0n;
  } catch {
    beforeLt = 0n;
  }

  const tx = await r.sendTransactionImpl([msg]);
  if (!tx.ok) {
    const mapped = txResultToBurnError(tx);
    emit({ phase: 'failed', error: mapped });
    return tx;
  }

  emit({ phase: 'confirming', txHash: null });

  let hash: string | null = null;
  try {
    hash = await pollForWalletTxHash(params.walletAddress, beforeLt, DEFAULT_POLL_MS, r);
  } catch (e) {
    const net = new BurnTokenError('NETWORK_ERROR', 'Confirmation polling failed', { cause: e });
    emit({ phase: 'failed', error: net });
    return { ok: false, kind: 'network', message: net.message };
  }

  if (hash) {
    emit({ phase: 'confirmed', txHash: hash });
  } else {
    emit({
      phase: 'timed_out',
      txHash: null,
      error: new BurnTokenError(
        'UNKNOWN',
        'Transaction was signed but not observed on-chain within the confirmation window',
      ),
    });
  }

  return tx;
}

/**
 * Voluntary TEP-74 `JettonBurn` via Ton Connect on the owner's jetton wallet.
 *
 * Must not be implemented as a transfer to null / master / a "burn address".
 * Confirmation polling matches {@link transferBurn}.
 */
export async function burnJetton(params: BurnJettonParams, deps?: BurnTokenDeps): Promise<TxResult> {
  const r = resolveDeps(deps);
  const emit = (p: TransferProgressPayload) => r.onTransferProgress?.(p);

  emit({ phase: 'signing', txHash: null });

  if (params.amount <= 0n) {
    const err = new BurnTokenError('UNKNOWN', 'Burn amount must be greater than zero');
    emit({ phase: 'failed', error: err });
    throw err;
  }

  const balance = await getBurnBalance(params.walletAddress, deps);
  if (params.amount > balance) {
    const err = new BurnTokenError(
      'INSUFFICIENT_BALANCE',
      'BURN jetton balance is insufficient for this burn (staked BURN cannot be burned)',
    );
    emit({ phase: 'failed', error: err });
    throw err;
  }

  let userJettonWallet: string;
  try {
    userJettonWallet = await getUserJettonWalletAddress(params.walletAddress, r);
  } catch (e) {
    const wrapped =
      e instanceof BurnTokenError
        ? e
        : new BurnTokenError('NETWORK_ERROR', 'Failed to resolve jetton wallet', { cause: e });
    emit({ phase: 'failed', error: wrapped });
    throw wrapped;
  }

  const attachedTon = JETTON_BURN_ATTACHED_TON;
  try {
    const tonBalance = await getTonBalanceNano(params.walletAddress, {
      rpcBaseUrl: r.rpcBaseUrl,
      toncenterApiKey: r.apiKey,
      fetchImpl: r.fetchImpl,
    });
    const minTon = attachedTon + TON_GAS_BUFFER_NANOTON;
    if (tonBalance < minTon) {
      const err = new BurnTokenError(
        'INSUFFICIENT_TON_GAS',
        'Not enough TON for jetton burn gas attachment and fees',
      );
      emit({ phase: 'failed', error: err });
      throw err;
    }
  } catch (e) {
    if (e instanceof BurnTokenError && e.code === 'INSUFFICIENT_TON_GAS') {
      throw e;
    }
    /* Ton balance probe is best-effort; sendTonTransaction still guards when wallet reports balance */
  }

  const ownerWallet = Address.parse(params.walletAddress.trim());
  const jettonWalletAddr = Address.parse(userJettonWallet);
  const msg = buildJettonBurnMsg({
    jettonWallet: jettonWalletAddr,
    amount: params.amount,
    responseAddress: ownerWallet,
    attachedTon,
  });

  let beforeLt = 0n;
  try {
    const cur = await readLatestTxCursor(params.walletAddress, r);
    beforeLt = cur?.lt ?? 0n;
  } catch {
    beforeLt = 0n;
  }

  const tx = await r.sendTransactionImpl([msg]);
  if (!tx.ok) {
    const mapped = txResultToBurnError(tx);
    emit({ phase: 'failed', error: mapped });
    return tx;
  }

  emit({ phase: 'confirming', txHash: null });

  let hash: string | null = null;
  try {
    hash = await pollForWalletTxHash(params.walletAddress, beforeLt, DEFAULT_POLL_MS, r);
  } catch (e) {
    const net = new BurnTokenError('NETWORK_ERROR', 'Confirmation polling failed', { cause: e });
    emit({ phase: 'failed', error: net });
    return { ok: false, kind: 'network', message: net.message };
  }

  if (hash) {
    emit({ phase: 'confirmed', txHash: hash });
  } else {
    emit({
      phase: 'timed_out',
      txHash: null,
      error: new BurnTokenError(
        'UNKNOWN',
        'Transaction was signed but not observed on-chain within the confirmation window',
      ),
    });
  }

  return tx;
}
