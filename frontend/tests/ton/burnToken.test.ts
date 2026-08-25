import { Address } from '@ton/core';
import { describe, expect, it, vi } from 'vitest';
import {
  addressToSliceStackBoc,
  getBurnBalance,
  getEffectiveFeeParams,
  txResultToBurnError,
} from '@/ton/burnToken';
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
  it('addressToSliceStackBoc is stable BoC payload for tvm.Slice stack arg', () => {
    const b64 = addressToSliceStackBoc(USER);
    expect(b64.length).toBeGreaterThan(10);
    expect(addressToSliceStackBoc(USER)).toBe(b64);
  });

  it('getBurnBalance uses Ton Center when backend base URL is absent', async () => {
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

  it('getBurnBalance falls back to Ton Center after backend burn-balance 404', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.stub');

    const sliceB64 = addressToSliceStackBoc(JETTON_USER_WALLET);

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['tvm.Slice', sliceB64]] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jettonWalletAddress: JETTON_USER_WALLET,
          ownerAddress: USER,
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
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/api/wallet/burn-balance');
    const walletAddrCall = fetchImpl.mock.calls[1]?.[1] as { body: string };
    expect(JSON.parse(walletAddrCall.body)).toMatchObject({
      address: MASTER,
      method: 'get_wallet_address',
    });
    expect(String(fetchImpl.mock.calls[2]?.[0])).toContain('/api/wallet/jetton-wallet');
    const walletDataCall = fetchImpl.mock.calls[3]?.[1] as { body: string };
    expect(JSON.parse(walletDataCall.body)).toMatchObject({
      address: JETTON_USER_WALLET,
      method: 'get_wallet_data',
    });

    vi.unstubAllEnvs();
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
