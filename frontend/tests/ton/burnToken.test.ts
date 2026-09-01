import { Address } from '@ton/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addressToSliceStackBoc,
  getBurnBalance,
  getEffectiveFeeParams,
  setBurnTokenReadDevForTests,
  txResultToBurnError,
} from '@/ton/burnToken';
import { BurnTokenError } from '@/ton/burnTokenError';
import { formatBurn, parseBurn } from '@/utils/format';

const MASTER = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c').toString({
  bounceable: true,
  urlSafe: true,
  testOnly: true,
});
const USER = Address.parse(`0:${'11'.repeat(32)}`).toString({ bounceable: true, urlSafe: true, testOnly: true });
/** Jetton-wallet placeholder returned by mocked `get_wallet_address`. */
const JETTON_USER_WALLET = Address.parse(`0:${'22'.repeat(32)}`).toString({
  bounceable: true,
  urlSafe: true,
  testOnly: true,
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('burnToken RPC helpers', () => {
  afterEach(() => {
    setBurnTokenReadDevForTests(undefined);
    vi.unstubAllEnvs();
  });

  it('addressToSliceStackBoc is stable BoC payload for tvm.Slice stack arg', () => {
    const b64 = addressToSliceStackBoc(USER);
    expect(b64.length).toBeGreaterThan(10);
    expect(addressToSliceStackBoc(USER)).toBe(b64);
  });

  it('getBurnBalance uses Ton Center when backend base URL is absent (DEV)', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const sliceB64 = addressToSliceStackBoc(JETTON_USER_WALLET);

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['tvm.Slice', sliceB64]] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['num', '0x3b9aca00']] },
        }),
      );

    const nano = await getBurnBalance(USER, {
      fetchImpl,
      rpcBaseUrl: 'https://stub.ton/api/v2',
      jettonMaster: MASTER,
    });

    expect(nano).toBe(1_000_000_000n);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstInit = fetchImpl.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(firstInit.body)).toMatchObject({
      address: MASTER,
      method: 'get_wallet_address',
    });
  });

  it('getBurnBalance uses own API on 200', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.stub');
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        balanceNano: '1000000000',
        address: USER,
      }),
    );

    const nano = await getBurnBalance(USER, {
      fetchImpl,
      rpcBaseUrl: 'https://stub.ton/api/v2',
      jettonMaster: MASTER,
    });

    expect(nano).toBe(1_000_000_000n);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/api/wallet/burn-balance');
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('toncenter');
  });

  it('getBurnBalance on 502 throws and does not call Toncenter', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.stub');
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/wallet/burn-balance')) {
        return jsonResponse({ message: 'rpc exhausted' }, 502);
      }
      return jsonResponse({ ok: true, result: { exit_code: 0, stack: [] } });
    });

    await expect(
      getBurnBalance(USER, {
        fetchImpl,
        rpcBaseUrl: 'https://testnet.toncenter.com/api/v2',
        jettonMaster: MASTER,
      }),
    ).rejects.toBeInstanceOf(BurnTokenError);

    const toncenterCalls = fetchImpl.mock.calls.filter(([url]) => {
      const u = String(url);
      return u.includes('toncenter') || u.includes('runGetMethod');
    });
    expect(toncenterCalls).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('empty VITE_API_URL on prod-path errors and does not default to Toncenter', async () => {
    setBurnTokenReadDevForTests(false);
    vi.stubEnv('VITE_API_URL', '');
    const fetchImpl = vi.fn();

    await expect(
      getBurnBalance(USER, {
        fetchImpl,
        rpcBaseUrl: 'https://testnet.toncenter.com/api/v2',
        jettonMaster: MASTER,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG' });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('getEffectiveFeeParams falls back to static TOKENOMICS split on Ton error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: 'boom' }));

    await expect(
      getEffectiveFeeParams({
        fetchImpl,
        rpcBaseUrl: 'https://stub.ton/api/v2',
        jettonMaster: MASTER,
      }),
    ).resolves.toMatchObject({
      burnBps: 50,
      stakingBps: 30,
      treasuryBps: 20,
    });
  });

  it('maps connector TxResult errors to BurnTokenError codes', () => {
    expect(txResultToBurnError({ ok: false, kind: 'user_rejected', message: 'x' }).code).toBe('USER_REJECTED');
    expect(txResultToBurnError({ ok: false, kind: 'insufficient_ton' }).code).toBe('INSUFFICIENT_TON_GAS');
    expect(txResultToBurnError({ ok: false, kind: 'network', message: 'n' }).code).toBe('NETWORK_ERROR');
    expect(txResultToBurnError({ ok: false, kind: 'unknown' }).code).toBe('UNKNOWN');
  });
});

describe('formatBurn / parseBurn', () => {
  it('uses 9 decimals nano → display', () => {
    expect(formatBurn(1_000_000_000n)).toMatch(/1\.000000000 BURN$/);
    expect(formatBurn(1n)).toBe('0.000000001 BURN');
    expect(formatBurn(1_234_567_890n)).toBe('1.234567890 BURN');
    expect(parseBurn('1')).toBe(1_000_000_000n);
    expect(parseBurn('1.5')).toBe(1_500_000_000n);
  });

  it('parseBurn rejects invalid input', () => {
    expect(() => parseBurn('')).toThrow();
    expect(() => parseBurn('1..2')).toThrow();
  });
});
