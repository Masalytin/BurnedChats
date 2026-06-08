import { Address, beginCell } from '@ton/core';

import type { JettonWalletResolveDeps } from '@/ton/jettonWalletResolve';
import { defaultFetch, resolveApiKey, resolveRpcBaseUrl } from '@/ton/rpc';

/** Stack entry Ton Center `[type, value]` pair. */
type StackSlot = [string, string];

export type ExcludedTransferPreflightDeps = JettonWalletResolveDeps;

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

function parseNumHex(hex: string): bigint {
  const s = hex.trim();
  const withPrefix = s.startsWith('0x') || s.startsWith('0X') ? s : `0x${s}`;
  return BigInt(withPrefix);
}

function isTonBoolTrue(hex: string): boolean {
  const n = parseNumHex(hex);
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

/** Either side excluded → on-chain excluded transfer path (0.7 TON attach). */
export async function isExcludedTransfer(
  senderAddress: string,
  recipientAddress: string | null,
  deps: ExcludedTransferPreflightDeps,
): Promise<boolean> {
  const senderExcluded = await isExcludedBurnHolder(senderAddress, deps);
  if (senderExcluded) {
    return true;
  }
  if (!recipientAddress?.trim()) {
    return false;
  }
  return isExcludedBurnHolder(recipientAddress, deps);
}
