import { Address, beginCell, Cell } from '@ton/core';

import { firstStackSliceCellB64, type JettonWalletResolveDeps } from '@/ton/jettonWalletResolve';
import { defaultFetch, resolveApiKey, resolveIsTestNet, resolveRpcBaseUrl } from '@/ton/rpc';

export type RecipientJettonPreflight = {
  jettonWalletAddress: string | null;
  walletDeployed: boolean;
};

/** Cold-path fallback when RPC fails or recipient is unknown. */
export const RECIPIENT_PREFLIGHT_COLD: RecipientJettonPreflight = {
  jettonWalletAddress: null,
  walletDeployed: false,
};

/** Stack entry Ton Center `[type, value]` pair. */
type StackSlot = [string, string];

type AddressInformationBody = {
  ok?: boolean;
  result?: { state?: string };
  error?: string;
};

function addressToSliceStackBoc(userAddress: string): string {
  const addr = Address.parse(userAddress.trim());
  return beginCell().storeAddress(addr).endCell().toBoc({ idx: false }).toString('base64');
}

function decodeAddressFromSliceBoc(b64: string, testOnly: boolean): string {
  const cell = Cell.fromBoc(Buffer.from(b64, 'base64'))[0]!;
  const s = cell.beginParse();
  const a = s.loadAddress();
  return a.toString({ bounceable: true, testOnly, urlSafe: true });
}

function isZeroTonAddress(addr: Address): boolean {
  return addr.workChain === 0 && addr.hash.every((b) => b === 0);
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

async function fetchAccountState(
  address: string,
  deps: JettonWalletResolveDeps,
): Promise<string | null> {
  const url = `${deps.rpcBaseUrl}/getAddressInformation?address=${encodeURIComponent(address.trim())}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (deps.apiKey) {
    headers['X-API-Key'] = deps.apiKey;
  }
  let response: Response;
  try {
    response = await deps.fetchImpl(url, { headers });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  let body: AddressInformationBody;
  try {
    body = (await response.json()) as AddressInformationBody;
  } catch {
    return null;
  }
  if (!body.ok) {
    return null;
  }
  return body.result?.state ?? null;
}

async function resolveRecipientJettonWalletAddress(
  ownerAddress: string,
  deps: JettonWalletResolveDeps,
): Promise<string | null> {
  const master = deps.jettonMaster.trim();
  if (!master) {
    return null;
  }
  const sliceB64 = addressToSliceStackBoc(ownerAddress);
  const result = await postRunGetMethod(
    deps.rpcBaseUrl,
    master,
    'get_wallet_address',
    [['tvm.Slice', sliceB64]],
    deps.fetchImpl,
    deps.apiKey,
  );
  if (!result || result.exitCode !== 0) {
    return null;
  }
  const b64 = firstStackSliceCellB64(result.stackUnknown);
  if (!b64) {
    return null;
  }
  let resolved: string;
  try {
    resolved = decodeAddressFromSliceBoc(b64, resolveIsTestNet());
  } catch {
    return null;
  }
  try {
    if (isZeroTonAddress(Address.parse(resolved))) {
      return null;
    }
  } catch {
    return null;
  }
  return resolved;
}

/** Default deps from Vite env (testable via overrides). */
export function createRecipientPreflightDeps(overrides?: Partial<JettonWalletResolveDeps>): JettonWalletResolveDeps | null {
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
 * Best-effort recipient jetton wallet probe for TON attach estimation.
 * On RPC failure returns cold-path defaults.
 */
export async function preflightRecipientJetton(
  recipientOwner: string,
  deps: JettonWalletResolveDeps,
): Promise<RecipientJettonPreflight> {
  const owner = recipientOwner.trim();
  if (!owner) {
    return RECIPIENT_PREFLIGHT_COLD;
  }
  try {
    Address.parse(owner);
  } catch {
    return RECIPIENT_PREFLIGHT_COLD;
  }

  const jettonWalletAddress = await resolveRecipientJettonWalletAddress(owner, deps);
  if (!jettonWalletAddress) {
    return RECIPIENT_PREFLIGHT_COLD;
  }

  const state = await fetchAccountState(jettonWalletAddress, deps);
  if (state !== 'active') {
    return { jettonWalletAddress, walletDeployed: false };
  }

  return { jettonWalletAddress, walletDeployed: true };
}
