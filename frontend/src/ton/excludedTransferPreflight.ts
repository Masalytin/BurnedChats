import { Address, beginCell } from '@ton/core';

import type { JettonWalletResolveDeps } from '@/ton/jettonWalletResolve';
import { parseTonCenterNum } from '@/ton/parseTonCenterNum';
import { defaultFetch, resolveApiKey, resolveRpcBaseUrl } from '@/ton/rpc';

/** Stack entry Ton Center `[type, value]` pair. */
type StackSlot = [string, string];

export type ExcludedTransferPreflightDeps = JettonWalletResolveDeps & {
  /** Burned Chats API base (`VITE_API_URL`). Prod-read uses this, not Toncenter. */
  apiBaseUrl?: string;
};

let excludedReadDevOverride: boolean | undefined;

/**
 * Vite inlines `import.meta.env.DEV`; tests use {@link setExcludedReadDevForTests}.
 * Do not import the staking/burnToken seams (IMP-TONREAD-03/06/07).
 */
export function isExcludedReadDev(): boolean {
  if (excludedReadDevOverride !== undefined) {
    return excludedReadDevOverride;
  }
  return import.meta.env.DEV === true;
}

/** Force DEV/prod excluded-read path in unit tests. Pass `undefined` to restore. */
export function setExcludedReadDevForTests(dev: boolean | undefined): void {
  excludedReadDevOverride = dev;
}

function normalizeApiBase(override?: string): string {
  const raw = (override ?? import.meta.env.VITE_API_URL ?? '').trim();
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function addressToSliceStackBoc(userAddress: string): string {
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

function isTonBoolTrue(hex: string): boolean {
  const n = parseTonCenterNum(hex);
  if (n === -1n) {
    return true;
  }
  const mask64 = (1n << 64n) - 1n;
  return (n & mask64) === mask64;
}

function firstStackBool(stack: unknown): boolean {
  const slots = parseStackSlots(stack);
  for (const [t, v] of slots) {
    if (t === 'num') {
      return isTonBoolTrue(v);
    }
  }
  return false;
}

async function postRunGetMethod(
  rpcBase: string,
  address: string,
  method: string,
  stack: StackSlot[],
  fetchImpl: typeof fetch,
  apiKey?: string,
): Promise<{ exitCode: number; stackUnknown: unknown } | null> {
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
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  let body: { ok?: boolean; result?: { exit_code?: number; stack?: unknown }; error?: string };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return null;
  }
  if (!body.ok || body.result === undefined || body.result === null) {
    return null;
  }
  return {
    exitCode: body.result.exit_code ?? 0,
    stackUnknown: body.result.stack ?? [],
  };
}

/** Default deps from Vite env (testable via overrides). */
export function createExcludedPreflightDeps(
  overrides?: Partial<ExcludedTransferPreflightDeps>,
): ExcludedTransferPreflightDeps | null {
  const jettonMaster = (overrides?.jettonMaster ?? import.meta.env.VITE_BURN_JETTON_MASTER ?? '').trim();
  if (!jettonMaster) {
    return null;
  }
  return {
    rpcBaseUrl: resolveRpcBaseUrl(overrides?.rpcBaseUrl),
    jettonMaster,
    apiKey: resolveApiKey(overrides?.apiKey),
    fetchImpl: overrides?.fetchImpl ?? defaultFetch(),
  };
}

/**
 * Whether a TEP-74 owner is on the master excluded list (fee-split bypass on-chain).
 * On RPC failure returns false (conservative fee-path attach).
 */
export async function isExcludedBurnHolder(
  ownerAddress: string,
  deps: ExcludedTransferPreflightDeps,
): Promise<boolean> {
  const owner = ownerAddress.trim();
  if (!owner) {
    return false;
  }
  try {
    Address.parse(owner);
  } catch {
    return false;
  }

  const master = deps.jettonMaster.trim();
  if (!master) {
    return false;
  }

  const sliceB64 = addressToSliceStackBoc(owner);
  const result = await postRunGetMethod(
    deps.rpcBaseUrl,
    master,
    'get_is_excluded',
    [['tvm.Slice', sliceB64]],
    deps.fetchImpl,
    deps.apiKey,
  );
  if (!result || result.exitCode !== 0) {
    return false;
  }
  return firstStackBool(result.stackUnknown);
}

function parseExcludedBody(body: unknown): boolean | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const excluded = (body as { excluded?: unknown }).excluded;
  return typeof excluded === 'boolean' ? excluded : null;
}

async function fetchExcludedTransferFromApi(
  senderAddress: string,
  recipientAddress: string | null,
  fetchImpl: typeof fetch,
  base: string,
): Promise<boolean> {
  const params = new URLSearchParams({ sender: senderAddress.trim() });
  const recipient = recipientAddress?.trim();
  if (recipient) {
    params.set('recipient', recipient);
  }
  const url = `${base}/api/wallet/excluded-transfer?${params.toString()}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch {
    return false;
  }
  if (!response.ok) {
    return false;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return false;
  }
  return parseExcludedBody(body) ?? false;
}

/** Either side excluded → on-chain excluded transfer path (0.7 TON attach). */
export async function isExcludedTransfer(
  senderAddress: string,
  recipientAddress: string | null,
  deps: ExcludedTransferPreflightDeps,
): Promise<boolean> {
  const base = normalizeApiBase(deps.apiBaseUrl);
  if (base) {
    return fetchExcludedTransferFromApi(senderAddress, recipientAddress, deps.fetchImpl, base);
  }
  if (!isExcludedReadDev()) {
    return false;
  }

  const senderExcluded = await isExcludedBurnHolder(senderAddress, deps);
  if (senderExcluded) {
    return true;
  }
  if (!recipientAddress?.trim()) {
    return false;
  }
  return isExcludedBurnHolder(recipientAddress, deps);
}
