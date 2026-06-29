import {
  defaultFetch,
  resolveApiKey,
  resolveRpcBaseUrl,
  resolveRpcFallbackUrl,
} from '@/ton/rpc';

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

/** Native TON balance in nano (1 TON = 1e9 nano). */
export async function getTonBalanceNano(address: string, deps?: TonBalanceDeps): Promise<bigint> {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new TonBalanceError('Wallet address is empty', 'config');
  }

  const primaryUrl = resolveRpcBaseUrl(deps?.rpcBaseUrl);
  const fallbackUrl = resolveRpcFallbackUrl(deps?.rpcFallbackUrl);
  const apiKey = resolveApiKey(deps?.toncenterApiKey);
  const fetchImpl = deps?.fetchImpl ?? defaultFetch();

  const endpoints = uniqueRpcUrls(primaryUrl, fallbackUrl);
  let lastError: TonBalanceError | undefined;

  for (let i = 0; i < endpoints.length; i += 1) {
    const rpcBaseUrl = endpoints[i]!;
    const isFallback = i > 0;
    try {
      return await fetchBalanceFromRpc(rpcBaseUrl, trimmed, apiKey, fetchImpl);
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
      if (!isFallback) {
        /* primary failed with retryable kind — try configured fallback next */
      }
    }
  }

  throw lastError ?? new TonBalanceError('TON getAddressInformation failed', 'network');
}
