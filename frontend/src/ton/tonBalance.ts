import { defaultFetch, resolveApiKey, resolveRpcBaseUrl } from '@/ton/rpc';

export type TonBalanceDeps = {
  rpcBaseUrl?: string;
  toncenterApiKey?: string;
  fetchImpl?: typeof fetch;
};

export class TonBalanceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TonBalanceError';
  }
}

type AddressInformationBody = {
  ok?: boolean;
  result?: { balance?: string | number };
  error?: string;
};

/** Native TON balance in nano (1 TON = 1e9 nano). */
export async function getTonBalanceNano(address: string, deps?: TonBalanceDeps): Promise<bigint> {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new TonBalanceError('Wallet address is empty');
  }

  const rpcBaseUrl = resolveRpcBaseUrl(deps?.rpcBaseUrl);
  const apiKey = resolveApiKey(deps?.toncenterApiKey);
  const fetchImpl = deps?.fetchImpl ?? defaultFetch();

  const url = `${rpcBaseUrl}/getAddressInformation?address=${encodeURIComponent(trimmed)}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  let response: Response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (e) {
    throw new TonBalanceError('TON getAddressInformation request failed', { cause: e });
  }
  if (!response.ok) {
    throw new TonBalanceError(`TON getAddressInformation HTTP ${response.status}`);
  }

  let body: AddressInformationBody;
  try {
    body = (await response.json()) as AddressInformationBody;
  } catch (e) {
    throw new TonBalanceError('TON getAddressInformation invalid JSON', { cause: e });
  }

  if (!body.ok) {
    const detail = typeof body.error === 'string' ? body.error : 'RPC returned ok=false';
    throw new TonBalanceError(detail);
  }

  const raw = body.result?.balance;
  if (raw === undefined || raw === null) {
    throw new TonBalanceError('TON getAddressInformation missing result.balance');
  }

  try {
    return BigInt(String(raw));
  } catch (e) {
    throw new TonBalanceError('TON balance is not a valid integer', { cause: e });
  }
}
