import { describe, expect, it, vi } from 'vitest';
import { getTonBalanceNano, TonBalanceError } from '@/ton/tonBalance';

const USER = '0QBNxdjqjhQP2OPaZHSRj06NRTd4z6-Trd6BdZ0DX0_9WJPD';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getTonBalanceNano', () => {
  it('parses result.balance from getAddressInformation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: { balance: '1500000000', state: 'active' },
      }),
    );

    const nano = await getTonBalanceNano(USER, {
      fetchImpl,
      rpcBaseUrl: 'https://stub.ton/api/v2',
      toncenterApiKey: 'test-key',
    });

    expect(nano).toBe(1_500_000_000n);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://stub.ton/api/v2/getAddressInformation?address=${encodeURIComponent(USER)}`);
    expect(init?.headers).toMatchObject({ 'X-API-Key': 'test-key' });
  });

  it('throws TonBalanceError when RPC returns ok=false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: 'rate limit' }));

    await expect(
      getTonBalanceNano(USER, { fetchImpl, rpcBaseUrl: 'https://stub.ton/api/v2' }),
    ).rejects.toBeInstanceOf(TonBalanceError);
  });

  it('throws TonBalanceError on HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 429));

    await expect(
      getTonBalanceNano(USER, { fetchImpl, rpcBaseUrl: 'https://stub.ton/api/v2' }),
    ).rejects.toThrow(/HTTP 429/);
  });
});
