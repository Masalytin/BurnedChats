import {
  defaultFetch,
  resolveApiKey,
  resolveRpcBaseUrl,
  resolveRpcFallbackUrl,
} from '@/ton/rpc';

/** Test-only override. `undefined` restores `import.meta.env.DEV`. */
let tonBalanceReadDevOverride: boolean | undefined;

/**
 * Vite inlines `import.meta.env.DEV`; tests use {@link setTonBalanceReadDevForTests}
 * (same pattern as staking / DebugPanel payload gates). Do not import from staking.ts.
 */
export function isTonBalanceReadDev(): boolean {
  if (tonBalanceReadDevOverride !== undefined) {
    return tonBalanceReadDevOverride;
  }
  return import.meta.env.DEV === true;
}

/** Force DEV/prod TON-balance read-path in unit tests. Pass `undefined` to restore. */
export function setTonBalanceReadDevForTests(dev: boolean | undefined): void {
  tonBalanceReadDevOverride = dev;
}

function normalizeApiBase(): string {
  const raw = import.meta.env.VITE_API_URL ?? '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

export type TonBalanceDeps = {
  rpcBaseUrl?: string;
  rpcFallbackUrl?: string;
  toncenterApiKey?: string;
  fetchImpl?: typeof fetch;
};

export type TonBalanceErrorKind = 'network' | 'http' | 'rpc' | 'parse' | 'config';

export class TonBalanceError extends Error {
  readonly kind: TonBalanceErrorKind;

  constructor(message: string, kind: TonBalanceErrorKind, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TonBalanceError';
    this.kind = kind;
  }
}

type AddressInformationBody = {
  ok?: boolean;
  result?: { balance?: string | number };
  error?: string;
};

function uniqueRpcUrls(primary: string, fallback?: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of [primary, fallback]) {
    const trimmed = raw?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    urls.push(trimmed);
  }
  return urls;
}

async function fetchBalanceFromRpc(
  rpcBaseUrl: string,
  trimmedAddress: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<bigint> {
  const url = `${rpcBaseUrl}/getAddressInformation?address=${encodeURIComponent(trimmedAddress)}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  let response: Response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (e) {
    throw new TonBalanceError('TON getAddressInformation request failed', 'network', { cause: e });
  }
  if (!response.ok) {
    throw new TonBalanceError(
      `TON getAddressInformation HTTP ${response.status}`,
      'http',
    );
  }

  let body: AddressInformationBody;
  try {
    body = (await response.json()) as AddressInformationBody;
  } catch (e) {
    throw new TonBalanceError('TON getAddressInformation invalid JSON', 'parse', { cause: e });
  }

  if (!body.ok) {
    const detail = typeof body.error === 'string' ? body.error : 'RPC returned ok=false';
    throw new TonBalanceError(detail, 'rpc');
  }

  const raw = body.result?.balance;
  if (raw === undefined || raw === null) {
    throw new TonBalanceError('TON getAddressInformation missing result.balance', 'parse');
  }

  try {
    return BigInt(String(raw));
  } catch (e) {
    throw new TonBalanceError('TON balance is not a valid integer', 'parse', { cause: e });
  }
}

function shouldTryFallback(kind: TonBalanceErrorKind): boolean {
  return kind === 'network' || kind === 'http';
}

function parseTonBalanceBody(body: unknown): bigint | null {
  if (body && typeof body === 'object') {
    const nano = (body as Record<string, unknown>).balanceNano;
    if (typeof nano === 'string' && /^-?\d+$/.test(nano)) {
      try {
        return BigInt(nano);
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function fetchBalanceFromApi(
  base: string,
  trimmedAddress: string,
  fetchImpl: typeof fetch,
): Promise<bigint> {
  const url = `${base}/api/wallet/ton-balance?address=${encodeURIComponent(trimmedAddress)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new TonBalanceError('TON balance API request failed', 'network', { cause: e });
  }
  if (!response.ok) {
    throw new TonBalanceError(`TON balance API HTTP ${response.status}`, 'http');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    throw new TonBalanceError('TON balance API invalid JSON', 'parse', { cause: e });
  }
  const nano = parseTonBalanceBody(body);
  if (nano === null) {
    throw new TonBalanceError('TON balance API missing balanceNano', 'parse');
  }
  return nano;
}

async function fetchBalanceFromRpcEndpoints(
  trimmedAddress: string,
  deps: TonBalanceDeps | undefined,
  fetchImpl: typeof fetch,
): Promise<bigint> {
  const primaryUrl = resolveRpcBaseUrl(deps?.rpcBaseUrl);
  const fallbackUrl = resolveRpcFallbackUrl(deps?.rpcFallbackUrl);
  const apiKey = resolveApiKey(deps?.toncenterApiKey);

  const endpoints = uniqueRpcUrls(primaryUrl, fallbackUrl);
  let lastError: TonBalanceError | undefined;

  for (let i = 0; i < endpoints.length; i += 1) {
    const rpcBaseUrl = endpoints[i]!;
    try {
      return await fetchBalanceFromRpc(rpcBaseUrl, trimmedAddress, apiKey, fetchImpl);
    } catch (e) {
      const err =
        e instanceof TonBalanceError
          ? e
          : new TonBalanceError('TON getAddressInformation failed', 'network', { cause: e });
      lastError = err;
      const hasMoreFallback = i + 1 < endpoints.length;
      if (!hasMoreFallback || !shouldTryFallback(err.kind)) {
        throw err;
      }
    }
  }

  throw lastError ?? new TonBalanceError('TON getAddressInformation failed', 'network');
}

/**
 * Native TON balance in nano (1 TON = 1e9 nano).
 * Prod-read is `/api/wallet/ton-balance` only. DEV may use Ton Center RPC
 * only when `VITE_API_URL` is empty.
 */
export async function getTonBalanceNano(address: string, deps?: TonBalanceDeps): Promise<bigint> {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new TonBalanceError('Wallet address is empty', 'config');
  }

  const fetchImpl = deps?.fetchImpl ?? defaultFetch();
  const base = normalizeApiBase();
  if (base) {
    return fetchBalanceFromApi(base, trimmed, fetchImpl);
  }
  if (!isTonBalanceReadDev()) {
    throw new TonBalanceError('API base URL is not configured (VITE_API_URL)', 'config');
  }
  return fetchBalanceFromRpcEndpoints(trimmed, deps, fetchImpl);
}
