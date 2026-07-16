import { Address } from '@ton/core';
import { describe, expect, it, vi } from 'vitest';

import { addressToSliceStackBoc } from '@/ton/burnToken';
import {
  RECIPIENT_PREFLIGHT_COLD,
  preflightRecipientJetton,
} from '@/ton/recipientJettonPreflight';

const MASTER = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c').toString({
  bounceable: true,
  urlSafe: true,
  testOnly: true,
});
const RECIPIENT = Address.parse(`0:${'33'.repeat(32)}`).toString({ bounceable: true, urlSafe: true, testOnly: true });
const RECIPIENT_JW = Address.parse(`0:${'44'.repeat(32)}`).toString({
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

function deps(fetchImpl: typeof fetch) {
  return {
    fetchImpl,
    rpcBaseUrl: 'https://stub.ton/api/v2',
    jettonMaster: MASTER,
  };
}

describe('preflightRecipientJetton', () => {
  it('returns cold fallback on invalid address', async () => {
    const fetchImpl = vi.fn();
    const result = await preflightRecipientJetton('not-an-address', deps(fetchImpl));
    expect(result).toEqual(RECIPIENT_PREFLIGHT_COLD);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns walletDeployed false when recipient JW is uninit', async () => {
    const sliceB64 = addressToSliceStackBoc(RECIPIENT_JW);
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
          result: { balance: '0', state: 'uninit' },
        }),
      );

    const result = await preflightRecipientJetton(RECIPIENT, deps(fetchImpl));

    expect(result.walletDeployed).toBe(false);
    expect(result.jettonWalletAddress).toBe(RECIPIENT_JW);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns walletDeployed true when JW is active (no fee-config probe)', async () => {
    const sliceB64 = addressToSliceStackBoc(RECIPIENT_JW);
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
          result: { balance: '1000000', state: 'active' },
        }),
      );

    const result = await preflightRecipientJetton(RECIPIENT, deps(fetchImpl));

    expect(result).toEqual({
      jettonWalletAddress: RECIPIENT_JW,
      walletDeployed: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns cold fallback when get_wallet_address fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: { exit_code: -13, stack: [] },
      }),
    );

    const result = await preflightRecipientJetton(RECIPIENT, deps(fetchImpl));
    expect(result).toEqual(RECIPIENT_PREFLIGHT_COLD);
  });

  it('returns cold fallback on network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await preflightRecipientJetton(RECIPIENT, deps(fetchImpl));
    expect(result).toEqual(RECIPIENT_PREFLIGHT_COLD);
  });
});
