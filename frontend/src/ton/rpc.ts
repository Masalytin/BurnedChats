/** Shared Ton Center RPC URL / API key resolution (BURN, TON balance, staking, …). */

export function resolveIsTestNet(): boolean {
  const raw = String(import.meta.env.VITE_TON_NETWORK ?? 'testnet').toLowerCase();
  return raw === 'testnet' || raw === 'true' || raw === '1';
}

export function resolveRpcBaseUrl(override?: string): string {
  const fromEnv = (import.meta.env.VITE_TON_RPC_URL ?? '').trim();
  const primary = (override ?? fromEnv).trim();
  const base =
    primary ||
    (resolveIsTestNet() ? 'https://testnet.toncenter.com/api/v2' : 'https://toncenter.com/api/v2');
  return base.replace(/\/$/, '');
}

/** Optional secondary Ton Center RPC when primary is unreachable (IMP-WGRAM-05). */
export function resolveRpcFallbackUrl(override?: string): string | undefined {
  const fromEnv = (import.meta.env.VITE_TON_RPC_FALLBACK_URL ?? '').trim();
  const url = (override ?? fromEnv).trim();
  return url ? url.replace(/\/$/, '') : undefined;
}

export function resolveApiKey(override?: string): string | undefined {
  if (override !== undefined) {
    const k = override.trim();
    return k || undefined;
  }
  // Production Mini App must not ship a Toncenter key in the Vite bundle.
  if (import.meta.env.PROD) {
    return undefined;
  }
  const k = (import.meta.env.VITE_TONCENTER_API_KEY ?? '').trim();
  return k || undefined;
}

export function defaultFetch(): typeof fetch {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('fetch is not available in this environment');
  }
  return globalThis.fetch.bind(globalThis);
}
