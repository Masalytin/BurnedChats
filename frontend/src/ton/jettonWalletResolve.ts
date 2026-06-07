import { Address, beginCell, Cell } from '@ton/core';

import { BurnTokenError } from '@/ton/burnTokenError';
import { resolveIsTestNet } from '@/ton/rpc';

function addressToSliceStackBoc(userAddress: string): string {
  const addr = Address.parse(userAddress.trim());
  return beginCell().storeAddress(addr).endCell().toBoc({ idx: false }).toString('base64');
}

/** Stack entry Ton Center `[type, value]` pair. */
type StackSlot = [string, string];

export type JettonWalletResolveDeps = {
  rpcBaseUrl: string;
  jettonMaster: string;
  apiKey?: string;
  fetchImpl: typeof fetch;
};

function logResolveFailure(meta: Record<string, unknown>): void {
  if (!import.meta.env.DEV) {
    return;
  }
  void import('@/components/DebugPanel')
    .then(({ debugLog }) => {
      debugLog('warn', '[jetton] get_wallet_address non-zero exit', meta);
    })
    .catch(() => {
      // DebugPanel unavailable (unit tests, SSR)
    });
}

function maskAddress(addr: string): string {
  const t = addr.trim();
  if (t.length <= 8) {
    return '***';
  }
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
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

function firstStackSliceCellB64(stack: unknown): string | null {
  const slots = parseStackSlots(stack);
  for (const [t, v] of slots) {
    if (t === 'tvm.Slice') {
      return v;
    }
  }
  return null;
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

/**
 * Resolves the owner's BURN jetton wallet via master `get_wallet_address`.
 *
 * - Non-zero exit_code → {@link BurnTokenError} `JETTON_WALLET_UNRESOLVED` (retryable).
 * - Exit 0 with empty / zero address → `JETTON_WALLET_NOT_DEPLOYED`.
 */
export async function resolveUserJettonWalletAddress(
  ownerAddress: string,
  deps: JettonWalletResolveDeps,
): Promise<string> {
  const master = deps.jettonMaster.trim();
  const sliceB64 = addressToSliceStackBoc(ownerAddress);
  const { exitCode, stackUnknown } = await postRunGetMethod(
    deps.rpcBaseUrl,
    master,
    'get_wallet_address',
    [['tvm.Slice', sliceB64]],
    deps.fetchImpl,
    deps.apiKey,
  );

  if (exitCode !== 0) {
    logResolveFailure({
      master: maskAddress(master),
      owner: maskAddress(ownerAddress),
      exitCode,
    });
    throw new BurnTokenError('JETTON_WALLET_UNRESOLVED', 'Could not resolve jetton wallet via get_wallet_address', {
      cause: { exitCode, master, owner: ownerAddress },
    });
  }

  const b64 = firstStackSliceCellB64(stackUnknown);
  if (!b64) {
    throw new BurnTokenError(
      'JETTON_WALLET_NOT_DEPLOYED',
      'Sender has no BURN jetton wallet (empty get_wallet_address stack)',
      { cause: { exitCode: 0 } },
    );
  }

  let resolved: string;
  try {
    resolved = decodeAddressFromSliceBoc(b64, resolveIsTestNet());
  } catch (e) {
    throw new BurnTokenError(
      'JETTON_WALLET_NOT_DEPLOYED',
      'Sender has no BURN jetton wallet (invalid get_wallet_address slice)',
      { cause: e },
    );
  }

  try {
    if (isZeroTonAddress(Address.parse(resolved))) {
      throw new BurnTokenError(
        'JETTON_WALLET_NOT_DEPLOYED',
        'Sender has no BURN jetton wallet (zero address)',
        { cause: { exitCode: 0 } },
      );
    }
  } catch (e) {
    if (e instanceof BurnTokenError) {
      throw e;
    }
    throw new BurnTokenError(
      'JETTON_WALLET_NOT_DEPLOYED',
      'Sender has no BURN jetton wallet (unparseable address)',
      { cause: e },
    );
  }

  return resolved;
}
