import { Address } from '@ton/core';
import { describe, expect, it, vi } from 'vitest';
import {
  addressToSliceStackBoc,
  getBurnBalance,
  txResultToBurnError,
} from '@/ton/burnToken';
import { formatBurn, parseBurn } from '@/utils/format';

const MASTER = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c').toString({
  bounceable: true,
  urlSafe: true,
  testOnly: true,
});
const USER = Address.parse(`0:${'11'.repeat(32)}`).toString({ bounceable: true, urlSafe: true, testOnly: true });
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
    expect(parseBurn('1')).toBe(1_000_000_000n);
    expect(parseBurn('1.5')).toBe(1_500_000_000n);
  });

  it('parseBurn rejects invalid input', () => {
    expect(() => parseBurn('')).toThrow();
    expect(() => parseBurn('1..2')).toThrow();
  });
});
