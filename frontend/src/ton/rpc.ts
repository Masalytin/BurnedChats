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

export function resolveApiKey(override?: string): string | undefined {
  const k = (override ?? import.meta.env.VITE_TONCENTER_API_KEY ?? '').trim();
  return k || undefined;
}

export function defaultFetch(): typeof fetch {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('fetch is not available in this environment');
  }
  return globalThis.fetch.bind(globalThis);
}
